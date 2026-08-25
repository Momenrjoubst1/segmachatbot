import { Router, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { isSttEnabled } from "../ws/stt-ws.js";
import {
  DAILY_MINUTES_LIMIT,
  STT_MODEL,
  STT_LANGUAGE,
  buildListenQuery,
  SttRelaySession,
  addUsedSeconds,
} from "../services/stt/deepgram-relay.js";
import redis from "../config/redis/client.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("stt-api");
const router = Router();

/** Shared limiter for the cheap token/usage endpoints. */
const sttAuxLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req: Request) => {
    const userId = req.user?.id;
    if (userId) return userId;
    return ipKeyGenerator(req.ip || "unknown");
  },
});

/**
 * Grant-endpoint health. When Deepgram rejects token minting (403/402 =
 * plan/scope policy on this API key), stop ADVERTISING direct mode and
 * stop hammering the endpoint every session start; the relay keeps serving
 * STT unchanged. Policy failures cool down long, transient ones briefly.
 */
const grantHealth = { downUntil: 0 };
const GRANT_POLICY_COOLDOWN_MS = 10 * 60_000;
const GRANT_ERROR_COOLDOWN_MS = 60_000;

/**
 * Capability probe for the dictation mic button.
 * 200 {enabled:false} when DEEPGRAM_API_KEY is missing — clients hide the
 * button instead of opening a doomed WebSocket.
 *
 * `direct` advertises the browser→Deepgram path: the client opens the
 * listen socket straight to Deepgram using an ephemeral grant token
 * (/api/stt/token), skipping both relay hops — this halves transcript
 * round-trip latency for users far from the server.
 */
router.get("/status", (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const enabled = isSttEnabled();
  const directHealthy =
    enabled && !!process.env.DEEPGRAM_API_KEY && Date.now() >= grantHealth.downUntil;
  res.json({
    enabled,
    provider: "deepgram",
    model: STT_MODEL,
    dailyMinutesLimit: DAILY_MINUTES_LIMIT,
    // Direct-mode fields are only meaningful when enabled; listenQuery is
    // everything except sample_rate, which the client appends after it
    // knows its AudioContext's true post-decimation rate.
    ...(directHealthy ? { direct: true, listenQuery: buildListenQuery() } : {}),
  });
});

/**
 * GET /api/stt/token — ephemeral Deepgram grant token for DIRECT streaming.
 *
 * All enforcement happens HERE, at grant time:
 *   - daily minutes budget (same gate as the relay), and
 *   - one concurrent session per user via the SAME redis key the relay uses,
 *     so relay and direct sessions block each other symmetrically.
 * The token lives ~30s (Deepgram-side TTL) and grants LISTEN-only access on
 * our project key — no way to read audio or burn transcription beyond a
 * single live session. Disconnect detection is best-effort: usage is
 * reported back by the client via /api/stt/usage instead of socket close.
 */
router.get("/token", sttAuxLimiter, async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!isSttEnabled()) { res.status(503).json({ error: "stt_disabled" }); return; }

  const dailyGate = await SttRelaySession.canOpenSession(userId);
  if (!dailyGate.ok) {
    res.status(dailyGate.code ?? 4029).json({ error: dailyGate.reason ?? "limit" });
    return;
  }

  // Mirror the relay's concurrency contract: one session per user across
  // BOTH transports (the relay uses this same key). Check-then-set has a
  // millisecond race window — acceptable for a per-user voice slot.
  const existingHolder = await redis.get(`stt:active:${userId}`).catch(() => null);
  if (existingHolder) {
    res.status(4029).json({ error: "already_streaming" });
    return;
  }
  // TTL covers a vanished client; max session is far shorter.
  await redis.set(`stt:active:${userId}`, "direct", "EX", 300).catch(() => {});

  try {
    const grantRes = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY!.trim()}` },
    });
    if (!grantRes.ok) {
      await redis.del(`stt:active:${userId}`).catch(() => {});
      const policy = grantRes.status === 403 || grantRes.status === 402;
      const cooldown = policy ? GRANT_POLICY_COOLDOWN_MS : GRANT_ERROR_COOLDOWN_MS;
      grantHealth.downUntil = Date.now() + cooldown;
      log.warn("Deepgram grant failed — direct mode paused", {
        status: grantRes.status,
        pauseMinutes: cooldown / 60_000,
      });
      // Known-policy refusal: answer 200 with no token so browsers don't
      // paint network-error noise for a fully expected fallback path.
      if (policy) { res.json({ token: null }); return; }
      res.status(502).json({ error: "grant_failed" });
      return;
    }
    const grant = (await grantRes.json()) as { token?: string };
    if (!grant.token) {
      await redis.del(`stt:active:${userId}`).catch(() => {});
      grantHealth.downUntil = Date.now() + GRANT_ERROR_COOLDOWN_MS;
      res.json({ token: null });
      return;
    }
    grantHealth.downUntil = 0; // healthy again — re-advertise direct
    res.json({ token: grant.token });
  } catch (err) {
    await redis.del(`stt:active:${userId}`).catch(() => {});
    grantHealth.downUntil = Date.now() + GRANT_ERROR_COOLDOWN_MS;
    log.warn("Deepgram grant request threw", { error: (err as Error)?.message });
    res.status(502).json({ error: "grant_failed" });
  }
});

/**
 * POST /api/stt/usage — client-reported seconds for DIRECT sessions
 * (there is no relay socket whose lifetime can be metered server-side).
 * Best-effort and clamped; abuse shifts at most the user's own budget.
 */
router.post("/usage", sttAuxLimiter, async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const raw = Number(req.body?.seconds);
  const seconds = Number.isFinite(raw) ? Math.max(0, Math.min(600, Math.round(raw))) : 0;
  await addUsedSeconds(userId, seconds);
  // Session over — free the concurrency slot either way.
  await redis.del(`stt:active:${userId}`).catch(() => {});
  res.json({ ok: true });
});

export default router;
