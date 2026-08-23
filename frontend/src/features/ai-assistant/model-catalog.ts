// Unified policy: every supported model runs a 1,000,000-token context window.
// Keep in sync with backend/src/services/memory/model-context.ts
export const MODELS = [
  // ==========================================
  // 0. BigModel (ZhipuAI) - GLM Models
  // ==========================================
  {
    name: "GLM-4 Flash (BigModel - Fast)",
    value: "glm-4-flash",
    icon: "/icons/bigmodel.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "bigmodel" as const,
  },
  {
    name: "GLM-5.2 (BigModel)",
    value: "glm-5.2",
    icon: "/icons/bigmodel.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "bigmodel" as const,
  },

  // ==========================================
  // 0b. Baichat (B.AI platform)
  // ==========================================
  {
    name: "DeepSeek V4 Flash (B.AI - Default)",
    value: "deepseek-v4-flash",
    icon: "/icons/openai.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "baichat" as const,
  },

  // ==========================================
  // 0c. OpenRouter (primary)
  // ==========================================
  {
    name: "Ox-Alpha (OpenRouter - Primary)",
    value: "stealth/ox-alpha",
    icon: "/icons/openrouter.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },

  // ==========================================
  // 1. Google Gemini (Direct API - Free Tier)
  // ==========================================
  {
    name: "Gemini 3.7 Flash (Google - Free)",
    value: "gemini-3.7-flash",
    icon: "/icons/google.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "google" as const,
  },
  {
    name: "Gemini 2.5 Flash (Google - Free)",
    value: "gemini-2.5-flash",
    icon: "/icons/google.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "google" as const,
  },
  {
    name: "Gemini 2.5 Pro (Google)",
    value: "gemini-2.5-pro",
    icon: "/icons/google.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "google" as const,
  },
  {
    name: "Gemini 3 Flash (Google - Latest)",
    value: "gemini-3-flash",
    icon: "/icons/google.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "google" as const,
  },
  {
    name: "Gemini 3.1 Flash-Lite (Google)",
    value: "gemini-3.1-flash-lite",
    icon: "/icons/google.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "google" as const,
  },

  // ==========================================
  // 2. Azure OpenAI Models (ChatGPT 5.4)
  // ==========================================
  {
    name: "ChatGPT 5.4 (Azure OpenAI)",
    value: "gpt-5.4",
    icon: "/icons/openai.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "azure" as const,
  },

  // ==========================================
  // 3. GitHub Models (Free via GITHUB_TOKEN)
  // ==========================================
  {
    name: "GPT-4o Mini (GitHub)",
    value: "gpt-4o-mini",
    icon: "/icons/github.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "github" as const,
  },
  {
    name: "GPT-4o (OpenRouter)",
    value: "gpt-4o",
    icon: "/icons/openrouter.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },

  // ==========================================
  // 4. Groq Models (Free & Fast via GROQ_API_KEY)
  // ==========================================
  {
    name: "Llama 3.3 70B (Groq - Fast)",
    value: "llama-3.3-70b-versatile",
    icon: "/icons/meta.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "Llama 3.1 8B (Groq - Fastest)",
    value: "llama-3.1-8b-instant",
    icon: "/icons/meta.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "Qwen 3.6 27B (Groq)",
    value: "qwen/qwen3.6-27b",
    icon: "/icons/qwen.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "GPT-OSS 120B (Groq)",
    value: "openai/gpt-oss-120b",
    icon: "/icons/openai.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "GPT-OSS 20B (Groq)",
    value: "openai/gpt-oss-20b",
    icon: "/icons/openai.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "Qwen 3 32B (Groq)",
    value: "qwen/qwen3-32b",
    icon: "/icons/qwen.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "Llama 4 Scout 17B (Groq)",
    value: "meta-llama/llama-4-scout-17b-16e-instruct",
    icon: "/icons/meta.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "Mixtral 8x7B (Groq)",
    value: "mixtral-8x7b-32768",
    icon: "/icons/mistral.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },

  // ==========================================
  // 5. OpenRouter Models (Free Tier via OPENROUTER_API_KEY)
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
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Claude 3.5 Haiku (Free)",
    value: "anthropic/claude-3.5-haiku",
    icon: "/icons/openrouter.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Nemotron 3 Ultra 550B (Free)",
    value: "nvidia/nemotron-3-ultra-550b-a55b:free",
    icon: "/icons/nvidia.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Nemotron 3.5 Lightning 30B (Free)",
    value: "nvidia/nemotron-3.5-lightning-30b-a3b:free",
    icon: "/icons/nvidia.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Nemotron 3 Super 49B (Free)",
    value: "nvidia/nemotron-3-super-49b-a49b:free",
    icon: "/icons/nvidia.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Nemotron 3 Nano 30B (Free)",
    value: "nvidia/nemotron-3-nano-30b-a3b:free",
    icon: "/icons/nvidia.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Nemotron Nano 9B V2 (Free)",
    value: "nvidia/nemotron-nano-9b-v2:free",
    icon: "/icons/nvidia.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Nemotron Nano 12B VL (Free)",
    value: "nvidia/nemotron-nano-12b-2-vl:free",
    icon: "/icons/nvidia.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Gemma 4 26B (Free)",
    value: "google/gemma-4-26b-a4b:free",
    icon: "/icons/google.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "GPT-OSS 20B (Free)",
    value: "openai/gpt-oss-20b:free",
    icon: "/icons/openai.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Laguna S 2.1 (Free)",
    value: "poolside/laguna-s-2.1:free",
    icon: "/icons/poolside.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Laguna XS 2.1 (Free)",
    value: "poolside/laguna-xs-2.1:free",
    icon: "/icons/poolside.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Dots3 Note Preview (Free)",
    value: "dots-studio/dots3-note-preview:free",
    icon: "/icons/openrouter.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "LFM2.5 2.6B (Free)",
    value: "liquid/lfm2.5-2.6b:free",
    icon: "/icons/liquid.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },

  // ==========================================
  // 6. Fireworks Models (via FIREWORKS_API_KEY)
  // ==========================================
  {
    name: "Gemma 4 31B IT (Fireworks)",
    value: "accounts/fireworks/models/gemma-4-31b-it",
    icon: "/icons/google.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "fireworks" as const,
  },

  // ==========================================
  // 7. Novita.ai Models (via NOVITA_API_KEY)
  // ==========================================
  {
    name: "Ling 3.0 Tiny (Novita)",
    value: "inclusionai/ling-3.0-tiny",
    icon: "/icons/novita.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "novita" as const,
  },

  // ==========================================
  // 8. NVIDIA NIM Models (via NVIDIA_API_KEY)
  // ==========================================
  {
    name: "Nemotron 70B (NVIDIA NIM)",
    value: "nvidia/llama-3.1-nemotron-70b-instruct",
    icon: "/icons/nvidia.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },
  {
    name: "Llama 3.3 70B (NVIDIA NIM)",
    value: "nvidia/llama-3.3-70b-instruct",
    icon: "/icons/nvidia.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },
  {
    name: "DeepSeek R1 (NVIDIA NIM)",
    value: "nvidia/deepseek-r1",
    icon: "/icons/nvidia.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },
  {
    name: "Llama 3.1 8B (NVIDIA NIM)",
    value: "meta/llama-3.1-8b-instruct",
    icon: "/icons/nvidia.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },
  {
    name: "Llama 3.1 70B (NVIDIA NIM)",
    value: "meta/llama-3.1-70b-instruct",
    icon: "/icons/nvidia.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },
  {
    name: "Qwen 2.5 72B (NVIDIA NIM)",
    value: "qwen/qwen2.5-72b-instruct",
    icon: "/icons/nvidia.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },

  // ==========================================
  // 9. Cerebras Models (via CEREBRAS_API_KEY)
  // ==========================================
  {
    name: "Llama 3.3 70B (Cerebras)",
    value: "llama-3.3-70b",
    icon: "/icons/cerebras.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "cerebras" as const,
  },
  {
    name: "Llama 3.1 8B (Cerebras - Fast)",
    value: "llama-3.1-8b",
    icon: "/icons/cerebras.svg",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "cerebras" as const,
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
