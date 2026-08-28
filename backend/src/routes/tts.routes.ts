import { Router, type Request, type Response } from "express";
import {
  synthesize,
  TtsUnavailableError,
  sanitizeForSpeech,
} from "../services/tts-service.js";
import { publicPersonas } from "../config/voice-personas.js";

const router = Router();

// Persona catalog for the voice picker (public, no user data).
router.get("/voices", (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({ personas: publicPersonas() });
});

// POST / — synthesize text to persona MP3; legacy voiceId accepted as alias.
router.post("/", async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rawText =
    typeof req.body?.text === "string" ? req.body.text : "";
  const voiceId =
    typeof req.body?.personaId === "string"
      ? req.body.personaId
      : typeof req.body?.voiceId === "string"
        ? req.body.voiceId
        : undefined;

  if (!sanitizeForSpeech(rawText)) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  try {
    const { audio, persona } = await synthesize(rawText, voiceId);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(audio.length));
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Voice-Persona", persona.id);
    res.status(200).send(audio);
  } catch (err) {
    if (err instanceof TtsUnavailableError) {
      res.status(503).json({ error: "tts_unavailable" });
      return;
    }
    res.status(500).json({ error: "tts_failed" });
  }
});

export default router;
