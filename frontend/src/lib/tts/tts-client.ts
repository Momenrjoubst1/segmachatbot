/**
 * TTS HTTP client — one completed sentence in, MP3 bytes out.
 * Degrades loudly (typed errors) so the orchestrator can decide to fall
 * back to text-only chat without ever blocking the conversation.
 */

import { authFetch } from "@/lib/auth";
import { BACKEND_URL } from "@/lib/config";

export class TtsError extends Error {
  constructor(
    public kind: "unavailable" | "http" | "aborted" | "network",
    message: string,
  ) {
    super(message);
    this.name = "TtsError";
  }
}

export async function synthesizeChunk(
  text: string,
  voiceId: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await authFetch(`${BACKEND_URL}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceId }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new TtsError("aborted", "tts fetch aborted");
    throw new TtsError("network", String(err));
  }

  if (res.status === 503) {
    throw new TtsError("unavailable", "tts service unavailable");
  }
  if (!res.ok) {
    throw new TtsError("http", `tts http ${res.status}`);
  }
  return res.arrayBuffer();
}

export interface VoicePersonaInfo {
  id: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  gender: "female" | "male";
  locale: string;
  default: boolean;
}

export async function fetchVoicePersonas(): Promise<VoicePersonaInfo[]> {
  const res = await authFetch(`${BACKEND_URL}/api/tts/voices`);
  if (!res.ok) throw new TtsError("http", `voices http ${res.status}`);
  const data = (await res.json()) as { personas: VoicePersonaInfo[] };
  return data.personas;
}