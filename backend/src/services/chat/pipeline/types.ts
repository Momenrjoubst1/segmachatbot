// Shared types the chat pipeline steps exchange with the orchestrator.

import type { Request, Response } from "express";
import type { ChatMessageInput } from "../../../validators/chat-validation-schemas.js";
import type { CoreMessage } from "../moderation.service.js";
import type { IntentResult } from "../intent-detector.js";
import type { CacheMetadata } from "../response-cache.service.js";

// Core message shape

export type { CoreMessage };

// Pipeline context

// Request-scoped metrics tracked across all pipeline steps.
export interface RequestMetrics {
  startTime: number;
  model: string;
  ragSuccess: boolean;
  ragDocsCount: number;
  ragSources: string[];
  totalTimeMs: number;
  imageAnalysisFailed?: boolean;
  imageAnalysisError?: string;
  intent?: string;
  intentConfidence?: number;
  cacheHit?: boolean;
  uiActionInjected?: boolean;
  threadReused?: boolean;
  /** Prompt A/B variant used for this request */
  promptVariant?: string;
  /** System prompt length in chars */
  promptLength?: number;
  /** Estimated system prompt tokens (≈ chars/4) */
  promptTokensEstimate?: number;
  /** Time spent building the system prompt (ms) */
  promptBuildTimeMs?: number;
  [key: string]: string | number | boolean | string[] | undefined;
}

/** A ranked document returned by the RAG pipeline. */
export interface RankedDoc {
  id: string | number;
  content: string;
  metadata: {
    source?: string;
    source_url?: string;
    file_name?: string;
    [key: string]: unknown;
  };
  similarity: number;
  rerankScore: number;
}

/** A user course row, as returned from Supabase. */
export interface StudentCourse {
  course_name: string;
  credit_hours: number;
}

/** RAG context ready to be embedded into the system prompt. */
export interface RagContextData {
  hasContext: boolean;
  contextText: string;
  sourceNames: string[];
  retrievalMethod: 'vector' | 'bm25' | 'hybrid' | 'structure_scope' | 'curriculum';
}

/** Aggregate of every result the steps produce — passed forward to the next step. */
export interface PipelineContext {
  req: Request;
  res: Response;
  userId: string;
  body: ChatMessageInput & {
    messages: unknown[];
    system?: string;
    tools?: unknown;
    model?: string;
    config?: { modelName?: string };
    data?: { modelName?: string };
    ragEnabled?: boolean;
  };
  /** Model the request will use, after validation/normalisation. */
  selectedModel: string;
  /** Resolved provider + model name. */
  provider: string;
  modelName: string;
  metrics: RequestMetrics;
  /** Validated core messages (after processMessages + moderateInput). */
  coreMessages: CoreMessage[];
  /** Convenience: did the last message contain images? */
  hasImages: boolean;
  /** Detected intent — null when detection was skipped or failed. */
  intentResult: IntentResult | null;
  /** User courses context string, ready to inject into the system prompt. */
  userCoursesContext: string;
  /** RAG results — undefined when RAG is disabled or returned nothing. */
  ragContext: RagContextData | undefined;
  /** Memory prompt — empty when memory was skipped or failed. */
  memoryPrompt: string;
  /** Final system prompt (after all layers). */
  systemPrompt: string;
  /** Base persona string (kept for critic agent). */
  basePersona: string;
  /** Thread ID resolved by step 7 (created or reused). */
  activeThreadId: string | undefined;
  /** Cached-response metadata, set by the RAG step. */
  cacheMetadata: CacheMetadata | undefined;
  /** Ranked docs — kept for the post-stream grounding check. */
  rankedDocsForGrounding: RankedDoc[];
  /** The conversation summary injected by step 9, if any. */
  conversationSummary: string;
}
