import { embed, embedMany } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import dotenv from "dotenv";
import path from "path";
import { createLogger } from '../../utils/logger.js';
import { AppError, ErrorCode } from '../../utils/error-handler.js';
import { TEXTBOOK_CONFIG, EMBEDDING_PROVIDER_CONFIG } from '../../config/constants.js';

const log = createLogger('embedding');

// Accept every known Gemini key env var name (GEMINI_API_KEY is what the
// Google AI Studio docs use; the AI SDK default reads only
// GOOGLE_GENERATIVE_AI_API_KEY — this mismatch silently disabled the
// provider before).
function getGoogleApiKey(): string {
  return (
    EMBEDDING_PROVIDER_CONFIG.GOOGLE_GENERATIVE_AI_API_KEY ||
    EMBEDDING_PROVIDER_CONFIG.GEMINI_API_KEY ||
    EMBEDDING_PROVIDER_CONFIG.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ""
  );
}

let detectedDim: number | null = null;
let dimensionLogged = false;

/**
 * MRL (Matryoshka) truncation: keep the first `target` components and
 * re-normalize to unit length. Gemini/OpenAI MRL-trained embeddings retain
 * near-identical cosine similarity quality after prefix truncation.
 */
function mrlTruncate(vector: number[], target: number): number[] {
  let sumSquares = 0;
  for (let i = 0; i < target; i++) sumSquares += vector[i] * vector[i];
  const norm = Math.sqrt(sumSquares);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error(
      `MRL truncation failed: zero/normless vector (len=${vector.length})`
    );
  }
  const out = new Array<number>(target);
  for (let i = 0; i < target; i++) out[i] = vector[i] / norm;
  return out;
}

function fitToTargetDim(vector: number[]): number[] {
  const target = TEXTBOOK_CONFIG.EXPECTED_DIMENSIONS;
  if (vector.length === target) return vector;

  if (vector.length > target) {
    // Provider natively returns more dimensions than the DB stores.
    // Truncate + renormalize (MRL) instead of failing — this is what makes
    // HNSW indexing possible (pgvector limit: 2000 dims).
    if (!dimensionLogged) {
      log.info(`[Embedding] MRL truncating ${vector.length} -> ${target} dims`, {
        providerDim: vector.length,
        targetDim: target,
      });
      dimensionLogged = true;
    }
    return mrlTruncate(vector, target);
  }

  // Fewer dimensions than the DB column expects cannot be fixed here.
  const msg = `Embedding dimension mismatch: provider returned ${vector.length} dimensions but database expects ${target}. ` +
    `Set EMBEDDING_TARGET_DIM=${vector.length} or switch provider. FAILING FAST — silent padding corrupts search quality.`;
  log.error(msg, { actualDim: vector.length, targetDim: target });
  throw new Error(msg);
}

interface EmbeddingProvider {
  name: string;
  embed(text: string): Promise<number[]>;
  embedMany(texts: string[]): Promise<number[][]>;
}

const googleClient = createGoogleGenerativeAI({ apiKey: getGoogleApiKey() });

const googleProvider: EmbeddingProvider = {
  name: "google",
  embed: async (text: string) => {
    const model = googleClient.textEmbeddingModel("gemini-embedding-001");
    const { embedding } = await embed({ model, value: text });
    return fitToTargetDim(embedding);
  },
  embedMany: async (texts: string[]) => {
    const model = googleClient.textEmbeddingModel("gemini-embedding-001");
    const { embeddings } = await embedMany({ model, values: texts });
    return embeddings.map(fitToTargetDim);
  },
};
function createBigModelProvider(): EmbeddingProvider | null {
  if (!EMBEDDING_PROVIDER_CONFIG.BIGMODEL_API_KEY) return null;
  const client = createOpenAI({
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: EMBEDDING_PROVIDER_CONFIG.BIGMODEL_API_KEY,
  });
  return {
    name: "bigmodel",
    embed: async (text: string) => {
      const model = client.textEmbeddingModel("embedding-3");
      const { embedding } = await embed({ model, value: text });
      return fitToTargetDim(embedding);
    },
    embedMany: async (texts: string[]) => {
      const model = client.textEmbeddingModel("embedding-3");
      const { embeddings } = await embedMany({ model, values: texts });
      return embeddings.map(fitToTargetDim);
    },
  };
}

