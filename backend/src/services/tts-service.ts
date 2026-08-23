/**
 * TTS service — Microsoft Edge Read Aloud API via msedge-tts.
 *
 * Why Edge: Deepgram Aura has no Arabic; Azure-quality Arabic neural voices
 * (ar-JO/ar-SA/ar-EG) are available free through the Edge endpoint, which
 * works from server-side runtimes.
 *
 * Safety: all input is XML-escaped and speech-sanitized (markdown, code
 * fences, URLs and emoji stripped) before synthesis. Responses are LRU
 * cached per voice+text to keep repeat sentences instant.
 */

import { createHash } from "node:crypto";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { createLogger } from "../utils/logger.js";
import { getPersona, type VoicePersona } from "../config/voice-personas.js";

const log = createLogger("tts-service");

const MAX_TEXT_CHARS = 2000;
const CACHE_MAX_ENTRIES = 200;

/** voiceId -> ready client (metadata handshake is ~100ms, reuse it). */
const clients = new Map<string, MsEdgeTTS>();

/** sha1(voice + text) -> mp3 buffer. */
const cache = new Map<string, Buffer>();

export class TtsUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TtsUnavailableError";
  }
}

async function getClient(persona: VoicePersona): Promise<MsEdgeTTS> {
  const existing = clients.get(persona.id);
  if (existing) return existing;
  const tts = new MsEdgeTTS();
  await tts.setMetadata(
    persona.edgeVoice,
    OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
    { voiceLocale: persona.locale },
  );
  clients.set(persona.id, tts);
  return tts;
}

function dropClient(persona: VoicePersona): void {
  clients.delete(persona.id);
}

/** Remove markdown/code/URL/emoji noise that should never be spoken. */
export function sanitizeForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/(\*\*\*|\*\*|\*|__|_|~~)/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\|/g, " ")
    // eslint-disable-next-line no-misleading-character-class
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
      " ",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cacheKey(persona: VoicePersona, text: string): string {
  return createHash("sha1").update(`${persona.id}:${text}`).digest("hex");
}

function cachePut(key: string, buf: Buffer): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, buf);
}

/**
 * Synthesize text to MP3 for a persona. Throws TtsUnavailableError when the
 * upstream Edge service fails after one retry with a fresh client.
 */
export async function synthesize(
  rawText: string,
  personaId?: string | null,
): Promise<{ audio: Buffer; persona: VoicePersona }> {
  const persona = getPersona(personaId);
  const text = sanitizeForSpeech(rawText).slice(0, MAX_TEXT_CHARS);

  if (!text) {
    throw new TtsUnavailableError("Nothing speakable after sanitization");
  }

  const key = cacheKey(persona, text);
  const hit = cache.get(key);
  if (hit) return { audio: hit, persona };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const tts = await getClient(persona);
      const { audioStream } = tts.toStream(xmlEscape(text), {
        rate: persona.rate,
      });
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        audioStream.on("data", (d: Buffer) => chunks.push(d));
        audioStream.on("close", resolve);
        audioStream.on("error", reject);
      });
      const audio = Buffer.concat(chunks);
      if (audio.length < 512) {
        throw new Error(`Suspiciously small audio (${audio.length}B)`);
      }
      cachePut(key, audio);
      return { audio, persona };
    } catch (err) {
      lastErr = err;
      dropClient(persona); // force fresh handshake on retry
      log.warn("tts attempt failed", {
        persona: persona.id,
        attempt: attempt + 1,
        err: String(err),
      });
    }
  }
  throw new TtsUnavailableError("Edge TTS unavailable", lastErr);
}
