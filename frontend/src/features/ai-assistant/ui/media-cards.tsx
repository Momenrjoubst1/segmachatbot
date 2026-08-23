/**
 * Inline media cards for assistant messages — Claude-style players for
 * video/audio links, click-to-play embed cards for YouTube/Vimeo, and the
 * dispatcher used for `file` parts arriving on assistant messages.
 */

import { useState, type ReactNode } from "react";
import {
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FilmIcon,
  Loader2Icon,
  MusicIcon,
  PlayIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { MarkdownImage } from "./markdown-text";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3004";

/** Shared fetch-to-blob download (download="" is ignored cross-origin). */
async function downloadMedia(url: string, filename: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function fileNameFromUrl(url: string | undefined, fallback: string): string {
  if (!url) return fallback;
  try {
    const path = new URL(url, BACKEND_URL).pathname.split("/").pop() ?? "";
    return decodeURIComponent(path) || fallback;
  } catch {
    return fallback;
  }
}

// ─── Video ────────────────────────────────────────────────────────────────

export function VideoPlayerCard({ src, title }: { src: string; title?: string }) {
  const { t } = useTranslation("chat");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  return (
    <span className="aui-media-video my-3 block max-w-full overflow-hidden rounded-xl border border-border/40 bg-black/90 shadow-sm">
      <video
        src={src}
        controls
        preload="metadata"
        playsInline
        dir="ltr"
        className={cn(
          "block max-h-[480px] w-full bg-black",
          status === "error" && "hidden",
        )}
        onLoadedMetadata={() => setStatus("ready")}
        onError={() => setStatus("error")}
      />
      {status === "loading" && (
        <span className="flex min-h-[180px] items-center justify-center">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </span>
      )}
      {status === "error" && (
        <MediaErrorFallback
          icon={<FilmIcon className="size-7" />}
          href={src}
          label={title ?? t("assistantMedia.videoLabel")}
        />
      )}
    </span>
  );
}

// ─── Audio ────────────────────────────────────────────────────────────────

export function AudioPlayerCard({ src, title }: { src: string; title?: string }) {
  const { t } = useTranslation("chat");
  const [status, setStatus] = useState<"ready" | "error">("ready");

  if (status === "error") {
    return (
      <span className="my-3 block max-w-full">
        <MediaErrorFallback
          icon={<MusicIcon className="size-7" />}
          href={src}
          label={title ?? t("assistantMedia.audioLabel")}
        />
      </span>
    );
  }

  return (
    <span className="aui-media-audio my-3 flex max-w-full items-center gap-3 rounded-xl border border-border/40 bg-muted/40 px-3 py-2.5 shadow-sm" dir="ltr">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <MusicIcon className="size-4" />
      </span>
      {title && (
        <span className="max-w-[180px] truncate text-sm font-medium text-foreground" dir="auto">
          {title}
        </span>
      )}
      <audio
        src={src}
        controls
        preload="metadata"
        onError={() => setStatus("error")}
        className="h-9 min-w-0 flex-1"
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void downloadMedia(src, fileNameFromUrl(src, "sigma-audio"));
          toast.success(t("assistantMedia.downloadStarted"));
        }}
        className="state-layer shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors"
        aria-label={t("assistantMedia.downloadAudio")}
      >
        <DownloadIcon className="size-4" />
      </button>
    </span>
  );
}

// ─── YouTube / Vimeo embed card ───────────────────────────────────────────

