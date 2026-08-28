// Content moderation for chat input/output and standalone requests, via a Supabase Edge Function.

import { createLogger } from "../../utils/logger.js";
import { MAX_MESSAGE_CHARS } from "../../config/constants.js";

const log = createLogger("moderation");

// Message and moderation result types.

export interface CoreMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | Array<{ type: string; text?: string }>;
}

export interface ModerateInputResult {
  blocked: boolean;
  error?: string;
  messages: CoreMessage[];
}

export interface ModerateFullResult {
  blocked: boolean;
  censored: boolean;
  flagged: boolean;
  action: 'allow' | 'censor' | 'block';
  reason?: string;
  flaggedParts: string[];
  sanitizedContent: string;
  riskScore: number;
}

interface SupabaseModerationResponse {
  flagged?: boolean;
  action?: 'allow' | 'censor' | 'block';
  flaggedParts?: string[];
  riskScore?: number;
}

// Moderator invocation helpers.

import { extractText } from '../../utils/message-utils/extract-text.js';

/** Lazy-imports the Supabase client to avoid circular deps. */
async function getSupabase(): Promise<typeof import("../rag/rag-supabase-client.js").supabase> {
  const mod = await import("../rag/rag-supabase-client.js");
  return mod.supabase;
}

/** Calls the Supabase Edge Function with structured error handling. */
async function invokeModerator(content: string): Promise<SupabaseModerationResponse | null> {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.functions.invoke("check-content-moderation", {
      body: { content },
    });
    if (error) {
      log.warn("Content moderation invoke error", { error: error.message });
      return null;
    }
    return (data ?? null) as SupabaseModerationResponse | null;
  } catch (err) {
    log.warn("Content moderation call failed", { error: (err as Error).message });
    return null;
  }
}

// Public API used by the chat pipeline.

// Check the last user message for length and policy violations, censoring flagged content.
export async function moderateInput(
  coreMessages: CoreMessage[],
): Promise<ModerateInputResult> {
  const lastUserMsg = [...coreMessages].reverse().find(m => m.role === 'user');

  // Length check
  if (lastUserMsg) {
    const text = extractText(lastUserMsg.content);
    if (text && text.length > MAX_MESSAGE_CHARS) {
      return {
        blocked: true,
        error: "الرسالة طويلة جداً، يرجى اختصار سؤالك.",
        messages: coreMessages,
      };
    }
  }

  if (!lastUserMsg) {
    return { blocked: false, messages: coreMessages };
  }

  const lastUserText = extractText(lastUserMsg.content);
  if (!lastUserText) {
    return { blocked: false, messages: coreMessages };
  }

  // Supabase moderation
  const modResult = await invokeModerator(lastUserText);

  if (!modResult) {
    // Fail-closed when the moderator is down unless MODERATION_FAIL_OPEN=true.
    const failOpen = process.env.MODERATION_FAIL_OPEN === 'true';
    const isTest = process.env.NODE_ENV === 'test';

    if (isTest || !failOpen) {
      log.warn('Content moderation service unavailable — blocking request (fail-closed)');
      return {
        blocked: true,
        error: "Content moderation service unavailable",
        messages: coreMessages,
      };
    }

    log.warn('Content moderation service unavailable — proceeding without it (fail-open explicitly enabled)');
    return {
      blocked: false,
      messages: coreMessages,
    };
  }

  if (modResult.flagged === true && modResult.action === "block") {
    return {
      blocked: true,
      error: "Message violates content policy",
      messages: coreMessages,
    };
  }

  if (modResult.action === "censor" && Array.isArray(modResult.flaggedParts)) {
    // Return a new array with censored content instead of mutating
    const censoredMessages = coreMessages.map(coreMsg => {
      if (coreMsg.role === "user" && typeof coreMsg.content === "string") {
        let censoredContent = coreMsg.content;
        const flaggedParts = modResult.flaggedParts || [];
        for (const part of flaggedParts) {
          if (typeof part === "string" && part.length > 0) {
            // Escape regex metacharacters to prevent ReDoS / injection
            const safePart = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            censoredContent = censoredContent.replace(
              new RegExp(safePart, "gi"),
              "***",
            );
          }
        }
        return { ...coreMsg, content: censoredContent };
      }
      return coreMsg;
    });
    return { blocked: false, messages: censoredMessages };
  }

  return { blocked: false, messages: coreMessages };
}

