export const MODELS = [
  // ==========================================
  // 0. BigModel (ZhipuAI) - GLM Models
  // ==========================================
  {
    name: "GLM-4 Flash (BigModel - Fast)",
    value: "glm-4-flash",
    icon: "/icons/bigmodel.svg",
    disabled: false,
    contextWindow: 128_000,
    provider: "bigmodel" as const,
  },
  {
    name: "GLM-5.2 (BigModel)",
    value: "glm-5.2",
    icon: "/icons/bigmodel.svg",
    disabled: false,
    contextWindow: 128_000,
    provider: "bigmodel" as const,
  },

  // ==========================================
  // 1. Azure OpenAI Models (ChatGPT 5.4)
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
  // 2. GitHub Models (Free via GITHUB_TOKEN)
  // ==========================================
  {
    name: "GPT-4o Mini (GitHub)",
    value: "gpt-4o-mini",
    icon: "/icons/github.svg",
    disabled: false,
    contextWindow: 128_000,
    provider: "github" as const,
  },
  {
    name: "GPT-4o (OpenRouter)",
    value: "gpt-4o",
    icon: "/icons/openrouter.svg",
    disabled: false,
    contextWindow: 128_000,
    provider: "openrouter" as const,
  },

  // ==========================================
  // 3. Groq Models (Free & Fast via GROQ_API_KEY)
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
    name: "Llama 3.1 8B (Groq - Fast)",
    value: "llama-3.1-8b-instant",
    icon: "/icons/meta.svg",
    disabled: false,
    contextWindow: 128_000,
    provider: "groq" as const,
  },

  // ==========================================
  // 4. OpenRouter Models (Free Tier via OPENROUTER_API_KEY)
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
  // 5. Fireworks Models (via FIREWORKS_API_KEY)
  // ==========================================
  {
    name: "Gemma 4 31B IT (Fireworks)",
    value: "accounts/fireworks/models/gemma-4-31b-it",
    icon: "/icons/google.svg",
    disabled: false,
    contextWindow: 262_144,
    provider: "fireworks" as const,
  },

  // ==========================================
  // 6. Novita.ai Models (via NOVITA_API_KEY)
  // ==========================================
  {
    name: "Ling 3.0 Tiny (Novita)",
    value: "inclusionai/ling-3.0-tiny",
    icon: "/icons/novita.svg",
    disabled: false,
    contextWindow: 262_144,
    provider: "novita" as const,
  },
] as const;

export type Model = (typeof MODELS)[number];
export type KnownModelId = Model["value"];
export type ModelProvider = Model["provider"];

const DEFAULT_MODEL = MODELS[0]; // GLM-4 Flash (BigModel - Fast)
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
