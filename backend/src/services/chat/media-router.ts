/**
 * Media router — capability-aware routing of chat attachments.
 *
 * Decides, per answering model, how each attached video/audio/document reaches
 * the LLM:
 *   - gemini-* models   → native file parts (inline dataURL or Gemini Files API
 *                          fileUri staged server-side for large media).
 *   - capable OpenAI-compatible models (e.g. stealth/ox-alpha via OpenRouter)
 *                       → short text sentinels whose payloads are rewritten
 *                         into `video_url` / `input_audio` blocks on the wire
 *                         (see media-wire.ts) — the stock @ai-sdk/openai
 *                         converter throws on video parts, so it never sees them.
 *   - audio elsewhere   → Groq Whisper transcript injected as text context.
 *
 * Capabilities come from MODEL_MEDIA_CAPABILITIES env JSON, e.g.
 *   {"stealth/ox-alpha":["video","audio"],"gemini-*":["video","audio"]}
 * Defaults cover the gemini family plus ox-alpha.
 */
import { createLogger } from "../../utils/logger.js";
import { registerMediaPayload } from "./media-registry.js";
import { stageMediaForGemini } from "../media/gemini-files.js";
import { transcribeR2Audio } from "../media/transcription.js";
import { downloadR2ObjectToBuffer, presignR2Get, statR2Object } from "../textbook/r2-client.js";

const log = createLogger("media-router");

// ── capabilities ────────────────────────────────────────────────────────────

const DEFAULT_CAPABILITIES: Record<string, Array<"video" | "audio">> = {
  "gemini-*": ["video", "audio"],
  "stealth/ox-alpha": ["video", "audio"],
};

function loadCapabilities(): Record<string, Array<"video" | "audio">> {
  try {
    const raw = process.env.MODEL_MEDIA_CAPABILITIES;
    if (!raw) return DEFAULT_CAPABILITIES;
    const parsed = JSON.parse(raw) as Record<string, Array<"video" | "audio">>;
    return { ...DEFAULT_CAPABILITIES, ...parsed };
  } catch {
    log.warn("MODEL_MEDIA_CAPABILITIES is not valid JSON — using defaults");
    return DEFAULT_CAPABILITIES;
  }
}

export function supportsMedia(modelName: string, kind: "video" | "audio"): boolean {
  const capabilities = loadCapabilities();
  const name = (modelName || "").toLowerCase();
  for (const [pattern, kinds] of Object.entries(capabilities)) {
    const supported = kinds.includes(kind);
    if (pattern.endsWith("*")) {
      if (name.startsWith(pattern.slice(0, -1).toLowerCase()) && supported) return true;
    } else if (pattern.toLowerCase() === name && supported) {
      return true;
    }
  }
  return false;
}

/** Model used when the selected one cannot ingest the attached media. */
export function getMediaFallbackModel(): string {
  return process.env.MEDIA_FALLBACK_MODEL || process.env.VISION_MODEL || "gemini-2.5-flash";
}

/** Wire strategy for OpenAI-compatible video payloads. */
const DATA_URL_MAX_BYTES = Number(process.env.MEDIA_DATA_URL_MAX_BYTES || 100 * 1024 * 1024);

// ── requirements detection ──────────────────────────────────────────────────

interface RawMsgLike {
  role?: string;
  content?: unknown;
  parts?: Array<Record<string, unknown>>;
}

function partsOf(m: RawMsgLike): Array<Record<string, unknown>> {
  if (Array.isArray(m.content)) return m.content as Array<Record<string, unknown>>;
  if (Array.isArray(m.parts)) return m.parts;
  return [];
}

export interface MediaRequirements {
  video: number;
  audio: number;
}

/** Count video/audio attachments across messages (any turn, not just last). */
export function getMediaRequirements(messages: unknown): MediaRequirements {
  const reqs: MediaRequirements = { video: 0, audio: 0 };
  if (!Array.isArray(messages)) return reqs;
  for (const m of messages as RawMsgLike[]) {
    for (const part of partsOf(m)) {
      const mime = String(part?.mimeType || part?.mediaType || "").toLowerCase();
      if (mime.startsWith("video/")) reqs.video += 1;
      else if (mime.startsWith("audio/")) reqs.audio += 1;
    }
  }
  return reqs;
}

// ── r2 reference helpers ────────────────────────────────────────────────────

const R2_REF_PREFIX = "r2://chat-attachments/";

