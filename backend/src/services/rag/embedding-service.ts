import { embed, embedMany } from "ai";
import { google } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import dotenv from "dotenv";
import path from "path";
import { createLogger } from '../../utils/logger.js';

const log = createLogger('embedding');

const envPath = path.resolve(process.cwd(), "../.env.local");
dotenv.config({ path: envPath });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

// Alias GOOGLE_API_KEY → GOOGLE_GENERATIVE_AI_API_KEY for @ai-sdk/google compatibility.
// This runs once at import time and is intentional: the Google AI SDK expects the
// longer env var name, but the project commonly uses GOOGLE_API_KEY. Testing
// implications: tests that set GOOGLE_API_KEY before importing this module will
// see the alias applied automatically.
if (process.env.GOOGLE_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_API_KEY;
}

const TARGET_DIM = 768;

function fitToTargetDim(vector: number[]): number[] {
  if (vector.length === TARGET_DIM) return vector;
  if (vector.length > TARGET_DIM) return vector.slice(0, TARGET_DIM);
  return vector.concat(Array(TARGET_DIM - vector.length).fill(0));
}

interface EmbeddingProvider {
  name: string;
  embed(text: string): Promise<number[]>;
  embedMany(texts: string[]): Promise<number[][]>;
}

const googleProvider: EmbeddingProvider = {
  name: "google",
  embed: async (text: string) => {
    const model = google.textEmbeddingModel("gemini-embedding-001");
    const { embedding } = await embed({ model, value: text });
    return fitToTargetDim(embedding);
  },
  embedMany: async (texts: string[]) => {
    const model = google.textEmbeddingModel("gemini-embedding-001");
    const { embeddings } = await embedMany({ model, values: texts });
    return embeddings.map(fitToTargetDim);
  },
};

function createGitHubProvider(): EmbeddingProvider | null {
  if (!process.env.GITHUB_TOKEN) return null;
  const client = createOpenAI({
    baseURL: "https://models.github.ai/inference",
    apiKey: process.env.GITHUB_TOKEN,
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
  const key = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = process.env.AZURE_EMBEDDING_DEPLOYMENT || "text-embedding-3-small";
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

function toVector(output: any): number[] {
  if (!output) return [];
  if (Array.isArray(output)) return output as number[];
  if (output?.data) return Array.from(output.data as ArrayLike<number>);
  if (typeof output?.tolist === "function") {
    const list = output.tolist();
    return Array.isArray(list) ? (Array.isArray(list[0]) ? list[0] : list) : [];
  }
  return [];
}

function toVectors(output: any): number[][] {
  if (!output) return [];
  if (Array.isArray(output)) {
    return output.map((item) => toVector(item)).filter((v) => v.length > 0);
  }
  if (output?.data && Array.isArray(output?.dims) && output.dims.length === 2) {
    const [batch, dim] = output.dims as number[];
    const data = Array.from(output.data as ArrayLike<number>);
    const vectors: number[][] = [];
    for (let i = 0; i < batch; i += 1) {
      vectors.push(data.slice(i * dim, (i + 1) * dim));
    }
    return vectors;
  }
  if (typeof output?.tolist === "function") {
    const list = output.tolist();
    if (Array.isArray(list) && Array.isArray(list[0])) return list as number[][];
    if (Array.isArray(list)) return [list as number[]];
  }
  const single = toVector(output);
  return single.length > 0 ? [single] : [];
}

function createLocalProvider(): EmbeddingProvider | null {
  if (process.env.LOCAL_EMBEDDINGS_ENABLED === "false") return null;

  const modelId =
    process.env.LOCAL_EMBEDDING_MODEL ||
    "Xenova/paraphrase-multilingual-mpnet-base-v2";

  let extractorPromise: Promise<any> | null = null;
  const getExtractor = async () => {
    if (!extractorPromise) {
      const { pipeline } = await import("@xenova/transformers");
      extractorPromise = pipeline("feature-extraction", modelId);
      log.info(`[Embedding] Loading local model: ${modelId}`);
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

const githubProvider = createGitHubProvider();
const azureProvider = createAzureProvider();
const localProvider = createLocalProvider();

const providers: EmbeddingProvider[] = [
  googleProvider,
  ...(githubProvider ? [githubProvider] : []),
  ...(azureProvider ? [azureProvider] : []),
  ...(localProvider ? [localProvider] : []),
];

let lastActiveProvider: EmbeddingProvider | null = null;
let lastActiveProviderName: string | null = null;

function getPreferredProvider(): EmbeddingProvider {
  if (lastActiveProvider) return lastActiveProvider;

  const envPreference = process.env.RAG_EMBEDDING_PROVIDER?.toLowerCase();
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
