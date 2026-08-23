/**
 * Voice Agent HTTP endpoints.
 *
 *  POST /api/voice/chat/completions — Deepgram "Think" adapter (BYO LLM).
 *    Contract: OpenAI Chat Completions PROTOCOL, protected by a shared
 *    bearer secret that only Deepgram's servers receive via the Settings
 *    message. NOT Supabase JWT — Deepgram cannot obtain one.
 *
 *    Reuses the EXISTING chatbot primitives (model routing, provider client,
 *    moderation, Sigma persona prompt) plus the calendar/task TOOL SET, so a
 *    student can say "حددلي موعد بكرة العاشر" and the event actually lands.
 *    Visual-only tools (artifacts, IDE, image gen) and email are excluded:
 *    side-effectful external sends must not be triggerable by voice alone.
 *
 *    Session continuity: the relay stamps `x-sigma-session-id` on every think
 *    request. Turns buffered under that id (surviving reconnects) are merged
 *    ahead of the current session's messages so context survives network
 *    blips instead of resetting to zero.
 *
 *  GET /api/voice/agent-status — capability probe for the frontend LIVE
 *    button (JWT-authed, mounted under authMiddleware like /api/stt/status).
 */

import { randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { streamText, stepCountIs, type ModelMessage } from "ai";

import { createLogger } from "../utils/logger.js";
import {
  DEFAULT_MODEL,
  createProviderClient,
  getProviderAndModel,
} from "../routes/chat/chat-shared.js";
import { moderateInput, type CoreMessage } from "../services/chat/moderation.service.js";
import { withTimeout, TIMEOUTS } from "../utils/timeout-wrapper.js";
import {
  buildVoiceAgentSystemPrompt,
  describeVoiceConfigGaps,
  getThinkTimeoutMs,
  isVoiceAgentConfigured,
  listAgentVoices,
} from "../services/voice/agent-settings.js";
import { loadVoiceTranscript, type VoiceTurn } from "../services/voice/transcript-flush.js";
import { getToolDefinitions } from "../tools/tool-definitions-aggregator.js";
import { getToolsRequiringUserId } from "../tools/tool-metadata.js";
import { isWebSearchAvailable } from "../tools/web/search/search-engine.js";
import type { ToolDefinition } from "../tools/shared/types.js";

const log = createLogger("voice-agent");

const MAX_MESSAGES = 40;
const MAX_CONTENT_CHARS = 8_000;
const MAX_OUTPUT_TOKENS = 1024; // spoken replies must stay short
/** Agentic ceiling for tool loops — far below text chat; speech wants few hops. */
const MAX_TOOL_STEPS = 6;

/**
 * Tools a VOICE agent may use. Calendar/tasks are the product core; the rest
 * are safe read-only utilities. Everything visual or externally-sending is
 * deliberately absent (see file comment).
 */
const VOICE_TOOL_ALLOWLIST = new Set([
  "create_calendar_event",
  "update_calendar_event",
  "delete_calendar_event",
  "get_upcoming_events",
  "find_free_slots",
  "find_optimal_time",
  "get_calendar_insights",
  "create_task",
  "get_tasks",
  "update_task",
  "complete_task",
  "delete_task",
  "calculator",
  "get_time",
  "get_weather",
  "web_search",
  "find_materials",
  "get_course_info",
]);

// ---------------------------------------------------------------------------
// Shared-secret auth (timing-safe)
// ---------------------------------------------------------------------------

function authorizedBySecret(req: Request): boolean {
  const secret = process.env.VOICE_AGENT_SHARED_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.authorization || "";
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Per-IP limiter for the bearer-gated endpoint. The shared secret already
 * gates strangers out; this bounds COST damage if the secret ever leaks —
 * each hit is an LLM streaming call.
 */
const thinkLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate_limited" },
});

// ---------------------------------------------------------------------------
// Body shaping — OpenAI Chat Completions in → CoreMessage[]
// ---------------------------------------------------------------------------

interface IncomingMessage {
  role?: string;
  content?: unknown;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (p): p is { type: string; text?: string } =>
          typeof p === "object" && p !== null && (p as { type?: string }).type === "text",
      )
      .map((p) => p.text ?? "")
      .join(" ")
      .trim();
  }
  return "";
}

