import { Router, type Request, type Response } from "express";
import { isSttEnabled } from "../ws/stt-ws.js";
import { DAILY_MINUTES_LIMIT } from "../services/stt/deepgram-relay.js";

const router = Router();

/**
 * Capability probe for the dictation mic button.
 * 200 {enabled:false} when DEEPGRAM_API_KEY is missing — clients hide the
 * button instead of opening a doomed WebSocket.
 */
router.get("/status", (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json({
    enabled: isSttEnabled(),
    provider: "deepgram",
    model: "nova-3",
    dailyMinutesLimit: DAILY_MINUTES_LIMIT,
  });
});

export default router;