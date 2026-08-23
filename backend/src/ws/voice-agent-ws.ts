/**
 * Voice Agent WebSocket relay — /ws/voice-agent?token=<supabase-jwt>&sid=<uuid>
 *
 * The browser NEVER sees the Deepgram key. Topology:
 *
 *   browser ──binary PCM16/16k──► this relay ──► wss://agent.deepgram.com/v1/agent/converse
 *          ◄─JSON events + binary PCM16/24k──      (Settings sent here, server-side)
 *
 * - Auth mirrors stt-ws exactly (JWT → supabase.getUser → ban checks).
 * - One concurrent session per user. Sessions live in a Map with a liveness
 *   sweep: a dead mobile connection (no close frame — TCP half-open) frees
 *   its slot after CLIENT_IDLE_TIMEOUT_MS of silence instead of blocking
 *   reconnects until the OS gives up on the socket.
 * - Session continuity: the browser passes a stable ?sid per conversation.
 *   Finalized turns buffer under va:transcript:<sid>; reconnects RESUME that
 *   conversation (no greeting replay; think adapter merges prior history).
 * - Binary frames pass through verbatim in both directions; JSON events are
 *   forwarded to the client untouched so the frontend owns UX decisions.
 * - Client→agent JSON is a strict whitelist ({close,set_voice,ping}):
 *   prompt/persona payloads like UpdatePrompt are NOT proxied.
 */

import type { Server as HttpServer } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket, type WebSocket as WsSocket } from "ws";

import { createLogger } from "../utils/logger.js";
import redis from "../config/redis/client.js";
import { verifyToken } from "./stt-ws.js";
import {
  buildAgentSettings,
  buildUpdateSpeakPayload,
  isVoiceAgentConfigured,
  resolveVoiceOption,
} from "../services/voice/agent-settings.js";
import {
  appendVoiceTurn,
  flushVoiceTranscriptToThread,
  hasVoiceHistory,
} from "../services/voice/transcript-flush.js";

const log = createLogger("voice-agent-ws");

const DEEPGRAM_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";

const MAX_SESSION_MS =
  parseInt(process.env.VOICE_AGENT_MAX_SESSION_SECONDS || "300", 10) * 1000;
const DAILY_MINUTES_LIMIT = parseInt(
  process.env.VOICE_AGENT_DAILY_MINUTES_LIMIT || "45",
  10,
);
const KEEPALIVE_MS = 8_000;

/** No client frames (binary audio or whitelisted JSON) for this long ⇒ zombie. */
const CLIENT_IDLE_TIMEOUT_MS = 20_000;
const LIVENESS_SWEEP_MS = 5_000;
const MAX_SID_LENGTH = 64;

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

interface LiveSession {
  userId: string;
  clientWs: WsSocket;
  startedAt: number;
  lastClientFrameAt: number;
  sid: string | null;
}
const activeSessions = new Map<string, LiveSession>();

/**
 * The redis export unions MockRedis (dev) with ioredis; INCRBY exists only on
 * the real client — dev falls back to get/set metering.
 */
const meterRedis = redis as unknown as {
  get(key: string): Promise<string | null>;
  set(key: string, val: string, mode: "EX", ttl: number): Promise<unknown>;
  incrby?(key: string, delta: number): Promise<number>;
  expire?(key: string, seconds: number): Promise<number>;
};

// Single process-wide sweeper: reaps zombie sessions whose TCP died without a
// close frame (mobile lock-screen / network switch). Without this the user's
// own reconnect gets rejected with already_streaming until the OS times out.
let sweepTimer: NodeJS.Timeout | null = null;
function ensureSweeper(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [userId, s] of activeSessions) {
      const dead =
        s.clientWs.readyState !== WebSocket.OPEN ||
        now - s.lastClientFrameAt > CLIENT_IDLE_TIMEOUT_MS;
      if (!dead) continue;
      log.info("Reaping stale voice session", {
        userId,
        idleMs: now - s.lastClientFrameAt,
        wsState: s.clientWs.readyState,
      });
      // Terminates both sockets + frees the slot; the client's backoff loop
      // reconnects into the freed slot and resumes the same sid.
      closeSession(userId, 4408, "client_timeout");
    }
    if (activeSessions.size === 0 && sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }, LIVENESS_SWEEP_MS);
  sweepTimer.unref?.();
}

