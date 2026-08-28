// Rewrites ⟦MEDIA:<id>⟧ sentinel text parts into provider-native blocks on the outbound request body.
import { createLogger } from "../../utils/logger.js";
import { getMediaRegistry, MEDIA_SENTINEL_RE, type MediaPayload } from "./media-registry.js";

const log = createLogger("media-wire");

interface WireContentPart {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

interface WireMessage {
  role?: string;
  content?: unknown;
}

function buildReplacement(payload: MediaPayload): WireContentPart[] {
  if (payload.kind === "video") {
    const url = payload.url ?? payload.dataUrl;
    if (url) return [{ type: "video_url", video_url: { url } }];
  }
  if (payload.kind === "audio") {
    // input_audio accepts raw base64 with an explicit wav|mp3 format only.
    const format = payload.mediaType.includes("wav") ? "wav" : "mp3";
    const b64 = payload.dataUrl?.split(",")[1];
    if (b64) return [{ type: "input_audio", input_audio: { data: b64, format } }];
  }
  // Degrade to transcript/note text when the native block is impossible.
  const note = payload.transcript
    ? `[${payload.kind}: ${payload.filename}]\n${payload.transcript}`
    : `[${payload.kind}: ${payload.filename} — could not be attached]`;
  return [{ type: "text", text: note }];
}

/** Rewrite one message's parts, expanding sentinel texts into real blocks. */
function rewriteParts(parts: WireContentPart[], registry: Map<string, MediaPayload>): WireContentPart[] {
  const out: WireContentPart[] = [];
  for (const part of parts) {
    const text = part?.type === "text" ? part.text : undefined;
    if (typeof text !== "string" || !text.includes("⟦MEDIA:")) {
      out.push(part);
      continue;
    }

    const segments: WireContentPart[] = [];
    let lastIndex = 0;
    MEDIA_SENTINEL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MEDIA_SENTINEL_RE.exec(text)) !== null) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: "text", text: before });
      const payload = registry.get(match[1]);
      if (payload) {
        segments.push(...buildReplacement(payload));
      } else {
        segments.push({ type: "text", text: "[media: unavailable]" });
      }
      lastIndex = match.index + match[0].length;
    }
    const tail = text.slice(lastIndex).trim();
    if (tail) segments.push({ type: "text", text: tail });

    if (segments.length > 0) out.push(...segments);
  }
  return out;
}

// Wrap a fetch implementation with media-sentinel rewriting.
export function mediaAwareFetch(base?: typeof fetch): typeof fetch {
  const impl = base ?? fetch;
  return async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const body = init?.body;
    if (typeof body !== "string" || !body.includes("⟦MEDIA:")) {
      return impl(input, init);
    }

    try {
      const parsed = JSON.parse(body) as { messages?: WireMessage[] };
      if (Array.isArray(parsed.messages)) {
        const registry = getMediaRegistry();
        for (const message of parsed.messages) {
          if (Array.isArray(message.content)) {
            message.content = rewriteParts(message.content as WireContentPart[], registry);
          }
        }

        const headers = new Headers(init?.headers ?? undefined);
        headers.delete("content-length");
        return impl(input, { ...init, headers, body: JSON.stringify(parsed) });
      }
    } catch (err) {
      log.warn("Media wire patch failed — sending original body", { error: (err as Error).message });
    }
    return impl(input, init);
  };
}
