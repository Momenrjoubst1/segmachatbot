/**
 * Batch audio transcription via Groq (whisper-large-v3).
 *
 * Used when the answering model cannot ingest an audio attachment natively
 * (e.g. non-wav/mp3 formats on OpenAI-compatible endpoints): the transcript
 * is injected as text context instead, so any model can "hear" the file.
 *
 * Env: GROQ_API_KEY. Direct upload cap 25MB. Returns null on failure —
 * callers must degrade gracefully.
 */
import { createLogger } from "../../utils/logger.js";
import { downloadR2ObjectToBuffer } from "../textbook/r2-client.js";

const log = createLogger("groq-transcription");

const TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = process.env.GROQ_TRANSCRIBE_MODEL || "whisper-large-v3";
/** Groq direct upload limit (dev tier). */
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

function apiKey(): string | null {
  return process.env.GROQ_API_KEY || null;
}

/**
 * Transcribe an R2-hosted audio file to text.
 * `languageHint` is optional (BCP-47, e.g. "ar") — omitted for auto-detect.
 */
export async function transcribeR2Audio(
  r2Key: string,
  filename: string,
  mimeType: string,
  languageHint?: string,
): Promise<string | null> {
  const key = apiKey();
  if (!key) return null;

  try {
    const bytes = await downloadR2ObjectToBuffer(r2Key);
    if (bytes.length === 0 || bytes.length > MAX_TRANSCRIBE_BYTES) {
      log.warn("Audio outside transcription size range", { r2Key, size: bytes.length });
      return null;
    }

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType || "audio/mpeg" }), filename || "audio.mp3");
    form.append("model", MODEL);
    form.append("response_format", "json");
    if (languageHint && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(languageHint)) {
      form.append("language", languageHint);
    }

    const res = await fetch(TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) {
      log.warn("Groq transcription failed", { status: res.status, body: await res.text().catch(() => "") });
      return null;
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text || "").trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    log.warn("transcribeR2Audio error", { r2Key, error: (err as Error).message });
    return null;
  }
}
