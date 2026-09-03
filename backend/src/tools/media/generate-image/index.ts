import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { supabase } from "../../../config/supabase.config.js";

createToolMetadata("generate_image", "Generate an image from a text description using AI and show it to the user", {
  requiresUserId: true,
  category: "other",
  enabledByDefault: true,
});

const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-2.5-flash-image";
const DAILY_LIMIT = parseInt(process.env.IMAGE_GEN_DAILY_LIMIT || "15", 10);
const REQUEST_TIMEOUT_MS = 120_000;

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

async function callGeminiImage(prompt: string): Promise<{ mimeType: string; base64: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw Object.assign(new Error("missing_key"), { code: "CONFIG" });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  if (res.status === 429) {
    throw Object.assign(
      new Error("quota_exceeded"),
      { code: "QUOTA", userMessage: "The free image generation quota is currently exhausted — try again later today or tomorrow." },
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`gemini_http_${res.status}: ${detail.slice(0, 200)}`),
      { code: "UPSTREAM" },
    );
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  };
  const imagePart = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!imagePart?.inlineData) {
    // Model answered with text only (e.g. refused) — surface that honestly.
    const refusal = json.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? "";
    throw Object.assign(
      new Error(`no_image_in_response: ${refusal.slice(0, 150)}`),
      { code: "NO_IMAGE" },
    );
  }
  return { mimeType: imagePart.inlineData.mimeType, base64: imagePart.inlineData.data };
}

registerTool("generate_image", {
  description:
    "Generate an AI image from a text description (illustrations, scenes, designs). Use when the user asks to create/generate/draw an image.",
  inputSchema: z.object({
    prompt: z
      .string()
      .min(3)
      .max(1000)
      .describe("Detailed description of the requested image, in English or Arabic"),
    __userId: z.string().optional().describe("User ID (passed automatically)"),
  }),
  execute: async ({ prompt, __userId }: { prompt: string; __userId?: string }) => {
    if (!__userId) {
      return JSON.stringify({ status: "error", message: "Login is required to generate images" });
    }

    try {
      // ── Daily quota check ──────────────────────────────────────────────
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const { count, error: countErr } = await supabase
        .from("image_generations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", __userId)
        .gte("created_at", startOfDay.toISOString());

      if (countErr) throw new Error(`quota_check_failed: ${countErr.message}`);
      if ((count ?? 0) >= DAILY_LIMIT) {
        return JSON.stringify({
          status: "error",
          message: `You have reached the daily limit (${DAILY_LIMIT} images). The limit resets tomorrow.`,
        });
      }

      // ── Generate via Gemini ────────────────────────────────────────────
      const { mimeType, base64 } = await callGeminiImage(prompt);

      // ── Persist to public storage so history URLs never expire ────────
      const ext = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
      const path = `${__userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const buffer = Buffer.from(base64, "base64");
      const { error: uploadErr } = await supabase.storage
        .from("generated-images")
        .upload(path, buffer, { contentType: mimeType, upsert: false });
      if (uploadErr) throw new Error(`storage_upload_failed: ${uploadErr.message}`);

      const { data: urlData } = supabase.storage.from("generated-images").getPublicUrl(path);
      const imageUrl = urlData.publicUrl;

      const { error: insertErr } = await supabase.from("image_generations").insert({
        user_id: __userId,
        prompt: prompt.slice(0, 1000),
        storage_path: path,
        mime_type: mimeType,
      });
      if (insertErr) console.warn("[generate_image] tracking insert failed:", insertErr.message);

      return JSON.stringify({
        status: "success",
        imageUrl,
        markdown: `![Generated image]( ${imageUrl} )`,
        instruction: "Show the image to the user by including the markdown above in your reply exactly as given, and mention that they can download it via the button below the image.",
      });
    } catch (err: unknown) {
      const e = err as Error & { code?: string; userMessage?: string };
      if (e.code === "QUOTA") {
        return JSON.stringify({ status: "error", message: e.userMessage });
      }
      if (e.code === "NO_IMAGE") {
        return JSON.stringify({ status: "error", message: "The model refused to generate this image (it may violate policies). Try a different description.", detail: e.message });
      }
      console.error("[generate_image] failed:", e.message);
      return JSON.stringify({ status: "error", message: "Image generation failed for now, try again in a moment." });
    }
  },
});