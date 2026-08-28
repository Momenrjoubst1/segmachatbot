// Response generator types: shared interfaces for stream options.

import type { Response } from "express";
import type { createProviderClient } from "../../routes/chat/chat-shared.js";
import type { CacheMetadata } from "./response-cache.service.js";
import type { CoreMessage } from "./moderation.service.js";
import type { ToolDefinition } from "../../tools/shared/types.js";

export interface StreamOptions {
  client: ReturnType<typeof createProviderClient>;
  modelName: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  finalMessages: CoreMessage[];
  finalSystemPrompt: string;
  basePersona: string;
  enabledTools: Record<string, ToolDefinition>;
  activeThreadId: string | undefined;
  userId: string | undefined;
  coreMessages: CoreMessage[];
  conversationSummary: string;
  augmentedSystemPrompt: string;
  reqMetrics: Record<string, string | number | boolean | string[] | undefined>;
  res: Response;
  cacheMetadata?: CacheMetadata;
  retrievedDocsForGrounding?: Array<{ content: string; metadata?: Record<string, unknown> }>;
  metadata?: Record<string, unknown>;
}

export type { CoreMessage };