/** user/assistant turns only; system persona comes from OUR constant. */
function toCoreMessages(raw: unknown): { messages: CoreMessage[]; lastUserText: string } {
  const arr = Array.isArray(raw) ? (raw as IncomingMessage[]) : [];
  const messages: CoreMessage[] = [];
  let lastUserText = "";

  for (const m of arr.slice(-MAX_MESSAGES)) {
    const role = m?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = extractText(m.content).slice(0, MAX_CONTENT_CHARS);
    if (!text) continue;
    if (role === "user") lastUserText = text;
    messages.push({ role, content: text });
  }
  return { messages, lastUserText };
}

/**
 * Merge prior-conversation turns (buffered by the relay under sid) ahead of
 * this connection's history. Deepgram only knows turns since ITS session
 * started; without this merge every reconnect would amnesia-reset the bot.
 */
async function mergePriorTurns(
  req: Request,
  current: CoreMessage[],
): Promise<CoreMessage[]> {
  const sidHeader = String(req.headers["x-sigma-session-id"] || "").trim();
  if (!sidHeader || sidHeader.length > 64 || !/^[A-Za-z0-9._-]+$/.test(sidHeader)) {
    return current;
  }
  let prior: VoiceTurn[] = [];
  try {
    prior = await loadVoiceTranscript(sidHeader);
  } catch {
    return current;
  }
  if (!prior.length) return current;

  // The CURRENT session's earliest user turn repeats the first thing said
  // after a reconnect in some flows — cheap guard: drop a leading duplicate.
  const priorMsgs = prior.map((t) => ({ role: t.role, content: t.content }) as CoreMessage);
  const firstCurrent = current.find((m) => m.role === "user");
  const lastPrior = [...priorMsgs].reverse().find((m) => m.role === "user");
  if (
    firstCurrent &&
    lastPrior &&
    typeof firstCurrent.content === "string" &&
    typeof lastPrior.content === "string" &&
    firstCurrent.content.trim() === lastPrior.content.trim()
  ) {
    priorMsgs.pop();
  }

  const merged = [...priorMsgs, ...current];
  // Window cap AFTER merge so old context trims off the front, never the turn.
  return merged.slice(-MAX_MESSAGES);
}

// ---------------------------------------------------------------------------
// Voice-safe tools (calendar/tasks core + read-only utilities)
// ---------------------------------------------------------------------------

function buildVoiceTools(userId: string): Record<string, ToolDefinition> {
  const needingUserId = new Set(getToolsRequiringUserId());
  const enabled: Record<string, ToolDefinition> = {};
  for (const [name, def] of Object.entries(getToolDefinitions()) as Array<[string, ToolDefinition]>) {
    if (!VOICE_TOOL_ALLOWLIST.has(name)) continue;
    if (name === "web_search" && !isWebSearchAvailable()) continue;
    enabled[name] = needingUserId.has(name)
      ? {
          ...def,
          execute: async (args: Record<string, unknown>) =>
            def.execute({ ...args, __userId: userId }),
        }
      : def;
  }
  return enabled;
}

const VOICE_FAILURE_REPLY =
  "عذراً، صار خلل تقني بسيط هلق. جرّب تعيد سؤالك بعد لحظات.";

// ---------------------------------------------------------------------------
// Completions router (bearer-gated, mounted WITHOUT authMiddleware)
// ---------------------------------------------------------------------------

export const voiceCompletionsRouter = Router();

