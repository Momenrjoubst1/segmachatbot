/**
 * Centralized Constants - جميع الأرقام السحرية في مكان واحد
 * يمنع تكرار الأرقام ويجعل التعديل سهلاً
 */

// ==========================================
// Message / Content Limits
// ==========================================
export const MAX_MESSAGE_CHARS = 32_000;           // حد طول الرسالة (للاعتدال)
export const MAX_CHUNK_CHARS = 1_000;              // حد طول القطعة (للـ RAG)
export const OVERLAP_CHARS = 100;                  // تداخل بين القطع
export const MIN_MESSAGE_LENGTH = 10;              // أدنى طول للتلخيص
export const MAX_SUMMARY_TOKENS = 500;             // أقصى توكنات للملخص
export const MAX_CHAT_HISTORY_MESSAGES = 50;       // أقصى رسائل في السياق
export const KEEP_FIRST_MESSAGES = 5;              // رسائل أولى تُحفظ دائماً
export const KEEP_LAST_MESSAGES = 40;              // رسائل أخيرة تُحفظ دائماً
export const MIN_MESSAGES_FOR_SUMMARY = 12;        // أدنى رسائل قبل التلخيص

// ==========================================
// PDF Processing
// ==========================================
export const MAX_PDF_PAGES = 800;                  // أقصى صفحات للـ PDF
export const MAX_PDF_BYTES = 500 * 1024 * 1024;  // 500 MB

// ==========================================
// Layout Analysis (PDF)
// ==========================================
export const CAPTION_MAX_DIST = 90.0;
export const HEADER_ZONE = 0.085;
export const FOOTER_ZONE = 0.915;
export const FOOTNOTE_ZONE = 0.88;
export const VERTICAL_GAP_THRESHOLD = 20.0;
export const FONT_SIZE_TOLERANCE = 1.5;
export const VECTOR_MIN_AREA = 150.0;
export const VECTOR_CLUSTER_GAP = 6.0;
export const MAX_VECTOR_CLUSTERS = 60;

// ==========================================
// Timeouts (ms)
// ==========================================
export const TIMEOUTS = {
  LLM_RESPONSE: 120_000,
  EMBEDDING: 60_000,
  MODERATION: 15_000,
  DB_QUERY: 10_000,
  DB_WRITE: 15_000,
  EXTERNAL_API: 30_000,
  WEB_SEARCH: 15_000,
  MEMORY_RETRIEVAL: 8_000,
  MEMORY_EXTRACTION: 10_000,
  RAG_RETRIEVAL: 30_000,
  RAG_RERANKING: 10_000,
  PIPELINE_STEP: 10_000,
  VALIDATION: 2_000,
  INTENT_DETECTION: 3_000,
} as const;

// ==========================================
// Rate Limiting
// ==========================================
export const RATE_LIMITS = {
  GLOBAL: { windowMs: 60_000, max: 100 },
  HEALTH: { windowMs: 60_000, max: 30 },
  CHAT: { windowMs: 60_000, max: 30 },
  NEW_CHAT: { windowMs: 60_000, max: 10 },
  PROXY: { windowMs: 60_000, max: 20 },
  GUEST_CHAT: { windowMs: 3_600_000, max: 12 },  // 1 hour
  GUEST_STATUS: { windowMs: 60_000, max: 60 },
  TRANSLATE: { windowMs: 60_000, max: 30 },
  CODE_EXECUTE: { windowMs: 60_000, max: 10 },
} as const;

export const MAX_GUEST_MESSAGES = 4;
export const GUEST_WINDOW_MS = 24 * 60 * 60 * 1000;

// ==========================================
// Cache / TTL
// ==========================================
export const CACHE_TTL = {
  AUTH_SESSION: 300,           // 5 min
  L1_AUTH: 30_000,             // 30 sec
  BM25_EMBEDDING: 3_600,       // 1 hour
  BM25_RESULTS: 1_800,         // 30 min
  RAG_EMBEDDING: 3_600,        // 1 hour
  RAG_RESULTS: 1_800,          // 30 min
  RESPONSE_CACHE: 3_600,       // 1 hour
  RESPONSE_INDEX: 86_400,      // 24 hours
  USER_TEXTBOOK_SIGNAL: 60,    // 1 min
  THREAD_FILE: 24 * 3_600,     // 24 hours
  PENDING_FILE: 3_600,         // 1 hour
  THREAD_OWNER: 300,           // 5 min
  THREAD_OWNER_NEGATIVE: 60,   // 1 min
  CIRCUIT_BREAKER: 60_000,     // 1 min
  CLEANUP_INTERVAL: 30 * 60_000, // 30 min
} as const;

