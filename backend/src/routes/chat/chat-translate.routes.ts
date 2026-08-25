import { Router } from "express";
import axios from "axios";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { generateText } from "ai";
import redis from "../../config/redis/client.js";
import { asyncHandler } from "../../utils/express-async-wrapper.js";
import { trLog, createProviderClient } from "./chat-shared.js";

const router = Router();

// ─── Translation / Auto-Correct endpoint ───────────────────────────────────
// Used by ChatInput.tsx smart-translate feature
const translateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: "لقد تجاوزت حد الترجمة. انتظر قليلاً." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Map frontend targetLang codes — human-readable instruction for the model
function buildTranslatePrompt(targetLang: string): string {
  const map: Record<string, string> = {
    "en-casual":
      "Translate the text to casual, friendly English as used in everyday chat. Return ONLY the translated text.",
    "en-formal":
      "Translate the text to formal, professional English. Return ONLY the translated text.",
    "es":
      "Translate the text to clear, natural Spanish. Return ONLY the translated text.",
    "ar":
      "ترجم النص إلى لغة عربية واضحة وطبيعية. أعد النص المترجم فقط بدون أي شرح.",
    "fr":
      "Traduisez le texte en français clair et naturel. Retournez uniquement le texte traduit.",
    "de":
      "Übersetze den Text in klares, natürliches Deutsch. Gib nur den übersetzten Text zurück.",
    "tr":
      "Metni açık ve doğal Türkçeye çevir. Sadece çevrilmiş metni döndür.",
    "fa":
      "متن را به فارسی واضح و طبیعی ترجمه کنید. فقط متن ترجمه شده را برگردانید.",
    "zh":
      "将文本翻译成清晰自然的简体中文。只返回翻译后的文本。",
  };
  return (
    map[targetLang] ??
    "Translate the text as accurately as possible. Return ONLY the translated text."
  );
}

// Helper to map UI targetLang to Azure language codes
function getAzureTargetLang(targetLang: string): string | null {
  const map: Record<string, string> = {
    "en": "en",
    "en-formal": "en",
    "es": "es",
    "ar": "ar",
    "fr": "fr",
    "de": "de",
    "tr": "tr",
    "fa": "fa",
    "zh": "zh-Hans",
  };
  return map[targetLang] ?? null;
}

// Helper to translate text using Azure Translator
async function translateWithAzure(text: string, toLangCode: string): Promise<string> {
  const key = process.env.AZURE_TRANSLATOR_KEY;
  const region = process.env.AZURE_TRANSLATOR_REGION || "swedencentral";
  const endpoint = process.env.AZURE_TRANSLATOR_ENDPOINT || "https://api.cognitive.microsofttranslator.com/";

  if (!key) throw new Error("Missing AZURE_TRANSLATOR_KEY");

  const url = `${endpoint.replace(/\/$/, "")}/translate?api-version=3.0&to=${toLangCode}`;
  const response = await axios.post(
    url,
    [{ Text: text }],
    {
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Ocp-Apim-Subscription-Region": region,
        "Content-Type": "application/json",
      },
      timeout: 5000,
    }
  );

  const translated = response.data?.[0]?.translations?.[0]?.text;
  if (!translated) {
    throw new Error("Empty response from Azure Translator");
  }
  return translated;
}

router.post(
  "/translate",
  translateLimiter,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      trLog.warn("Unauthorized POST /api/chat/translate — missing or invalid user");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { text, targetLang } = req.body ?? {};

    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }
    if (!targetLang || typeof targetLang !== "string") {
      return res.status(400).json({ error: "targetLang is required" });
    }
    if (text.trim().length > 2000) {
      return res.status(400).json({ error: "text too long (max 2000 chars)" });
    }

    // 1. Redis / Memory Caching layer
    const textHash = crypto.createHash("sha256").update(text.trim()).digest("hex");
    const cacheKey = `tr:${textHash}:${targetLang}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        trLog.info("Cache HIT", { key: cacheKey });
        return res.json({ translated: cached });
      }
    } catch (cacheErr) {
      trLog.warn("Redis get error (falling back)", { error: (cacheErr as Error)?.message });
    }

    const instruction = buildTranslatePrompt(targetLang);

    // 2. Fallback Chain Definition
    const chain: (
      | { type: "azure"; target: string }
      | { type: "llm"; provider: "groq" | "github" | "openrouter"; model: string }
    )[] = [];

    // Azure handles standard language mappings with ultra-low latency (<150ms)
    const azureTarget = getAzureTargetLang(targetLang);
    if (azureTarget && process.env.AZURE_TRANSLATOR_KEY) {
      chain.push({ type: "azure", target: azureTarget });
    }

    // LLM step for dialects, grammar correction, or as translation fallback
    if (process.env.GROQ_API_KEY) {
      chain.push({ type: "llm", provider: "groq", model: "llama-3.3-70b-versatile" });
    }
    if (process.env.GITHUB_TOKEN) {
      chain.push({ type: "llm", provider: "github", model: "openai/gpt-4o-mini" });
    }
    if (process.env.OPENROUTER_API_KEY) {
      chain.push({ type: "llm", provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free" });
    }

    if (chain.length === 0) {
      return res.status(503).json({ error: "No translation providers configured" });
    }

    let lastError: unknown = null;

    for (const step of chain) {
      try {
        let translated = "";

        if (step.type === "azure") {
          trLog.info("Attempting translation with Azure Translator", { target: step.target });
          translated = await translateWithAzure(text.trim(), step.target);
          trLog.info("Azure Translator succeeded");
        } else {
          trLog.info("Attempting translation with LLM", { provider: step.provider, model: step.model });
          const client = createProviderClient(step.provider);
          const result = await generateText({
            model: client.chat(step.model),
            system: instruction,
            messages: [{ role: "user", content: text.trim() }],
            maxOutputTokens: 512,
            temperature: 0.2,
          });
          translated = (result.text || "").replace(/^["']|["']$/g, "").trim();
          trLog.info("LLM translation succeeded", { provider: step.provider });
        }

        if (translated) {
          // Cache successful translation for 24 hours (86400 seconds)
          try {
            await redis.set(cacheKey, translated, "EX", 86400);
            trLog.info("Cached translation", { key: cacheKey });
          } catch (cacheErr) {
            trLog.warn("Redis cache write failed", { error: (cacheErr as Error)?.message });
          }

          return res.json({ translated });
        }
      } catch (err: unknown) {
        const stepDesc = step.type === "azure" ? "Azure" : step.provider;
        trLog.warn(`Step ${stepDesc} failed`, { error: err instanceof Error ? err.message : String(err) });
        lastError = err;
      }
    }

    // If we reach here, all providers in the chain failed
    trLog.error("All providers in fallback chain failed", { lastError: lastError instanceof Error ? lastError.message : String(lastError) });
    return res.status(500).json({
      translated: text,
      error: "Translation failed across all available providers",
      details: lastError instanceof Error ? lastError.message : String(lastError)
    });
  })
);

export default router;