voiceCompletionsRouter.post(
  "/chat/completions",
  thinkLimiter,
  async (req: Request, res: Response): Promise<void> => {
    if (!authorizedBySecret(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const startedAt = Date.now();
    const body = (req.body ?? {}) as { messages?: unknown; stream?: boolean };
    const shaped = toCoreMessages(body.messages);

    if (!shaped.messages.length || !shaped.lastUserText) {
      res.status(400).json({ error: "messages with a non-empty user turn are required" });
      return;
    }

    const messages = await mergePriorTurns(req, shaped.messages);

    // Same moderation gate as text chat (fail-OPEN on infrastructure errors so
    // a moderation outage never kills live conversations).
    try {
      const modResult = await withTimeout(moderateInput(messages), {
        timeoutMs: TIMEOUTS.MODERATION,
        operationName: "voice_moderation",
      });
      if (modResult.blocked && modResult.error && !modResult.error.includes("temporarily unavailable")) {
        log.warn("Voice turn blocked by moderation", { chars: shaped.lastUserText.length });
        replyWithSpokenText(res, body.stream === true, VOICE_FAILURE_REPLY, startedAt);
        return;
      }
    } catch (err) {
      log.warn("Voice moderation unavailable — proceeding", { error: (err as Error).message });
    }

    // Tool ownership: the relay authenticates the BROWSER via Supabase JWT and
    // stamps the authenticated user into the Settings endpoint headers; that
    // header arrives here on every think call. A bare shared secret (no user
    // header) still gets chat, just no tool calls.
    const userIdForTools = sanitizeUserId(String(req.headers["x-sigma-user-id"] || ""));

    const { provider, modelName } = getProviderAndModel(DEFAULT_MODEL);
    const client = createProviderClient(provider as Parameters<typeof createProviderClient>[0]);
    const systemPrompt = buildVoiceAgentSystemPrompt();

    try {
      const result = streamText({
        model: client.chat(modelName),
        messages: messages as unknown as ModelMessage[],
        system: systemPrompt,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: Number(process.env.VOICE_AGENT_TEMPERATURE || 0.6),
        abortSignal: AbortSignal.timeout(getThinkTimeoutMs()),
        ...(userIdForTools
          ? { tools: buildVoiceTools(userIdForTools), stopWhen: stepCountIs(MAX_TOOL_STEPS) }
          : {}),
      });

      if (body.stream === true) {
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");

        const id = `chatcmpl-${randomUUID()}`;
        const created = Math.floor(Date.now() / 1000);
        const chunk = (delta: Record<string, unknown>, finish: string | null = null): string =>
          `data: ${JSON.stringify({
            id,
            object: "chat.completion.chunk",
            created,
            model: modelName,
            choices: [{ index: 0, delta, finish_reason: finish }],
          })}\n\n`;

        res.write(chunk({ role: "assistant" }));
        let any = false;
        for await (const delta of result.textStream) {
          if (!res.writable) break;
          if (!delta) continue;
          any = true;
          res.write(chunk({ content: delta }));
        }
        res.write(chunk({}, "stop"));
        res.write("data: [DONE]\n\n");
        res.end();
        log.info("voice_think_done", {
          streamed: any,
          model: modelName,
          ms: Date.now() - startedAt,
          userChars: shaped.lastUserText.length,
          historyDepth: messages.length,
        });
        return;
      }

      // Non-streaming path
      const full = await result.text;
      replyWithSpokenText(res, false, full.trim() || VOICE_FAILURE_REPLY, startedAt, modelName);
    } catch (err) {
      // NEVER 5xx a Think call: Deepgram surfaces THINK_REQUEST_FAILED and the
      // student hears silence. A short spoken apology keeps the session alive.
      log.error("voice_think_failed", { error: (err as Error).message, model: modelName });
      replyWithSpokenText(res, body.stream === true, VOICE_FAILURE_REPLY, startedAt);
    }
  },
);

function sanitizeUserId(v: string): string | null {
  return /^[0-9a-fA-F-]{8,64}$/.test(v) ? v : null;
}

function replyWithSpokenText(
  res: Response,
  asStream: boolean,
  text: string,
  startedAt: number,
  model = "fallback",
): void {
  if (asStream) {
    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const chunk = (delta: Record<string, unknown>, finish: string | null = null): string =>
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.write(chunk({ role: "assistant" }));
    res.write(chunk({ content: text }));
    res.write(chunk({}, "stop"));
    res.write("data: [DONE]\n\n");
    res.end();
  } else {
    res.status(200).json({
      id: `chatcmpl-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(startedAt / 1000),
      model,
      choices: [
        { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
      ],
    });
  }
}

// ---------------------------------------------------------------------------
// Status router (JWT-authed via authMiddleware at mount site)
// ---------------------------------------------------------------------------

export const voiceStatusRouter = Router();

voiceStatusRouter.get("/agent-status", (_req: Request, res: Response): void => {
  const env = process.env as NodeJS.ProcessEnv & Record<string, string | undefined>;
  const enabled = isVoiceAgentConfigured(env);
  const voices = listAgentVoices(env).map(({ key, label }) => ({ key, label }));
  res.json({
    enabled,
    ...(enabled ? {} : { gaps: describeVoiceConfigGaps(env) }),
    listenModel: env.VOICE_AGENT_LISTEN_MODEL?.trim() || "nova-3",
    speakProvider:
      env.VOICE_AGENT_SPEAK_PROVIDER?.trim().toLowerCase() ||
      (env.ELEVENLABS_API_KEY ? "eleven_labs" : "deepgram"),
    maxSessionSeconds: Number(env.VOICE_AGENT_MAX_SESSION_SECONDS || 300),
    dailyMinutesLimit: Number(env.VOICE_AGENT_DAILY_MINUTES_LIMIT || 45),
    // Selectable voices for the UI picker (labels only — no provider ids).
    voices,
  });
});
