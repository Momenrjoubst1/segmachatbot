/**
 * Chat attachment kind registry — the single source of truth for which file
 * types chat attachments accept, their size tiers, and magic-byte sniffing.
 *
 * Shared by the upload endpoint (validation) and the media router (routing).
 */

export type AttachmentKind = "video" | "audio" | "document" | "text" | "image";

interface KindSpec {
  kind: AttachmentKind;
  /** Wire MIME types (as browsers report them). */
  mimeTypes: string[];
  /** Extension fallback for files the OS cannot type. */
  extensions: string[];
  maxBytes: number;
  /**
   * Magic-byte sniff over the first 16 bytes. Text-like formats have no
   * reliable signature — they return null and are accepted on mime/ext alone.
   */
  sniff: ((head: Buffer) => boolean) | null;
}

const MAX_VIDEO_BYTES = Number(process.env.ATTACHMENT_MAX_VIDEO_BYTES || 500 * 1024 * 1024);
const MAX_AUDIO_BYTES = Number(process.env.ATTACHMENT_MAX_AUDIO_BYTES || 200 * 1024 * 1024);
const MAX_DOCUMENT_BYTES = Number(process.env.ATTACHMENT_MAX_DOCUMENT_BYTES || 200 * 1024 * 1024);

/** ASCII helper — Buffer.indexOf works with latin1 strings. */
function startsWithAscii(head: Buffer, ascii: string, offset = 0): boolean {
  return head.subarray(offset, offset + ascii.length).toString("latin1") === ascii;
}

/** ISO-BMFF family (mp4/mov/m4a/3gp): "ftyp"-branded box at offset 4. */
function isIsoBmff(head: Buffer, brands: string[]): boolean {
  if (!startsWithAscii(head, "ftyp", 4)) return false;
  const brand = head.subarray(8, 12).toString("latin1");
  return brands.some((b) => brand.startsWith(b));
}

function sniffVideo(head: Buffer): boolean {
  if (isIsoBmff(head, ["isom", "iso2", "mp41", "mp42", "avc1", "dash", "MSNV", "qt", "3gp", "3g2"])) return true; // mp4 / mov / 3gpp
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true; // webm/mkv
  if (startsWithAscii(head, "RIFF") && startsWithAscii(head, "AVI ", 8)) return true; // avi
  if (head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 && (head[3] === 0xba || head[3] === 0xbe)) return true; // mpeg-ps
  if (startsWithAscii(head, "FLV\x01")) return true; // x-flv
  if (head[0] === 0x30 && head[1] === 0x26 && head[2] === 0xb2 && head[3] === 0x75) return true; // asf/wmv GUID prefix
  return false;
}

function sniffAudio(head: Buffer): boolean {
  if (startsWithAscii(head, "ID3")) return true; // mp3 with tag
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return true; // mp3/aac ADTS frame sync
  if (startsWithAscii(head, "RIFF") && startsWithAscii(head, "WAVE", 8)) return true; // wav
  if (startsWithAscii(head, "OggS")) return true; // ogg
  if (startsWithAscii(head, "fLaC")) return true; // flac
  if (startsWithAscii(head, "FORM") && startsWithAscii(head, "AIFF", 8)) return true; // aiff
  if (isIsoBmff(head, ["M4A", "M4B", "mp71"])) return true; // m4a
  return false;
}

function sniffDocument(head: Buffer): boolean {
  if (startsWithAscii(head, "%PDF")) return true;
  if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) return true; // zip → docx/xlsx/pptx
  if (startsWithAscii(head, "\xd0\xcf\x11\xe0")) return true; // OLE2 → legacy doc/xls/ppt
  return false;
}

export const KIND_SPECS: Record<AttachmentKind, KindSpec> = {
  video: {
    kind: "video",
    mimeTypes: [
      "video/mp4", "video/mpeg", "video/mpg", "video/mov", "video/webm",
      "video/avi", "video/msvideo", "video/x-msvideo", "video/x-ms-wmv",
      "video/quicktime", "video/3gpp", "video/3gpp2", "video/x-flv",
    ],
    extensions: [".mp4", ".mpeg", ".mpg", ".mov", ".webm", ".avi", ".wmv", ".3gp", ".flv"],
    maxBytes: MAX_VIDEO_BYTES,
    sniff: sniffVideo,
  },
  audio: {
    kind: "audio",
    mimeTypes: [
      "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave",
      "audio/ogg", "audio/vorbis", "audio/flac", "audio/x-flac", "audio/aac",
      "audio/mp4", "audio/x-m4a", "audio/aiff", "audio/x-aiff", "audio/webm",
    ],
    extensions: [".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".aiff", ".webm"],
    maxBytes: MAX_AUDIO_BYTES,
    sniff: sniffAudio,
  },
  document: {
    kind: "document",
    mimeTypes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/csv", "text/markdown", "text/html", "text/xml",
    ],
    extensions: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".md", ".html", ".xml"],
    maxBytes: MAX_DOCUMENT_BYTES,
    sniff: sniffDocument,
  },
  text: {
    kind: "text",
    mimeTypes: ["text/plain", "application/json", "text/javascript", "application/javascript", "text/typescript", "application/typescript", "text/x-python", "text/css"],
    extensions: [".txt", ".json", ".js", ".ts", ".py", ".css", ".log"],
    maxBytes: MAX_DOCUMENT_BYTES,
    sniff: null,
  },
  image: {
    kind: "image",
    mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    extensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
    maxBytes: 30 * 1024 * 1024,
    sniff: null,
  },
};

/** Ordered list — text before document so .csv/.md resolve consistently. */
export const KIND_ORDER: AttachmentKind[] = ["video", "audio", "text", "document", "image"];

/**
 * Resolve the kind for a candidate upload. Returns null when no spec accepts it.
 */
export function detectKind(mimeType: string, fileName: string): AttachmentKind | null {
  const mt = (mimeType || "").split(";")[0].trim().toLowerCase();
  const ext = ("." + (fileName.split(".").pop() || "").toLowerCase()) || "";
  for (const key of KIND_ORDER) {
    const spec = KIND_SPECS[key];
    if (spec.mimeTypes.includes(mt) || spec.extensions.includes(ext)) return spec.kind;
  }
  return null;
}

/** Verify magic bytes for kinds that have a signature. Returns true when OK. */
export function sniffMatches(kind: AttachmentKind, head: Buffer): boolean {
  const spec = KIND_SPECS[kind];
  if (!spec.sniff) return true;
  try {
    return spec.sniff(head);
  } catch {
    return false;
  }
}