/** YYYY-MM-DD in Jordan local time — the daily budget must roll at local midnight. */
function todayKey(userId: string): string {
  let ymd: string;
  try {
    ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman" }).format(new Date());
  } catch {
    const d = new Date();
    ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  return `va:minutes:${userId}:${ymd}`;
}

async function getUsedSecondsToday(userId: string): Promise<number> {
  try {
    const v = await redis.get(todayKey(userId));
    return v ? parseInt(v, 10) : 0;
  } catch {
    return 0;
  }
}

async function addUsedSeconds(userId: string, seconds: number): Promise<void> {
  const delta = Math.max(1, Math.round(seconds));
  try {
    // Atomic when the server supports INCRBY; MockRedis (dev) falls back to
    // get/set — second-accurate budgeting never needs MULTI to be honest.
    if (meterRedis.incrby) {
      await meterRedis.incrby(todayKey(userId), delta);
      await meterRedis.expire?.(todayKey(userId), 172_800);
    } else {
      const used = await getUsedSecondsToday(userId);
      await meterRedis.set(todayKey(userId), String(used + delta), "EX", 172_800);
    }
  } catch {
    /* best-effort */
  }
}

function sanitizeSid(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.length > MAX_SID_LENGTH) return null;
  // Enough for UUIDs; blocks header injection into Redis keys / think headers.
  return /^[A-Za-z0-9._-]+$/.test(v) ? v : null;
}

export function isVoiceAgentWsEnabled(): boolean {
  return (
    Boolean(process.env.DEEPGRAM_API_KEY?.trim()) && isVoiceAgentConfigured(process.env)
  );
}

/** Tear down BOTH sockets for a user and free their slot. Idempotent. */
function closeSession(userId: string, code: number, reason: string): void {
  const s = activeSessions.get(userId);
  activeSessions.delete(userId);

  if (s) {
    const elapsedSec = (Date.now() - s.startedAt) / 1000;
    void addUsedSeconds(userId, elapsedSec);

    // Persist the conversation even when WE initiate the close (duration cap,
    // reap). Fire-and-forget — teardown must never wait on Supabase.
    if (s.sid) {
      void flushVoiceTranscriptToThread(userId, s.sid).catch((err) =>
        log.warn("Voice transcript flush failed", { error: (err as Error).message, userId }),
      );
    }

    try { s.clientWs.close(code <= 1000 || code === 1000 ? 1000 : code, reason.slice(0, 120)); } catch { /* noop */ }
    s.clientWs.removeAllListeners();
  }

  log.info("Voice agent session closed", { userId, reason });
}