// ==========================================
// Circuit Breaker
// ==========================================
export const CIRCUIT_BREAKER = {
  THRESHOLD: 5,
  RESET_TIMEOUT: 60_000,
  MONITORING_PERIOD: 60_000,
  MAX_CONSECUTIVE_ERRORS: 10,
  BASE_BACKOFF: 1_000,
  WORKER_COOLDOWN: 60_000,
} as const;

// ==========================================
// RAG / Search
// ==========================================
export const RAG_CONFIG = {
  MATCH_THRESHOLD: 0.5,
  INITIAL_MATCH_COUNT: 15,
  FINAL_MATCH_COUNT: 5,
  TEXTBOOK_MATCH_THRESHOLD: 0.05,
  SIMILARITY_THRESHOLD: 0.92,
  MIN_QUERY_LENGTH: 5,
  MIN_RESPONSE_LENGTH: 20,
  MAX_RESPONSE_LENGTH: 10_000,
  CACHE_MAX_SIZE: 500,
  ENABLED: true,
  EMBEDDING_TTL: 3_600,
  RESULTS_TTL: 1_800,
} as const;

export const BM25_CONFIG = {
  K1: 1.5,
  B: 0.75,
  STOP_WORDS: (() => {
    const env = process.env.BM25_STOP_WORDS;
    if (!env) return [];
    try {
      return JSON.parse(env) as string[];
    } catch {
      return [];
    }
  })(),
} as const;

// ==========================================
// Memory
// ==========================================
export const MEMORY_CONFIG = {
  MAX_FACTS_PER_USER: 100,
  MIN_MESSAGES_FOR_EXTRACTION: 6,
  MAX_EXTRACTIONS_PER_SESSION: 5,
  MAX_FACT_AGE_DAYS: 90,
  CROSS_SESSION_MAX_CHATS: 10,
  CROSS_SESSION_MAX_AGE_DAYS: 30,
  CROSS_SESSION_MAX_ENTRY_AGE_DAYS: 30,
  CACHE_TTL: 3_600,
  CACHE_MIN_SIZE: 1_000,
  CACHE_MAX_SIZE: 100,
  MEMORY_CLEANUP_INTERVAL: 24 * 60 * 60 * 1_000, // 24 hours
  debug: {
    enabled: process.env.MEMORY_DEBUG === 'true',
  },
} as const;

// ==========================================
// Textbook
// ==========================================
export const TEXTBOOK_CONFIG = {
  MAX_FILE_SIZE: 500 * 1024 * 1024,  // 500 MB
  EMBEDDING_BATCH_SIZE: 20,
  EMBEDDING_DELAY_MS: 1_000,
  EMBEDDING_MAX_RETRIES: 3,
  // Embedding dimension target. Must be <= 2000 for pgvector HNSW indexing.
  // gemini-embedding-001 returns 3072 natively; MRL truncation to 1536 retains
  // near-identical retrieval quality (see embedding-service fitToTargetDim).
  // Override via EMBEDDING_TARGET_DIM env var. DB columns must match this value.
  EXPECTED_DIMENSIONS: parseInt(process.env.EMBEDDING_TARGET_DIM || "1536", 10),
  LOCK_TTL_SECONDS: 1_800,
  JOB_TIMEOUT: 3_600,
  SWEEP_INTERVAL_MS: 3_600_000,    // 1 hour
  MAX_RETRIES: 3,
  SHUTDOWN_TIMEOUT_MS: 30_000,
  MATCH_THRESHOLD: 0.05,
  // Semantic chunking: re-split chunks at topic boundaries detected by
  // embedding cosine distance.  Disabled by default (costs ~2x embedding
  // API calls in the initial pass).
  ENABLE_SEMANTIC_CHUNKING: process.env.ENABLE_SEMANTIC_CHUNKING === 'true',
  SEMANTIC_CHUNK_SIM_THRESHOLD: 0.65,  // cosine distance threshold for topic shift
  SEMANTIC_CHUNK_MIN_CHARS: 200,       // don't split chunks smaller than this
} as const;