export function EmbedLinkCard({
  kind,
  videoId,
}: {
  kind: "youtube" | "vimeo";
  videoId: string;
}) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);

  const thumbnail =
    kind === "youtube"
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : undefined;
  const watchUrl =
    kind === "youtube"
      ? `https://www.youtube.com/watch?v=${videoId}`
      : `https://vimeo.com/${videoId}`;
  const embedUrl =
    kind === "youtube"
      ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`
      : `https://player.vimeo.com/video/${videoId}?autoplay=1`;

  return (
    <span className="aui-media-embed my-3 block max-w-md overflow-hidden rounded-xl border border-border/40 bg-muted/30 shadow-sm">
      <span
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Enter" && setOpen(true)}
        className="group relative block aspect-video cursor-pointer overflow-hidden bg-black/80"
      >
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            className="block h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        {!thumbnail && (
          <span className="flex h-full items-center justify-center text-white/70">
            <PlayIcon className="size-10" />
          </span>
        )}
        {thumbnail && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-transform group-hover:scale-105">
              <PlayIcon className="size-5 translate-x-[1px]" fill="currentColor" />
            </span>
          </span>
        )}
      </span>
      <span className="flex items-center gap-2 border-t border-border/30 px-3 py-2" dir="ltr">
        <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {kind === "youtube" ? t("assistantMedia.watchOnYouTube") : "Vimeo"}
        </a>
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] border-border/50 p-2 sm:max-w-3xl [&>button]:rounded-full [&>button]:bg-foreground/60">
          <DialogTitle className="sr-only">{t("assistantMedia.embedPlayer")}</DialogTitle>
          <div className="aspect-video w-full overflow-hidden rounded-lg bg-black" dir="ltr">
            <iframe
              src={embedUrl}
              title={t("assistantMedia.embedPlayer")}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full border-0"
            />
          </div>
        </DialogContent>
      </Dialog>
    </span>
  );
}

// ─── Shared error fallback ────────────────────────────────────────────────

function MediaErrorFallback({
  icon,
  href,
  label,
}: {
  icon: ReactNode;
  href: string;
  label: string;
}) {
  const { t } = useTranslation("chat");
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      dir="auto"
      className="flex min-h-[120px] flex-col items-center justify-center gap-2 p-4 text-muted-foreground transition-colors hover:text-foreground"
    >
      {icon}
      <span className="max-w-full truncate text-xs">{label}</span>
      <span className="inline-flex items-center gap-1 text-[11px] underline-offset-2 hover:underline">
        <ExternalLinkIcon className="size-3" />
        {t("assistantMedia.openInNewTab")}
      </span>
    </a>
  );
}

// ─── Assistant file-part dispatcher ───────────────────────────────────────

export interface FilePartLike {
  mimeType?: string;
  filename?: string;
  /** Payload — an http(s)/data URL string in the aui file-part shape. */
  data: string;
}

/**
 * Renders a `file` part carried by an assistant message (generated media,
 * returned documents). Dispatches by MIME type to the matching player.
 */
export function AssistantFilePart({ part }: { part: FilePartLike }) {
  const mime = (part.mimeType ?? "").toLowerCase();
  const url = part.data;
  const name = part.filename;

  if (!url) return null;

  // Data URLs carry their own type — trust the prefix when present.
  const effectiveMime = url.startsWith("data:") ? url.slice(5, url.indexOf(";")) : mime;

  if (effectiveMime.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url)) {
    return <MarkdownImage src={url} alt={name} />;
  }
  if (effectiveMime.startsWith("video/")) {
    return <VideoPlayerCard src={url} title={name} />;
  }
  if (effectiveMime.startsWith("audio/")) {
    return <AudioPlayerCard src={url} title={name} />;
  }
  if (effectiveMime === "application/pdf") {
    return <PdfFileChip url={url} name={name} />;
  }

  return (
    <span className="my-2 block">
      <MediaErrorFallback
        icon={<FileTextIcon className="size-6" />}
        href={url}
        label={name ?? effectiveMime ?? ""}
      />
    </span>
  );
}

function PdfFileChip({ url, name }: { url: string; name?: string }) {
  const { t } = useTranslation("chat");
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      dir="auto"
      className="aui-file-chip my-2 inline-flex max-w-full items-center gap-2 rounded-lg border border-border/50 bg-muted/40 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/70"
    >
      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{name ?? t("assistantMedia.fileAttachment")}</span>
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">PDF</span>
    </a>
  );
}
