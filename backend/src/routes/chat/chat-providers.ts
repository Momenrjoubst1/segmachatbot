// Chat providers: provider routing, client creation, effort mapping.

import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createLogger } from "../../utils/logger.js";
import { mediaAwareFetch } from "../../services/chat/media-wire.js";
import { createReasoningTapFetch, REASONING_TAP_DEFAULT_PROVIDERS } from "./chat-reasoning-tap.js";

const log = createLogger("chat-providers");

const MEDIA_AWARE_FETCH = mediaAwareFetch();

export type ProviderName = "openrouter" | "github" | "groq" | "fireworks" | "azure" | "novita" | "bigmodel" | "google" | "baichat" | "nvidia" | "cerebras";

function pickFirstAvailableProvider(
  preferred: Array<{ provider: ProviderName; envKey: string }>,
): { provider: ProviderName; reason: string } | null {
  for (const p of preferred) {
    if (process.env[p.envKey]) {
      return { provider: p.provider, reason: `${p.envKey} is set` };
    }
  }
  return null;
}

export function getProviderAndModel(modelId: string): { provider: ProviderName; modelName: string } {
  if (modelId.endsWith(":free")) {
    return { provider: "openrouter", modelName: modelId };
  }
  if (modelId === "deepseek-v4-flash") {
    // Baichat platform is unreachable; V4 Flash lives on NVIDIA NIM now.
    return { provider: "nvidia", modelName: "deepseek-ai/deepseek-v4-flash-0731" };
  }
  const GEMINI_MODELS = new Set([
    "gemini-3.7-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
  ]);
  if (GEMINI_MODELS.has(modelId)) {
    return { provider: "google", modelName: modelId };
  }
  const GLM_MODELS = new Set(["glm-4-flash"]);
  if (GLM_MODELS.has(modelId)) {
    return { provider: "bigmodel", modelName: modelId };
  }
  if (modelId === "gpt-5.4") {
    const azureConfigured = process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    if (azureConfigured) {
      return { provider: "azure", modelName: process.env.AZURE_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4" };
    }
    const fallback = pickFirstAvailableProvider([
      { provider: "github", envKey: "GITHUB_TOKEN" },
      { provider: "groq", envKey: "GROQ_API_KEY" },
      { provider: "nvidia", envKey: "NVIDIA_API_KEY" },
      { provider: "openrouter", envKey: "OPENROUTER_API_KEY" },
    ]);
    if (fallback) {
      log.warn(`gpt-5.4 requested but Azure not configured; falling back to ${fallback.provider} (qwen/qwen3.6-27b, ${fallback.reason})`);
      return { provider: fallback.provider, modelName: "qwen/qwen3.6-27b" };
    }
    return { provider: "azure", modelName: process.env.AZURE_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4" };
  }
  if (modelId === "gpt-4o") {
    // Legacy threads only — resolved to a live model by the fallback chain.
    return { provider: "openrouter", modelName: "openai/gpt-4o" };
  }
  if (modelId === "gpt-4o-mini") {
    // GitHub Models key is not configured; legacy threads land here and the
    // router's fallback chain (qwen/qwen3.6-27b) takes over on failure.
    return { provider: "github", modelName: "openai/gpt-4o-mini" };
  }
  if (
    modelId.includes("llama-") ||
    modelId.includes("mixtral") ||
    modelId.startsWith("qwen/") ||
    modelId.startsWith("openai/gpt-oss") ||
    modelId.startsWith("meta-llama/")
  ) {
    return { provider: "groq", modelName: modelId };
  }
  if (modelId.startsWith("accounts/fireworks/models/")) {
    return { provider: "fireworks", modelName: modelId };
  }
  if (modelId.includes("ling-3.0-tiny") || modelId.startsWith("inclusionai/")) {
    return { provider: "novita", modelName: modelId };
  }
  if (
    modelId.startsWith("nvidia/") ||
    modelId.startsWith("nvidia-") ||
    modelId.startsWith("deepseek-ai/")
  ) {
    return { provider: "nvidia", modelName: modelId };
  }
  if (
    modelId.startsWith("cerebras/") ||
    modelId === "llama-3.3-70b" ||
    modelId === "llama-3.1-8b"
  ) {
    return { provider: "cerebras", modelName: modelId.replace("cerebras/", "") };
  }
  return { provider: "openrouter", modelName: modelId };
}

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export function mapEffortForProvider(
  provider: ProviderName,
  modelName: string,
  effort: ReasoningEffort,
): string | undefined {
  const model = modelName.toLowerCase();
  switch (provider) {
    case "openrouter":
      return effort;
    case "azure":
      return effort === "max" ? "xhigh" : effort;
    case "groq":
      if (!model.includes("gpt-oss")) return undefined;
      return effort === "xhigh" || effort === "max" ? "high" : effort;
    case "baichat":
      return effort === "medium" || effort === "xhigh" ? "high" : effort;
    case "bigmodel":
      if (!model.includes("glm-5.2") && !model.includes("glm-5.3")) {
        return undefined;
      }
      return effort;
    default:
      return undefined;
  }
}

export function mapGoogleThinking(
  modelName: string,
  effort: ReasoningEffort,
): { thinkingLevel?: string; thinkingBudget?: number } {
  const model = modelName.toLowerCase();
  if (model.includes("gemini-2.5")) {
    const budget =
      effort === "low" ? 1024 : effort === "medium" ? 8192 : 24576;
    return { thinkingBudget: budget };
  }
  const level =
    effort === "low" ? "low" : effort === "medium" ? "medium" : "high";
  return { thinkingLevel: level };
}

function createEffortFetch(
  inner: typeof fetch,
  provider: ProviderName,
  effort: ReasoningEffort,
  modelName?: string,
): typeof fetch {
  const mapped = mapEffortForProvider(provider, modelName ?? "", effort);
  if (mapped === undefined) return inner;

  return async (input, init) => {
    const method = (
      init?.method ??
      (typeof input === "object" && input !== null && "method" in input
        ? input.method
        : "POST")
    ).toUpperCase();
    if (method !== "POST" || typeof init?.body !== "string") {
      return inner(input, init);
    }
    try {
      const parsed = JSON.parse(init.body) as Record<string, unknown>;
      if (provider === "openrouter") {
        parsed.reasoning = {
          ...(typeof parsed.reasoning === "object" && parsed.reasoning !== null
            ? parsed.reasoning
            : {}),
          effort: mapped,
        };
      } else {
        parsed.reasoning_effort = mapped;
        if (provider === "baichat" || provider === "bigmodel") {
          parsed.thinking = { type: "enabled" };
        }
      }
      return inner(input, { ...init, body: JSON.stringify(parsed) });
    } catch {
      return inner(input, init);
    }
  };
}

export function createProviderClient(
  provider: ProviderName,
  opts?: { reasoningTap?: boolean; effort?: ReasoningEffort; modelName?: string },
) {
  const baseFetch =
    opts?.effort
      ? createEffortFetch(MEDIA_AWARE_FETCH, provider, opts.effort, opts.modelName)
      : MEDIA_AWARE_FETCH;
  const fetchImpl =
    opts?.reasoningTap && REASONING_TAP_DEFAULT_PROVIDERS.has(provider)
      ? createReasoningTapFetch(baseFetch)
      : baseFetch;

  if (provider === "baichat") {
    const baichatKey = process.env.BAICHAT_API_KEY;
    if (!baichatKey) throw new Error("Missing BAICHAT_API_KEY in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://api.chat.b.ai/v1",
      apiKey: baichatKey,
    });
  }

  if (provider === "bigmodel") {
    const bigmodelKey = process.env.BIGMODEL_API_KEY;
    if (!bigmodelKey) throw new Error("Missing BIGMODEL_API_KEY in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: bigmodelKey,
    });
  }

  if (provider === "azure") {
    const azureKey = process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    const azureEndpoint = process.env.AZURE_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
    if (!azureKey) throw new Error("Missing AZURE_API_KEY / AZURE_OPENAI_API_KEY in environment");
    if (!azureEndpoint) throw new Error("Missing AZURE_ENDPOINT / AZURE_OPENAI_ENDPOINT in environment");
    
    const cleanEndpoint = azureEndpoint.replace(/\/$/, '');
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: `${cleanEndpoint}/openai/v1`,
      apiKey: azureKey,
      headers: {
        "api-key": azureKey,
      },
    });
  }

  if (provider === "github") {
    if (!process.env.GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://models.github.ai/inference",
      apiKey: process.env.GITHUB_TOKEN,
    });
  }

  if (provider === "groq") {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) throw new Error("Missing GROQ_API_KEY in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: groqKey,
    });
  }

  if (provider === "fireworks") {
    if (!process.env.FIREWORKS_API_KEY) throw new Error("Missing FIREWORKS_API_KEY in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://api.fireworks.ai/inference/v1",
      apiKey: process.env.FIREWORKS_API_KEY,
    });
  }

  if (provider === "novita") {
    if (!process.env.NOVITA_API_KEY) throw new Error("Missing NOVITA_API_KEY in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://api.novita.ai/openai",
      apiKey: process.env.NOVITA_API_KEY,
    });
  }

  if (provider === "nvidia") {
    const nvidiaKey = process.env.NVIDIA_API_KEY;
    if (!nvidiaKey) throw new Error("Missing NVIDIA_API_KEY in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: nvidiaKey,
    });
  }

  if (provider === "cerebras") {
    const cerebrasKey = process.env.CEREBRAS_API_KEY;
    if (!cerebrasKey) throw new Error("Missing CEREBRAS_API_KEY in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://api.cerebras.ai/v1",
      apiKey: cerebrasKey,
    });
  }

  if (provider === "google") {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error("Missing GEMINI_API_KEY in environment");
    return createGoogleGenerativeAI({
      apiKey: geminiKey,
    });
  }

  if (!process.env.OPENROUTER_API_KEY) throw new Error("Missing OPENROUTER_API_KEY in environment");
  return createOpenAI({
    fetch: fetchImpl,
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: {
      "HTTP-Referer": process.env.FRONTEND_URL || "http://localhost:5173",
      "X-Title": process.env.OPENROUTER_APP_NAME || "Sigma AI Chatbot",
    },
  });
}

export function createSecondModelClient() {
  const apiKey = process.env.SECOND_MODEL_API_KEY;
  const baseURL = process.env.SECOND_MODEL_BASE_URL;

  if (!apiKey) {
    return null;
  }

  return createOpenAI({
    apiKey,
    baseURL: baseURL || "https://api.openai.com/v1",
  });
}