// Check an AI response for policy violations, returning safe text when blocked.
export async function moderateOutput(
  text: string,
  userId: string,
  threadId: string,
): Promise<string> {
  const modResult = await invokeModerator(text);
  if (
    modResult?.flagged === true &&
    modResult?.action === "block"
  ) {
    log.warn("AI response flagged as harmful, replacing with safe fallback", {
      userId,
      threadId,
    });
    return "I am unable to respond to that request.";
  }
  return text;
}

// Public API exposed via the /api/moderation route.

// Full standalone moderation combining local validation with the Edge Function call.
export async function moderateFull(
  content: string,
): Promise<ModerateFullResult> {
  const validation = await import("../security/input-validator.js").then(m =>
    m.inputValidator.validate(content),
  );

  // Critical validation failure â†’ block immediately
  if (!validation.valid && validation.issues.some(i => i.severity === 'critical')) {
    const critical = validation.issues.find(i => i.severity === 'critical');
    return {
      blocked: true,
      censored: false,
      flagged: true,
      action: 'block',
      reason: critical?.message,
      flaggedParts: [],
      sanitizedContent: validation.sanitizedMessage ?? content,
      riskScore: validation.riskScore,
    };
  }

  // Supabase moderation
  const modResult = await invokeModerator(content);
  if (!modResult) {
    // Fail-closed when the moderator is down unless MODERATION_FAIL_OPEN=true.
    const failOpen = process.env.MODERATION_FAIL_OPEN === 'true';
    const isTest = process.env.NODE_ENV === 'test';

    if (isTest || !failOpen) {
      log.warn('Content moderation service unavailable — blocking request in moderateFull (fail-closed)');
      return {
        blocked: true,
        censored: false,
        flagged: true,
        action: 'block',
        reason: 'Content moderation service unavailable',
        flaggedParts: [],
        sanitizedContent: content,
        riskScore: 1.0,
      };
    }

    log.warn('Content moderation service unavailable — proceeding with local validation only (fail-open explicitly enabled)');
    return {
      blocked: false,
      censored: validation.sanitizedMessage !== undefined,
      flagged: validation.issues.length > 0,
      action: validation.sanitizedMessage ? 'censor' : 'allow',
      flaggedParts: [],
      sanitizedContent: validation.sanitizedMessage ?? content,
      riskScore: validation.riskScore,
    };
  }

  if (modResult.flagged === true && modResult.action === 'block') {
    return {
      blocked: true,
      censored: false,
      flagged: true,
      action: 'block',
      flaggedParts: modResult.flaggedParts ?? [],
      sanitizedContent: content,
      riskScore: modResult.riskScore ?? validation.riskScore,
    };
  }

  if (modResult.action === 'censor' && Array.isArray(modResult.flaggedParts)) {
    let sanitized = content;
    for (const part of modResult.flaggedParts) {
      if (typeof part === 'string' && part.length > 0) {
        const safePart = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        sanitized = sanitized.replace(new RegExp(safePart, 'gi'), '***');
      }
    }
    return {
      blocked: false,
      censored: sanitized !== content,
      flagged: true,
      action: 'censor',
      flaggedParts: modResult.flaggedParts,
      sanitizedContent: sanitized,
      riskScore: modResult.riskScore ?? validation.riskScore,
    };
  }

  return {
    blocked: false,
    censored: validation.sanitizedMessage !== undefined,
    flagged: validation.issues.length > 0,
    action: 'allow',
    flaggedParts: [],
    sanitizedContent: validation.sanitizedMessage ?? content,
    riskScore: modResult.riskScore ?? validation.riskScore,
  };
}