// ==========================================
// File / Image
// ==========================================
export const FILE_CONFIG = {
  MAX_PROXY_BYTES: 5 * 1024 * 1024,  // 5 MB
  MAX_CODE_LENGTH: 50_000,
  MAX_STDIN_LENGTH: 10_000,
  MAX_OUTPUT_CHARS: 50_000,
  IMAGE_TOKEN_COST: 85,
} as const;

// ==========================================
// Model Router
// ==========================================
export const MODEL_CONFIG = {
  DEFAULT_MODEL: 'deepseek-v4-flash',
  FALLBACK_MODEL: 'gpt-4o-mini',
  VISION_MODEL: 'openai/gpt-4o',
  SUMMARY_MODEL: 'gpt-4o-mini',
} as const;

// ==========================================
// Pagination
// ==========================================
export const PAGINATION = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  THREADS_MAX_LIMIT: 200,
  THREADS_DEFAULT_LIMIT: 100,
} as const;

// ==========================================
// Prompt / A/B Testing
// ==========================================
export const PROMPT_CONFIG = {
  AB_ENABLED: process.env.PROMPT_AB_ENABLED === 'true',
  AB_VARIANT: (process.env.PROMPT_AB_VARIANT as 'default' | 'concise' | 'detailed' | 'motivational' | 'auto' | undefined) ?? 'auto',
  AB_FORCE_VARIANT: process.env.PROMPT_AB_FORCE_VARIANT as 'default' | 'concise' | 'detailed' | 'motivational' | undefined,
  MAX_SYSTEM_TOKENS: process.env.PROMPT_MAX_TOKENS ? parseInt(process.env.PROMPT_MAX_TOKENS, 10) : undefined,
  METRICS_ENABLED: process.env.PROMPT_METRICS_ENABLED !== 'false',
} as const;

// ==========================================
// UI / Frontend
// ==========================================
export const UI_CONFIG = {
  TOAST_DURATION: 5_000,
  DRAFT_SAVE_INTERVAL: 5_000,
  KEYBOARD_OFFSET_CLAMP: 0.8,
  MESSAGE_CACHE_MAX: 50,
} as const;

// ==========================================
// Embedding Provider
// ==========================================
export const EMBEDDING_PROVIDER_CONFIG = {
  RAG_EMBEDDING_PROVIDER: process.env.RAG_EMBEDDING_PROVIDER || 'google',
  BIGMODEL_API_KEY: process.env.BIGMODEL_API_KEY || '',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY || '',
  AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT || '',
  AZURE_EMBEDDING_DEPLOYMENT: process.env.AZURE_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small',
  LOCAL_EMBEDDINGS_ENABLED: process.env.LOCAL_EMBEDDINGS_ENABLED !== 'false',
  LOCAL_EMBEDDING_MODEL: process.env.LOCAL_EMBEDDING_MODEL || 'Xenova/paraphrase-multilingual-mpnet-base-v2',
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || '',
  NVIDIA_EMBEDDING_MODEL: process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nv-embedqa-e5-v5',
} as const;

// ==========================================
// Reranker
// ==========================================
export const RERANKER_CONFIG = {
  COHERE_API_KEY: process.env.COHERE_API_KEY || '',
  COHERE_RERANK_MODEL: process.env.COHERE_RERANK_MODEL || 'rerank-multilingual-v3.0',
  RAG_RERANKER_PROVIDER: process.env.RAG_RERANKER_PROVIDER || 'token-overlap',
  ENABLE_TEXTBOOK_RERANK: process.env.ENABLE_TEXTBOOK_RERANK !== 'false',
} as const;

// ==========================================
// Helper: Get config with env override
// ==========================================
export function getConfig<T>(key: keyof typeof CACHE_TTL, defaultValue: T): T {
  const envKey = key.toUpperCase();
  const envVal = process.env[envKey];
  if (envVal !== undefined) {
    const num = Number(envVal);
    return isNaN(num) ? defaultValue : num as T;
  }
  return defaultValue;
}
