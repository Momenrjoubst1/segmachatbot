import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import {
  judgeUtterance,
  getTurnDetectorStatus,
} from "../services/voice/turn-detector.service.js";

const router = Router();

/**
 * Semantic endpointing is queried ~once per user speech pause. 60/min is
 * generous (a chatty hands-free session pauses every few seconds) while
 * capping abuse of the optional ONNX path.
 */
const turnLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? "unknown",
});

/**
 * POST /api/voice/turn/complete — { text: string } → TurnVerdict
 * Asked by the live-voice endpointer DURING the silence window so a complete
 * sentence can hand the turn over early and a mid-clause pause keeps waiting.
 */
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

/**
 * GET /api/voice/turn/status — engine diagnostics for ?voiceDebug=1.
 */
router.get("/turn/status", async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json(getTurnDetectorStatus());
});

export default router;
