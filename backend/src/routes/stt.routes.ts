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

// Grant-endpoint health: policy refusals pause direct-mode advertising via cooldowns.
const grantHealth = { downUntil: 0 };
const GRANT_POLICY_COOLDOWN_MS = 10 * 60_000;
const GRANT_ERROR_COOLDOWN_MS = 60_000;

// GET /api/stt/status — capability probe advertising direct mode when healthy.
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
    // Direct fields only when enabled; client appends sample_rate to listenQuery.
    ...(directHealthy ? { direct: true, listenQuery: buildListenQuery() } : {}),
  });
});

// GET /api/stt/token — ephemeral Deepgram grant enforcing quota and concurrency.
router.get("/token", sttAuxLimiter, async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!isSttEnabled()) { res.status(503).json({ error: "stt_disabled" }); return; }

  const dailyGate = await SttRelaySession.canOpenSession(userId);
  if (!dailyGate.ok) {
    res.status(dailyGate.code ?? 4029).json({ error: dailyGate.reason ?? "limit" });
    return;
  }

  // One session per user across both transports; tiny check-then-set race is fine.
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
      // Known-policy refusal answers 200 {token:null}, not a network error.
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

// POST /api/stt/usage — best-effort clamped seconds reported by direct clients.
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
