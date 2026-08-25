import { Router, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createLogger } from "../utils/logger.js";
import {
  judgeUtterance,
  getTurnDetectorStatus,
} from "../services/voice/turn-detector.service.js";

const log = createLogger("voice-api");

const router = Router();

// Per-user limiter: semantic endpointing fires on every speech pause.
const turnLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req: Request) => {
    const userId = req.user?.id;
    if (userId) return userId;
    return ipKeyGenerator(req.ip || "unknown");
  },
});

// POST /api/voice/turn/complete — judge whether an utterance ends the turn.
router.post("/turn/complete", turnLimiter, async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text || text.length > 2000) {
    res.status(400).json({ error: "text is required (max 2000 chars)" });
    return;
  }
  res.json(await judgeUtterance(text));
});

// GET /api/voice/turn/status — turn-detector engine diagnostics.
router.get("/turn/status", async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json(getTurnDetectorStatus());
});

/**
 * POST /api/voice/agent/session — mint a signed URL for the ElevenLabs
 * Conversational AI agent (speech-to-speech pivot).
 *
 * The xi-api-key NEVER reaches the browser: this endpoint exchanges it for
 * a short-lived signed URL (15-min initiation window) that the frontend
 * feeds to @elevenlabs/react startSession({ signedUrl }).
 * Requires the env key to carry convai permissions — a TTS-scoped key gets
 * a clean 502 instead of leaking an upstream auth error.
 */
router.post("/agent/session", turnLimiter, async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const agentId = process.env.ELEVENLABS_AGENT_ID?.trim();
  const apiKey =
    process.env.ELEVENLABS_CONVAI_API_KEY?.trim() ||
    process.env.ELEVENLABS_API_KEY?.trim();
  if (!agentId || !apiKey) {
    res.status(503).json({ error: "agent_disabled" });
    return;
  }

  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": apiKey } },
    );
    if (!upstream.ok) {
      const body = await upstream.text();
      const permission = body.includes("missing_permissions");
      log.warn("Agent signed-url mint failed", { status: upstream.status, permission });
      res.status(502).json({
        error: permission ? "agent_key_permissions" : "agent_session_failed",
      });
      return;
    }
    const { signed_url } = (await upstream.json()) as { signed_url?: string };
    if (!signed_url) {
      res.status(502).json({ error: "agent_session_failed" });
      return;
    }
    res.json({ signedUrl: signed_url });
  } catch (err) {
    log.warn("Agent signed-url request threw", { error: (err as Error)?.message });
    res.status(502).json({ error: "agent_session_failed" });
  }
});

export default router;
