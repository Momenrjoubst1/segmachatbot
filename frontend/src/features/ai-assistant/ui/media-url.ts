/**
 * Media URL classification — decides how an assistant-emitted link should be
 * rendered (inline video player, audio player, embed card, or plain link).
 *
 * Pure functions so they stay unit-testable; the React shells live in
 * `media-cards.tsx`.
 */

import type { ReactNode } from "react";

export type EmbeddableMediaKind = "video" | "audio" | "youtube" | "vimeo";

export interface ClassifiedMedia {
  kind: EmbeddableMediaKind;
  /** YouTube/Vimeo video id when kind is an embed provider. */
  embedId?: string;
}

const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v", "ogv", "mkv"];
const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus"];
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"];

function extensionOf(pathname: string): string {
  const lastSegment = pathname.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot < 0) return "";
  return lastSegment.slice(dot + 1).toLowerCase();
}

/** Extract a YouTube video id from any of its URL shapes, or null. */
export function getYouTubeId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return id.length >= 8 ? id : null;
  }
  if (!host.endsWith("youtube.com") && !host.endsWith("youtube-nocookie.com")) return null;

  if (url.pathname === "/watch") {
    return url.searchParams.get("v");
  }
  const embedMatch = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/);
  return embedMatch?.[1] ?? null;
}

/** Extract a Vimeo video id, or null. */
export function getVimeoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "vimeo.com" && !host.endsWith("player.vimeo.com")) return null;
  const match = url.pathname.match(/\/(?:video\/)?(\d{6,})/);
  return match?.[1] ?? null;
}

/**
 * Classify a raw URL string into the inline-renderable kind, or null when it
 * should stay a regular link / image.
 */
export function classifyMediaUrl(raw: string | null | undefined): ClassifiedMedia | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, "https://placeholder.invalid");
  } catch {
    return null;
  }

  const youtubeId = getYouTubeId(url);
  if (youtubeId) return { kind: "youtube", embedId: youtubeId };

  const vimeoId = getVimeoId(url);
  if (vimeoId) return { kind: "vimeo", embedId: vimeoId };

  const ext = extensionOf(url.pathname);
  if (VIDEO_EXTENSIONS.includes(ext)) return { kind: "video" };
  if (AUDIO_EXTENSIONS.includes(ext)) return { kind: "audio" };
  return null;
}

/** True when the extension marks a raster/vector image. */
export function isImageUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return IMAGE_EXTENSIONS.includes(extensionOf(url.pathname));
  } catch {
    return false;
  }
}

/** Human-readable display text for a link (used for audio titles etc.). */
export function linkTextOf(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) {
    return children.map((c) => (typeof c === "string" ? c : "")).join("");
  }
  return "";
}

/**
 * Bare-link detection: only auto-convert links whose visible text is the URL
 * itself (markdown autolinks / pasted URLs). Named markdown links keep their
 * normal anchor styling.
 */
export function isBareLink(children: ReactNode, href?: string): boolean {
  if (!href) return false;
  const text = linkTextOf(children).trim();
  if (!text) return true;
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "");
  return normalize(text) === normalize(href) || text.includes(href);
}
