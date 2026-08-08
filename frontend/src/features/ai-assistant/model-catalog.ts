export const MODELS = [
  // ==========================================
  // 0. Azure OpenAI Models (ChatGPT 5.4)
  // ==========================================
  {
    name: "ChatGPT 5.4 (Azure OpenAI)",
    value: "gpt-5.4",
    icon: "/icons/openai.svg",
    disabled: false,
    contextWindow: 128_000,
    provider: "azure" as const,
  },

  // ==========================================
  // 1. GitHub Models (Free via GITHUB_TOKEN)
  // ==========================================
  {
    name: "GPT-4o Mini (GitHub)",
    value: "gpt-4o-mini", // GitHub Models routes this correctly
    icon: "/icons/github.svg",
    disabled: false,
    contextWindow: 128_000,
    provider: "github" as const,
  },
  {
    name: "GPT-4o (GitHub)",
    value: "gpt-4o", // Routed to mini in local dev to avoid GitHub rate limits
    icon: "/icons/github.svg",
    disabled: false,
    contextWindow: 128_000,
    provider: "github" as const,
  },

  // ==========================================
  // 2. Groq Models (Free & Fast via GROQ_API_KEY)
  // ==========================================
  {
    name: "Llama 3.3 70B (Groq)",
    value: "llama-3.3-70b-versatile",
    icon: "/icons/meta.svg",
    disabled: false,
    contextWindow: 128_000,
    provider: "groq" as const,
  },
  {
    name: "Mixtral 8x7B (Groq)",
    value: "mixtral-8x7b-32768",
    icon: "/icons/groq.svg", // Fallback to standard AI icon if this svg doesn't exist
    disabled: false,
    contextWindow: 32_768,
    provider: "groq" as const,
  },
  {
    name: "Gemma 2 9B (Groq)",
    value: "gemma2-9b-it",
    icon: "/icons/google.svg",
    disabled: false,
    contextWindow: 8_192,
    provider: "groq" as const,
  },

  // ==========================================
  // 3. OpenRouter Models (Free Tier via OPENROUTER_API_KEY)
  // ==========================================
  {
    name: "Gemini 2.0 Flash (Free)",
    value: "google/gemini-2.0-flash-exp:free",
    icon: "/icons/google.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Qwen 2.5 72B (Free)",
    value: "qwen/qwen-2.5-72b-instruct:free",
    icon: "/icons/qwen.svg",
    disabled: false,
    contextWindow: 32_000,
    provider: "openrouter" as const,
  },

  // ==========================================
  // 4. Fireworks Models (via FIREWORKS_API_KEY)
  // ==========================================
  {
    name: "Gemma 4 31B IT (Fireworks)",
    value: "accounts/fireworks/models/gemma-4-31b-it",
    icon: "/icons/google.svg",
    disabled: false,
    contextWindow: 262_144,
    provider: "fireworks" as const,
  },
] as const;

export type Model = (typeof MODELS)[number];
export type KnownModelId = Model["value"];
export type ModelProvider = Model["provider"];

const DEFAULT_MODEL = MODELS[0];
export const DEFAULT_MODEL_ID: KnownModelId = DEFAULT_MODEL.value;
export const DEFAULT_CONTEXT_WINDOW = DEFAULT_MODEL.contextWindow;

export function getContextWindow(modelId: string): number {
  const model = MODELS.find((m) => m.value === modelId);
  return model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

export function getModelProvider(modelId: string): ModelProvider {
  const model = MODELS.find((m) => m.value === modelId);
  return model?.provider ?? "openrouter";
}

const ACTIVE_MODELS = MODELS.filter((m) => !m.disabled);
const AVAILABLE_MODEL_IDS = new Set<KnownModelId>(
  ACTIVE_MODELS.map((m) => m.value),
);

export function isAvailableModelId(id: string): id is KnownModelId {
  return AVAILABLE_MODEL_IDS.has(id as KnownModelId);
}

export function resolveModelId(input: string | undefined): KnownModelId {
  const raw = typeof input === "string" ? input.trim() : "";
  return raw && isAvailableModelId(raw) ? raw : DEFAULT_MODEL_ID;
}