function createGitHubProvider(): EmbeddingProvider | null {
  if (!EMBEDDING_PROVIDER_CONFIG.GITHUB_TOKEN) return null;
  const client = createOpenAI({
    baseURL: "https://models.github.ai/inference",
    apiKey: EMBEDDING_PROVIDER_CONFIG.GITHUB_TOKEN,
  });
  return {
    name: "github",
    embed: async (text: string) => {
      const model = client.textEmbeddingModel("text-embedding-3-small");
      const { embedding } = await embed({ model, value: text });
      return fitToTargetDim(embedding);
    },
    embedMany: async (texts: string[]) => {
      const model = client.textEmbeddingModel("text-embedding-3-small");
      const { embeddings } = await embedMany({ model, values: texts });
      return embeddings.map(fitToTargetDim);
    },
  };
}

function createAzureProvider(): EmbeddingProvider | null {
  const key = EMBEDDING_PROVIDER_CONFIG.AZURE_OPENAI_API_KEY;
  const endpoint = EMBEDDING_PROVIDER_CONFIG.AZURE_OPENAI_ENDPOINT;
  const deployment = EMBEDDING_PROVIDER_CONFIG.AZURE_EMBEDDING_DEPLOYMENT;
  if (!key || !endpoint) return null;
  const client = createOpenAI({
    baseURL: `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}?api-version=2024-08-01-preview`,
    apiKey: key,
    headers: {
      "api-key": key,
    },
  });
  return {
    name: "azure",
    embed: async (text: string) => {
      const model = client.textEmbeddingModel(deployment);
      const { embedding } = await embed({ model, value: text });
      return fitToTargetDim(embedding);
    },
    embedMany: async (texts: string[]) => {
      const model = client.textEmbeddingModel(deployment);
      const { embeddings } = await embedMany({ model, values: texts });
      return embeddings.map(fitToTargetDim);
    },
  };
}

function toVector(output: unknown): number[] {
  if (!output) return [];
  if (Array.isArray(output)) return output as number[];
  const obj = output as Record<string, unknown>;
  if (obj.data) return Array.from(obj.data as ArrayLike<number>);
  if (typeof obj.tolist === "function") {
    const list = (obj.tolist as () => unknown)();
    return Array.isArray(list) ? (Array.isArray(list[0]) ? list[0] : list) : [];
  }
  return [];
}

function toVectors(output: unknown): number[][] {
  if (!output) return [];
  if (Array.isArray(output)) {
    return output.map((item) => toVector(item)).filter((v) => v.length > 0);
  }
  const out = output as Record<string, unknown>;
  if (out.data && Array.isArray(out.dims) && (out.dims as unknown[]).length === 2) {
    const [batch, dim] = out.dims as number[];
    const data = Array.from(out.data as ArrayLike<number>);
    const vectors: number[][] = [];
    for (let i = 0; i < batch; i += 1) {
      vectors.push(data.slice(i * dim, (i + 1) * dim));
    }
    return vectors;
  }
  if (typeof out.tolist === "function") {
    const list = (out.tolist as () => unknown)();
    if (Array.isArray(list) && Array.isArray(list[0])) return list as number[][];
    if (Array.isArray(list)) return [list as number[]];
  }
  const single = toVector(output);
  return single.length > 0 ? [single] : [];
}

function createLocalProvider(): EmbeddingProvider | null {
  if (!EMBEDDING_PROVIDER_CONFIG.LOCAL_EMBEDDINGS_ENABLED) return null;

  const modelId =
    EMBEDDING_PROVIDER_CONFIG.LOCAL_EMBEDDING_MODEL ||
    "Xenova/paraphrase-multilingual-mpnet-base-v2";

  interface EmbeddingPipeline {
    (input: string | string[], opts?: Record<string, unknown>): Promise<unknown>;
  }
  let extractorPromise: Promise<EmbeddingPipeline> | null = null;
  const getExtractor = async () => {
    if (!extractorPromise) {
      try {
        // @ts-ignore - Optional runtime dependency
        const { pipeline } = await import("@xenova/transformers");
        extractorPromise = pipeline("feature-extraction", modelId);
        log.info(`[Embedding] Loading local model: ${modelId}`);
      } catch (error) {
        log.error(`[Embedding] Failed to load @xenova/transformers: ${error}`);
        throw new AppError(
          "Failed to load local embedding model. The package may not be installed.",
          ErrorCode.EMBEDDING_MODEL_LOAD_FAILED,
          500
        );
      }
    }
    return extractorPromise;
  };

  return {
    name: "local",
    embed: async (text: string) => {
      const extractor = await getExtractor();
      const output = await extractor(text, { pooling: "mean", normalize: true });
      const vector = toVector(output);
      if (vector.length === 0) {
        throw new Error("Local embedding returned empty vector");
      }
      return fitToTargetDim(vector);
    },
    embedMany: async (texts: string[]) => {
      const extractor = await getExtractor();
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      let vectors = toVectors(output);

      if (vectors.length !== texts.length) {
        vectors = [];
        for (const text of texts) {
          const singleOutput = await extractor(text, { pooling: "mean", normalize: true });
          const vector = toVector(singleOutput);
          if (vector.length === 0) {
            throw new Error("Local embedding returned empty vector");
          }
          vectors.push(vector);
        }
      }

      return vectors.map(fitToTargetDim);
    },
  };
}

