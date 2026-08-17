/**
 * Step 1 — Request validation
 *
 * Validates the request body against `chatMessageSchema`, normalises
 * the model selection, and prepares the per-request metrics object.
 */

import { chatMessageSchema } from "../../../validators/chat-validation-schemas.js";
import { log, DEFAULT_MODEL, ALLOWED_MODELS } from "../../../routes/chat/chat-shared.js";
import type { RequestMetrics } from "./types.js";

export interface ValidationStepResult {
  ok: true;
  selectedModel: string;
  userId: string;
  metrics: RequestMetrics;
  messages: Record<string, unknown>[];
  ragEnabled: boolean;
  threadId: string | undefined;
  courseId: string | undefined;
  clientChatGuid: string | undefined;
  modelFallback?: { from: string; to: string };
}

export interface ValidationStepFailure {
  ok: false;
  status: 400 | 401;
  payload: Record<string, unknown>;
}

export type ValidationStepOutcome = ValidationStepResult | ValidationStepFailure;

export function validateAndPrepareRequest(req: {
  body: Record<string, unknown>;
  user?: { id: string };
}): ValidationStepOutcome {
  // ---- Schema validation ----
  const validation = chatMessageSchema.safeParse(req.body ?? {});
  if (!validation.success) {
    log.warn("Invalid chat payload", { issues: validation.error.issues });
    return {
      ok: false,
      status: 400,
      payload: {
        error: "Invalid request body",
        details: validation.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      },
    };
  }

  // ---- Auth check ----
  const userId = req.user?.id;
  if (!userId) {
    log.warn("Unauthorized POST /api/chat — missing or invalid user");
    return { ok: false, status: 401, payload: { error: "Unauthorized" } };
  }

  const body = req.body as {
    messages?: unknown[];
    model?: string;
    config?: { modelName?: string };
    data?: { modelName?: string };
    ragEnabled?: boolean;
  };

  // ---- Model resolution ----
  const requestedModel =
    body.model
    || body.config?.modelName
    || (req.body as { modelName?: string }).modelName
    || body.data?.modelName;

  let selectedModel = requestedModel || DEFAULT_MODEL;
  let modelFallback: { from: string; to: string } | undefined;
  
  if (!ALLOWED_MODELS.includes(selectedModel)) {
    log.warn(
      `Rejected unauthorized model request: ${selectedModel}, falling back to DEFAULT_MODEL`,
    );
    modelFallback = { from: selectedModel, to: DEFAULT_MODEL };
    selectedModel = DEFAULT_MODEL;
  }

  if (!Array.isArray(body.messages)) {
    log.error("Invalid request: messages[] is required");
    return {
      ok: false,
      status: 400,
      payload: { error: "messages[] is required" },
    };
  }

  const metrics: RequestMetrics = {
    startTime: Date.now(),
    model: selectedModel,
    ragSuccess: false,
    ragDocsCount: 0,
    ragSources: [],
    totalTimeMs: 0,
  };

  log.info("Request received", {
    model: selectedModel,
    messageCount: body.messages.length,
    ragEnabled: body.ragEnabled !== false,
  });

  return {
    ok: true,
    selectedModel,
    userId,
    metrics,
    messages: body.messages as Record<string, unknown>[],
    ragEnabled: body.ragEnabled !== false,
    threadId: validation.data.threadId,
    courseId: validation.data.courseId,
    clientChatGuid: validation.data.clientChatGuid,
    modelFallback,
  };
}
