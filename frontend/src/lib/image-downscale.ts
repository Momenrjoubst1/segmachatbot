/**
 * Client-side image downscaling for chat attachments.
 *
 * Phone cameras produce 4–8 MB photos; sending them base64 inflates the
 * payload by ~33% and slows every hop. We resize in the browser via canvas
 * (max side 1600px, JPEG q0.85) which is more than enough for handwritten
 * exercises while keeping OCR/vision legible.
 */

const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;
/** Data-URLs shorter than this pass through untouched (already small). */
const SKIP_THRESHOLD_CHARS = 400_000;

export interface DownscaleResult {
  body: unknown;
  /** Number of image parts removed because the message exceeded the cap. */
  droppedCount: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

/** Resize a single data-URL image. Returns the input unchanged when small. */
export async function downscaleDataUrl(
  dataUrl: string,
  maxSide = MAX_SIDE,
  quality = JPEG_QUALITY,
): Promise<string> {
  if (!dataUrl.startsWith("data:image/") || dataUrl.length < SKIP_THRESHOLD_CHARS) {
    return dataUrl;
  }
  try {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1) {
      // Within bounds — but an oversized PNG can still be huge; recompress
      // only when the payload is disproportionately large for its pixels.
      if (dataUrl.length < img.naturalWidth * img.naturalHeight * 0.9) return dataUrl;
    }
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", quality);
    return out.length < dataUrl.length ? out : dataUrl;
  } catch {
    // Never block a send on downscale failure — the server validates size.
    return dataUrl;
  }
}

interface UIMessagePart {
  type?: string;
  url?: string;
  mediaType?: string;
  image?: string;
  [key: string]: unknown;
}

interface UIMessageLike {
  role?: string;
  parts?: UIMessagePart[];
  content?: unknown;
  [key: string]: unknown;
}

function isImagePart(part: UIMessagePart): boolean {
  if (part.type === "image") return true;
  if (part.type === "file") {
    const mt = typeof part.mediaType === "string" ? part.mediaType : "";
    if (mt.startsWith("image/")) return true;
  }
  const url = part.url;
  return typeof url === "string" && url.startsWith("data:image/");
}

const MAX_IMAGES_PER_MESSAGE = 3;

async function transformMessage(message: UIMessageLike): Promise<number> {
  if (!Array.isArray(message.parts)) return 0;
  let dropped = 0;
  let imageSeen = 0;
  const nextParts: UIMessagePart[] = [];

  for (const part of message.parts) {
    if (isImagePart(part)) {
      imageSeen += 1;
      if (imageSeen > MAX_IMAGES_PER_MESSAGE) {
        dropped += 1;
        continue;
      }
      const raw =
        (typeof part.url === "string" && part.url) ||
        (typeof part.image === "string" && part.image) ||
        "";
      if (raw) {
        const resized = await downscaleDataUrl(raw);
        if (resized !== raw) {
          nextParts.push({ ...part, url: resized, image: undefined });
          continue;
        }
      }
    }
    nextParts.push(part);
  }

  if (dropped > 0 || nextParts.length !== message.parts.length) {
    message.parts = nextParts;
  }
  return dropped;
}

/**
 * Walk an outbound /api/chat body ({messages:[{role,parts}]}) and:
 *  - downscale oversized embedded images
 *  - enforce MAX_IMAGES_PER_MESSAGE on the newest user message
 * Never throws — on any failure the original body is returned.
 */
export async function downscaleUIMessageImages(body: unknown): Promise<DownscaleResult> {
  const result: DownscaleResult = { body, droppedCount: 0 };
  try {
    if (!body || typeof body !== "object") return result;
    const parsed = body as { messages?: UIMessageLike[] };
    if (!Array.isArray(parsed.messages)) return result;

    const lastUserIdx = (() => {
      for (let i = parsed.messages.length - 1; i >= 0; i--) {
        if (parsed.messages[i]?.role === "user") return i;
      }
      return -1;
    })();

    let dropped = 0;
    if (lastUserIdx !== -1) {
      const lastUserMsg = parsed.messages[lastUserIdx];
      if (lastUserMsg) {
        dropped = await transformMessage(lastUserMsg);
      }
    }
    result.droppedCount = dropped;
  } catch {
    // Non-fatal: send the original body.
  }
  return result;
}