function createNvidiaProvider(): EmbeddingProvider | null {
  if (!EMBEDDING_PROVIDER_CONFIG.NVIDIA_API_KEY) return null;
  const apiKey = EMBEDDING_PROVIDER_CONFIG.NVIDIA_API_KEY;
  const modelId = EMBEDDING_PROVIDER_CONFIG.NVIDIA_EMBEDDING_MODEL;
  const endpoint = "https://integrate.api.nvidia.com/v1/embeddings";

  // NVIDIA NIM embedding models are asymmetric: they require `input_type`.
  // Queries use "query", stored documents use "passage" — this distinction
  // measurably improves retrieval quality. The AI SDK cannot send it, so we
  // call the OpenAI-compatible endpoint directly.
  async function callNvidia(
    texts: string[],
    inputType: "query" | "passage"
  ): Promise<number[][]> {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: texts,
        model: modelId,
        input_type: inputType,
        encoding_format: "float",
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `NVIDIA embeddings HTTP ${res.status}: ${detail.slice(0, 200)}`
      );
    }
    const json = (await res.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };
    return json.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  return {
    name: "nvidia",
    embed: async (text: string) =>
      fitToTargetDim((await callNvidia([text], "query"))[0]),
    embedMany: async (texts: string[]) => {
      const vectors = await callNvidia(texts, "passage");
      return vectors.map((v) => fitToTargetDim(v));
    },
  };
}

const nvidiaProvider = createNvidiaProvider();
const bigmodelProvider = createBigModelProvider();
const githubProvider = createGitHubProvider();
const azureProvider = createAzureProvider();
const localProvider = createLocalProvider();

const providers: EmbeddingProvider[] = [
  // NVIDIA's default embedding model (nv-embedqa-e5-v5) reached end-of-life on
  // 2026-08-25 (HTTP 410) and sat FIRST in this chain — every query burned a
  // failed call + retry before falling through, intermittently blowing the RAG
  // time budget. Only opt in when a live model is set explicitly via env.
  ...(process.env.NVIDIA_EMBEDDING_MODEL && nvidiaProvider ? [nvidiaProvider] : []),
  googleProvider,
  ...(bigmodelProvider ? [bigmodelProvider] : []),
  ...(githubProvider ? [githubProvider] : []),
  ...(azureProvider ? [azureProvider] : []),
  ...(localProvider ? [localProvider] : []),
];

let lastActiveProvider: EmbeddingProvider | null = null;
let lastActiveProviderName: string | null = null;

function getPreferredProvider(): EmbeddingProvider {
  if (lastActiveProvider) return lastActiveProvider;

  const envPreference = EMBEDDING_PROVIDER_CONFIG.RAG_EMBEDDING_PROVIDER?.toLowerCase();
  if (envPreference) {
    const preferred = providers.find((p) => p.name === envPreference);
    if (preferred) return preferred;
  }

  return providers[0];
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const preferred = getPreferredProvider();
  const orderedProviders = [preferred, ...providers.filter((p) => p !== preferred)];

  for (const provider of orderedProviders) {
    try {
      const result = await provider.embed(text);
      if (lastActiveProviderName !== provider.name) {
        log.info(`[Embedding] Switched to provider: ${provider.name}`);
        lastActiveProvider = provider;
        lastActiveProviderName = provider.name;
      }
      return result;
    } catch (err: unknown) {
      log.warn(`[Embedding] Provider ${provider.name} failed:`, err instanceof Error ? err.message : String(err));
    }
  }

  log.error("[Embedding] All providers failed. Returning null.");
  return null;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][] | null> {
  const preferred = getPreferredProvider();
  const orderedProviders = [preferred, ...providers.filter((p) => p !== preferred)];

  for (const provider of orderedProviders) {
    try {
      const result = await provider.embedMany(texts);
      if (lastActiveProviderName !== provider.name) {
        log.info(`[Embedding] Switched to provider: ${provider.name}`);
        lastActiveProvider = provider;
        lastActiveProviderName = provider.name;
      }
      return result;
    } catch (err: unknown) {
      log.warn(`[Embedding] Provider ${provider.name} failed:`, err instanceof Error ? err.message : String(err));
    }
  }

  log.error("[Embedding] All providers failed for batch. Returning null.");
  return null;
}

export function getActiveEmbeddingProvider(): string {
  return lastActiveProviderName || providers[0]?.name || "none";
}