function handleUpgrade(
  req: import("http").IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const allowAnonDev =
    process.env.STT_ALLOW_ANON_DEV === "true" &&
    /localhost|127\.0\.0\.1/.test(req.headers.host || "");
  const token = url.searchParams.get("token") || "";
  const requestedVoice = url.searchParams.get("voice");
  const sid = sanitizeSid(url.searchParams.get("sid"));

  wss.handleUpgrade(req, socket, head, async (clientWs) => {
    if (!isVoiceAgentWsEnabled()) {
      clientWs.close(4003, "voice_agent_disabled");
      return;
    }

    const auth = await verifyToken(token, allowAnonDev, socket);
    if (!auth) {
      clientWs.close(4401, "unauthorized");
      return;
    }
    const userId = auth.userId;

    // Slot conflict: an EXISTING healthy session keeps its floor (second tab).
    // A stale one (half-open TCP, hung client) is reaped right here so the
    // legitimate reconnect succeeds immediately.
    const existing = activeSessions.get(userId);
    if (existing) {
      const stale =
        existing.clientWs.readyState !== WebSocket.OPEN ||
        Date.now() - existing.lastClientFrameAt > CLIENT_IDLE_TIMEOUT_MS;
      if (stale) {
        log.info("Replacing stale voice session on reconnect", { userId });
        closeSession(userId, 1000, "superseded");
      } else {
        clientWs.close(4029, "already_streaming");
        return;
      }
    }

    const used = await getUsedSecondsToday(userId);
    if (used >= DAILY_MINUTES_LIMIT * 60) {
      clientWs.close(4029, "daily_limit_reached");
      return;
    }

    // Resume detection MUST complete before the upstream opens: Deepgram
    // requires Settings as the FIRST message, so the open handler cannot
    // await anything before sending it.
    const resume = await hasVoiceHistory(sid);

    let upstream: WsSocket;
    try {
      upstream = new WebSocket(DEEPGRAM_AGENT_URL, {
        headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY!.trim()}` },
      });
    } catch (err) {
      log.error("Failed to create agent upstream", { error: (err as Error).message });
      clientWs.close(1011, "upstream_create_failed");
      return;
    }

    const startedAt = Date.now();
    const session: LiveSession = {
      userId,
      clientWs,
      startedAt,
      lastClientFrameAt: Date.now(),
      sid,
    };
    activeSessions.set(userId, session);
    ensureSweeper();

    let closedByUs = false;
    let keepAliveTimer: NodeJS.Timeout | null = null;
    let sessionTimer: NodeJS.Timeout | null = null;

    const closeAll = (code: number, reason: string): void => {
      if (closedByUs) return;
      closedByUs = true;
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      if (sessionTimer) clearTimeout(sessionTimer);

      if (activeSessions.get(userId) === session || !activeSessions.has(userId)) {
        closeSession(userId, code, reason);
      }

      try { upstream.close(code === 1000 ? 1000 : code, reason.slice(0, 120)); } catch { /* noop */ }
      log.info("Voice agent session closed", {
        userId,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        resumed: Boolean(sid),
        reason,
      });
    };

    // ---- Upstream (Deepgram Agent) -----------------------------------------
    upstream.on("open", () => {
      try {
        // Voice selection rides on the upgrade URL (?voice=primary|alt) so it
        // survives reconnects; unknown keys fall back to the primary voice.
        const voiceOption = resolveVoiceOption(process.env, requestedVoice);
        const built = buildAgentSettings(process.env as NodeJS.ProcessEnv, voiceOption?.key, {
          resume,
          sessionId: sid,
          userId,
        });
        upstream.send(JSON.stringify(built.settings)); // FIRST message, always
        for (const w of built.warnings) log.warn(`Voice agent config: ${w}`, { userId });

        keepAliveTimer = setInterval(() => {
          try { upstream.send(JSON.stringify({ type: "KeepAlive" })); } catch { /* closing */ }
        }, KEEPALIVE_MS);

        sessionTimer = setTimeout(() => closeAll(4028, "max_session_duration"), MAX_SESSION_MS);
        log.info("Voice agent session opened", {
          userId,
          resumed: resume,
          sid: sid ?? null,
          speakProvider: built.summary.speakProvider,
        });
      } catch (err) {
        log.error("Settings build/send failed", { error: (err as Error).message, userId });
        closeAll(1011, "settings_failed");
      }
    });

    upstream.on("message", (raw: unknown, isBinary: boolean) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      if (isBinary) {
        clientWs.send(raw as Buffer);
        return;
      }
      const text = String(raw);
      // Finalized turns feed the continuity buffer + thread persistence.
      if (sid && text.includes('"ConversationText"')) {
        try {
          const evt = JSON.parse(text) as { role?: string; content?: string };
          const role = evt.role === "assistant" ? "assistant" : "user";
          const content = typeof evt.content === "string" ? evt.content.trim() : "";
          if (content) void appendVoiceTurn(sid, { role, content });
        } catch { /* non-JSON control frame */ }
      }
      // Surface adapter failures distinctly in logs; forward everything.
      if (text.includes('"Error"') || text.includes('"Warning"')) {
        try {
          const evt = JSON.parse(text) as { type?: string; description?: string; message?: string };
          const detail = evt.description || evt.message || "";
          if (evt.type === "Error") {
            const thinkFailure = /THINK_REQUEST_FAILED|FAILED_TO_THINK/i.test(detail);
            log.warn(thinkFailure ? "Voice THINK failed (adapter?)" : "Voice agent upstream error", {
              userId,
              detail,
            });
          }
        } catch { /* non-JSON control frame */ }
      }
      clientWs.send(text);
    });

    upstream.on("error", (err) => {
      log.warn("Agent upstream error", { error: err.message, userId });
      closeAll(4502, "upstream_error");
    });

    upstream.on("close", (code, reason) => {
      if (!closedByUs) closeAll(code || 1000, `upstream_closed:${reason.toString().slice(0, 80)}`);
    });

    // ---- Downstream (browser) ----------------------------------------------
    clientWs.on("message", (data: unknown, isBinary: boolean) => {
      session.lastClientFrameAt = Date.now(); // any frame proves liveness
      if (closedByUs || upstream.readyState !== WebSocket.OPEN) return;
      if (isBinary) {
        upstream.send(data as Buffer); // mic PCM frames — verbatim
        return;
      }
      const text = String(data);
      try {
        const msg = JSON.parse(text) as { type?: string; voice?: string };
        if (msg.type === "close") {
          closeAll(1000, "client_stop");
          return;
        }
        if (msg.type === "ping") return; // liveness only
        // Voice switch: payload is built SERVER-side (credentials stay here).
        if (msg.type === "set_voice" && typeof msg.voice === "string") {
          const payload = buildUpdateSpeakPayload(process.env, msg.voice);
          if (payload && upstream.readyState === WebSocket.OPEN) {
            upstream.send(JSON.stringify(payload));
            log.info("Voice switched mid-session", { userId, voice: msg.voice });
          }
          return;
        }
        // Strict whitelist — persona/prompt payloads (UpdatePrompt etc.) are
        // deliberately NOT proxied.
      } catch { /* ignore malformed */ }
    });

    clientWs.on("close", () => closeAll(1000, "client_closed"));
    clientWs.on("error", () => closeAll(1011, "client_error"));
  });
}

export function attachVoiceAgentWebSocket(server: HttpServer): void {
  server.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try { pathname = new URL(req.url || "/", "http://localhost").pathname; } catch { /* noop */ }
    if (pathname === "/ws/voice-agent") handleUpgrade(req, socket, head);
  });
  if (!isVoiceAgentWsEnabled()) {
    log.warn("Voice agent attached but not configured — see GET /api/voice/agent-status for missing vars");
  }
  log.info("Voice agent WebSocket attached at /ws/voice-agent");
}