/** Extract the object key from an r2:// ref, enforcing user ownership. */
export function ownedR2Key(rawRef: string, userId: string): string | null {
  if (!rawRef.startsWith(R2_REF_PREFIX)) return null;
  const key = decodeURIComponent(rawRef.slice(R2_REF_PREFIX.length));
  return key.startsWith(`${userId}/`) ? key : null;
}

function partRawData(part: Record<string, unknown>): string {
  return (
    (part.data as string) ||
    (part.url as string) ||
    (part.base64 as string) ||
    ((part.file as Record<string, unknown> | undefined)?.url as string) ||
    ((part.file as Record<string, unknown> | undefined)?.data as string) ||
    ""
  );
}

// ── resolution ──────────────────────────────────────────────────────────────

export interface ResolvedMediaPart {
  /** AI SDK file part (gemini path) — google maps it natively. */
  file?: { type: "file"; data: string; mimeType: string };
  /** Sentinel text part (openai-compatible path). */
  sentinel?: string;
  /** Plain text context (transcripts / failure notes). */
  text?: string;
}

/**
 * Resolve one video/audio attachment for the given answering model.
 */
export async function resolveMediaPart(args: {
  part: Record<string, unknown>;
  userId: string;
  targetModel: string;
  languageHint?: string;
}): Promise<ResolvedMediaPart | null> {
  const { part, userId, targetModel } = args;
  const mimeType = String(part.mimeType || part.mediaType || "").toLowerCase();
  const kind: "video" | "audio" | null = mimeType.startsWith("video/")
    ? "video"
    : mimeType.startsWith("audio/")
      ? "audio"
      : null;
  if (!kind) return null;

  const filename = String(part.filename || part.fileName || `attachment.${kind === "video" ? "mp4" : "mp3"}`).substring(0, 200);
  const rawRef = partRawData(part);
  const r2Key = ownedR2Key(rawRef, userId);
  if (!r2Key) {
    log.warn("Ignoring unowned/unresolved media reference", { userId, prefix: rawRef.slice(0, 24) });
    return { text: `[${kind}: ${filename} — unavailable]` };
  }

  // ── Gemini: native file parts, large media staged via the Files API ──
  if (targetModel.toLowerCase().startsWith("gemini")) {
    const staged = await stageMediaForGemini(r2Key, mimeType, filename);
    if (staged) {
      return { file: { type: "file", data: staged.uri, mimeType } };
    }
    log.warn("Gemini staging failed — falling back to transcript/note", { r2Key });
    if (kind === "audio") {
      const transcript = await transcribeR2Audio(r2Key, filename, mimeType, args.languageHint);
      if (transcript) return { text: `[Audio: ${filename}]\n${transcript}` };
    }
    return { text: `[${kind}: ${filename} — could not be processed]` };
  }

  // ── Audio on other providers: native only when wav/mp3 small enough,
  //    otherwise a transcript any model can use. ──
  if (kind === "audio") {
    const nativeFormat = mimeType.includes("wav") ? "wav" : mimeType.includes("mpeg") || mimeType.includes("mp3") ? "mp3" : null;
    const size = await statR2Object(r2Key);
    if (nativeFormat && size !== null && size <= 25 * 1024 * 1024 && supportsMedia(targetModel, "audio")) {
      const bytes = await downloadR2ObjectToBuffer(r2Key);
      const b64 = bytes.toString("base64");
      return {
        sentinel: registerMediaPayload({
          kind: "audio",
          mediaType: nativeFormat === "wav" ? "audio/wav" : "audio/mpeg",
          filename,
          dataUrl: `data:${nativeFormat === "wav" ? "audio/wav" : "audio/mpeg"};base64,${b64}`,
        }),
      };
    }
    const transcript = await transcribeR2Audio(r2Key, filename, mimeType, args.languageHint);
    if (transcript) {
      return { text: `[Audio attachment: ${filename} — transcription]\n${transcript}` };
    }
    return { text: `[Audio attachment: ${filename} — could not be transcribed]` };
  }

  // ── Video on OpenAI-compatible capable models: sentinel + wire rewrite ──
  const size = await statR2Object(r2Key);
  let dataUrl: string | undefined;
  let url: string | undefined;
  if (size !== null && size <= DATA_URL_MAX_BYTES) {
    const bytes = await downloadR2ObjectToBuffer(r2Key);
    dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;
  } else {
    url = (await presignR2Get(r2Key, 3600)) || undefined;
    if (!url) {
      // No presign available — last resort inline regardless of size.
      const bytes = await downloadR2ObjectToBuffer(r2Key);
      dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;
    }
  }

  return {
    sentinel: registerMediaPayload({ kind: "video", mediaType: mimeType, filename, dataUrl, url }),
  };
}
