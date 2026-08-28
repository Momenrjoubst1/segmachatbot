
import { type PropsWithChildren, useEffect, useState, type FC } from "react";
import {
  XIcon,
  PlusIcon,
  FileText,
  FilmIcon,
  MusicIcon,
  Loader2Icon,
  AlertCircleIcon,
  FileCode2Icon,
  DownloadIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useAuiState,
  useAui,
} from "@assistant-ui/react";
import { useShallow } from "zustand/shallow";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TooltipIconButton } from "./tooltip-icon-button";
import { cn } from "@/lib/cn";
import {
  downloadChatAttachment,
  extractR2Key,
  resolveChatAttachmentUrl,
} from "@/lib/chatAttachmentMedia";

/**
 * Attachment UI — Claude-style.
 *
 * Images render as clickable thumbnails; every other file renders as a
 * compact card (kind icon + filename + type/size caption). Clicking opens a
 * full preview dialog (image lightbox / video / audio player / PDF frame)
 * with a download action — both while composing AND after sending, where
 * attachments are resolved from their `r2://chat-attachments/…` references
 * via presigned URLs.
 *
 * Upload tiers live server-side in attachment-kinds.ts (video 500MB,
 * audio/documents 200MB); images inline downscaled; small text/code files
 * inline as text (2MB adapter cap).
 */
const MAX_FILE_SIZE = 500 * 1024 * 1024;

const ACCEPTED_FILE_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "video/mp4": [".mp4"],
  "video/mpeg": [".mpeg", ".mpg"],
  "video/quicktime": [".mov"],
  "video/webm": [".webm"],
  "video/x-msvideo": [".avi"],
  "video/x-ms-wmv": [".wmv"],
  "video/3gpp": [".3gp"],
  "audio/mpeg": [".mp3"],
  "audio/wav": [".wav"],
  "audio/x-wav": [".wav"],
  "audio/ogg": [".ogg"],
  "audio/flac": [".flac"],
  "audio/x-flac": [".flac"],
  "audio/aac": [".aac"],
  "audio/mp4": [".m4a"],
  "audio/x-m4a": [".m4a"],
  "audio/aiff": [".aiff"],
  "audio/x-aiff": [".aiff"],
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "text/plain": [".txt"],
  "text/markdown": [".md"],
  "text/csv": [".csv"],
  "text/html": [".html"],
  "text/xml": [".xml"],
  "text/css": [".css"],
  "application/json": [".json"],
  "text/x-python": [".py"],
  "text/javascript": [".js"],
  "application/javascript": [".js"],
  "text/typescript": [".ts"],
  "application/typescript": [".ts"],
};

function isAcceptedFileType(file: File): boolean {
  if (file.type && ACCEPTED_FILE_TYPES[file.type]) return true;
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  return Object.values(ACCEPTED_FILE_TYPES).some((exts) => exts.includes(ext));
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

let validationObserverInstalled = false;

export function installFileInputValidation() {
  if (validationObserverInstalled || typeof document === "undefined") return;
  validationObserverInstalled = true;

  document.addEventListener(
    "change",
    (e) => {
      const target = e.target as HTMLInputElement;
      if (target.tagName !== "INPUT" || target.type !== "file") return;
      if (!target.files || target.files.length === 0) return;

      const files = Array.from(target.files);
      const validFiles: File[] = [];
      let hasInvalid = false;

      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
          toast.error("File too large. Maximum size is 500MB.", {
            description: `"${file.name}" is ${formatFileSize(file.size)}.`,
          });
          hasInvalid = true;
        } else if (!isAcceptedFileType(file)) {
          toast.error("Unsupported file type. Please upload an image, document, or code file.", {
            description: `"${file.name}" is not a supported file type.`,
          });
          hasInvalid = true;
        } else {
          validFiles.push(file);
        }
      }

      if (hasInvalid) {
        if (validFiles.length === 0) {
          const dt = new DataTransfer();
          target.files = dt.files;
          target.dispatchEvent(new Event("change", { bubbles: true }));
          e.stopImmediatePropagation();
          e.preventDefault();
          return;
        }
        const dt = new DataTransfer();
        validFiles.forEach((f) => dt.items.add(f));
        target.files = dt.files;
      }
    },
    true,
  );
}

// ─── media resolution ───────────────────────────────────────────────────────

const useFileSrc = (file: File | undefined) => {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!file) {
      setSrc(undefined);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setSrc(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return src;
};

type MediaKind = "image" | "video" | "audio" | "document";

export interface ResolvedMedia {
  /** Browser-usable preview URL (object URL / data URL / presigned URL). */
  src?: string;
  /** MIME type when known ("video/mp4", …). */
  contentType?: string;
  kind: MediaKind;
  fileName?: string;
  /** Set when the file lives in R2 (sent/hydrated messages). */
  r2Key?: string;
  /** True while the R2 reference is still being resolved. */
  loading: boolean;
}

export type { MediaKind };

interface AttachmentSourceInfo {
  file?: File;
  contentType?: string;
  fileName?: string;
  imageRef?: string;
  mediaRef?: string;
}

/**
 * Read the raw attachment state across BOTH lifecycle stages:
 *  - composer: local `File` is present
 *  - sent/hydrated: content parts carry r2:// refs (or data URLs)
 */
const useAttachmentSource = (): AttachmentSourceInfo => {
  return useAuiState(
    useShallow((s): AttachmentSourceInfo => {
      const a = s.attachment;
      const ct = a.contentType ?? "";
      const base = { contentType: ct, fileName: a.name };

      // Composer-stage file (any kind keeps its local object URL path).
      if (a.file) return { ...base, file: a.file };

      // Sent/hydrated stage — locate the stored reference in content parts.
      let imageRef: string | undefined;
      let mediaRef: string | undefined;
      for (const c of a.content ?? []) {
        const part = c as { type?: string; image?: unknown; data?: unknown; url?: unknown };
        const candidate =
          typeof part.image === "string" ? part.image :
          typeof part.data === "string" ? part.data :
          typeof part.url === "string" ? part.url :
          undefined;
        if (!candidate) continue;
        if (part.type === "image" && !imageRef) imageRef = candidate;
        else if ((part.type === "file" || !part.type) && !mediaRef) mediaRef = candidate;
      }
      return { ...base, imageRef, mediaRef };
    }),
  );
};

/** Resolve an attachment into a previewable media descriptor. */
const useAttachmentMedia = (): ResolvedMedia => {
  const { file, contentType, fileName, imageRef, mediaRef } = useAttachmentSource();

  const r2Key =
    extractR2Key(imageRef ?? "") ?? extractR2Key(mediaRef ?? "") ?? undefined;

  const [remoteSrc, setRemoteSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!r2Key) {
      setRemoteSrc(undefined);
      return;
    }
    let alive = true;
    resolveChatAttachmentUrl(r2Key)
      .then((url) => {
        if (alive) setRemoteSrc(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [r2Key]);

  const localObjectUrl = useFileSrc(file);

  // Hydrated messages may carry "unknown/unknown" or a missing MIME — fall
  // back to the filename extension so videos never render as documents.
  const trustworthyType =
    contentType &&
    !contentType.startsWith("unknown/") &&
    contentType !== "application/octet-stream";
  const kind: MediaKind = trustworthyType
    ? contentType!.startsWith("video/")
      ? "video"
      : contentType!.startsWith("audio/")
        ? "audio"
        : contentType!.startsWith("image/")
          ? "image"
          : "document"
    : kindFromFileName(fileName, imageRef !== undefined);

  // Inline data/http images that are NOT r2 refs render directly.
  const directImageSrc =
    kind === "image" &&
    !r2Key &&
    imageRef &&
    (imageRef.startsWith("data:") || imageRef.startsWith("http"))
      ? imageRef
      : undefined;

  return {
    src: localObjectUrl ?? remoteSrc ?? directImageSrc,
    contentType,
    kind,
    fileName,
    r2Key,
    loading: Boolean(r2Key) && !localObjectUrl && !remoteSrc && kind === "image",
  };
};

// ─── shared bits ────────────────────────────────────────────────────────────

function extLabel(fileName: string | undefined, contentType?: string): string {
  const ext = (fileName?.split(".").pop() || "").toUpperCase().slice(0, 5);
  return ext || contentType?.split("/")[1]?.toUpperCase() || "FILE";
}

/** Extension-based kind fallback for attachments with unusable MIME types. */
function kindFromFileName(fileName: string | undefined, hasImageRef = false): MediaKind {
  if (hasImageRef) return "image";
  const ext = (fileName?.split(".").pop() || "").toLowerCase();
  if (["mp4", "mov", "webm", "avi", "mkv", "wmv", "mpeg", "mpg", "3gp", "flv"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "flac", "aac", "m4a", "aiff"].includes(ext)) return "audio";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  return "document";
}

type IconKind = MediaKind | "code";

/** Kind-specific pastel icon squares (subtle, Claude-like). */
const KIND_ICON_STYLE: Record<IconKind, string> = {
  image: "bg-violet-500/15 text-violet-500",
  video: "bg-purple-500/15 text-purple-500",
  audio: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  document: "bg-red-500/15 text-red-500",
  code: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
};

function KindIcon({ kind, className }: { kind: IconKind; className?: string }) {
  const cls = cn("size-4", className);
  if (kind === "video") return <FilmIcon className={cls} />;
  if (kind === "audio") return <MusicIcon className={cls} />;
  if (kind === "code") return <FileCode2Icon className={cls} />;
  return <FileText className={cls} />;
}

function detectCardKind(fileName: string | undefined, contentType?: string): IconKind {
  const ext = (fileName?.split(".").pop() || "").toLowerCase();
  if (["js", "ts", "py", "json", "css", "html", "xml", "log", "csv", "md"].includes(ext)) return "code";
  if (contentType === "text/csv" || contentType === "application/json") return "code";
  return "document";
}

// ─── preview dialog ─────────────────────────────────────────────────────────

const AttachmentPreview: FC<{ src: string }> = ({ src }) => (
  <img
    src={src}
    alt="Attachment preview"
    className="block max-h-[75dvh] w-auto max-w-full rounded-lg object-contain"
  />
);

const PreviewDialogBody: FC<{ media: ResolvedMedia }> = ({ media }) => {
  const { src, kind } = media;

  if (!src) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 py-12 text-center">
        <div className={cn("rounded-xl p-3", KIND_ICON_STYLE[kind])}>
          <KindIcon kind={kind} className="size-7" />
        </div>
        {media.loading ? (
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <p className="max-w-xs text-sm text-muted-foreground">
              This file can't be previewed here — you can download it instead.
            </p>
            {media.r2Key && (
              <button
                type="button"
                onClick={() => void downloadChatAttachment(media.r2Key!, media.fileName ?? "file")}
                className="state-layer inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
              >
                <DownloadIcon className="size-3.5" />
                Download
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  if (kind === "image") return <AttachmentPreview src={src} />;

  if (kind === "video") {
    return (
      <video
        src={src}
        controls
        autoPlay
        playsInline
        className="max-h-[70dvh] w-auto max-w-full rounded-lg"
      />
    );
  }

  if (kind === "audio") {
    return (
      <div className="flex w-full max-w-md items-center py-8">
        <audio src={src} controls autoPlay className="w-full" />
      </div>
    );
  }

  // Documents — browsers natively render PDFs in a frame.
  const looksPdf =
    (media.fileName ?? "").toLowerCase().endsWith(".pdf") ||
    media.contentType === "application/pdf";
  if (looksPdf) {
    return (
      <iframe
        src={src}
        title="PDF preview"
        className="h-[72dvh] w-full rounded-lg border bg-white"
      />
    );
  }

  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 py-12 text-center">
      <div className={cn("rounded-xl p-3", KIND_ICON_STYLE[detectCardKind(media.fileName, media.contentType)])}>
        <KindIcon kind={detectCardKind(media.fileName, media.contentType)} className="size-7" />
      </div>
      <p className="max-w-xs text-sm text-muted-foreground">
        This file type can't be previewed inline — download it to view.
      </p>
      <button
        type="button"
        onClick={() =>
          void (media.r2Key
            ? downloadChatAttachment(media.r2Key, media.fileName ?? "file")
            : (() => {
                const a = document.createElement("a");
                a.href = src;
                a.download = media.fileName ?? "file";
                a.click();
              })())
        }
        className="state-layer inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
      >
        <DownloadIcon className="size-3.5" />
        Download
      </button>
    </div>
  );
};

export const AttachmentPreviewDialog: FC<PropsWithChildren<{ media: ResolvedMedia }>> = ({
  children,
  media,
}) => {
  const openable = Boolean(media.src) || Boolean(media.r2Key);

  const triggerDownload = () => {
    if (media.r2Key) {
      void downloadChatAttachment(media.r2Key, media.fileName ?? "file");
      return;
    }
    if (!media.src) return;
    const a = document.createElement("a");
    a.href = media.src;
    a.download = media.fileName ?? "file";
    a.click();
  };
  return (
    <Dialog>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="aui-attachment-preview-dialog-content gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-4xl [&>button]:top-2.5 [&>button]:right-2.5 [&>button]:z-20 [&>button]:rounded-full [&>button]:bg-foreground/60 [&>button]:p-1 [&>button]:opacity-100 [&>button]:ring-0! [&_svg]:text-background [&>button]:hover:[&_svg]:text-destructive">
        <DialogTitle className="sr-only">Attachment preview</DialogTitle>

        {/* header — identity + actions */}
        <div className="flex items-center gap-2.5 border-b px-4 py-2 pr-10">
          <div className={cn("shrink-0 rounded-lg p-1.5", KIND_ICON_STYLE[media.kind])}>
            <KindIcon kind={media.kind} />
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-medium" dir="ltr">
            {media.fileName || "Attachment"}
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={triggerDownload}
                disabled={!openable}
                className="state-layer inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                aria-label="Download attachment"
              >
                <DownloadIcon className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Download</TooltipContent>
          </Tooltip>
        </div>

        {/* body */}
        <div className="mx-auto flex max-h-[76dvh] w-full items-center justify-center overflow-auto bg-background p-3">
          <PreviewDialogBody media={media} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── tiles & cards ──────────────────────────────────────────────────────────

const AttachmentStatusOverlay: FC = () => {
  const status = useAuiState((s) => s.attachment.status);

  if (status.type === "running" && status.reason === "uploading") {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-black/30 backdrop-blur-[1px]">
        <Loader2Icon className="size-5 animate-spin text-white" />
      </div>
    );
  }

  if (status.type === "incomplete" && status.reason === "error") {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-red-500/20">
        <AlertCircleIcon className="size-5 text-red-500" />
      </div>
    );
  }

  return null;
};

const AttachmentRemove: FC = () => {
  return (
    <AttachmentPrimitive.Remove asChild>
      <TooltipIconButton
        tooltip="Remove file"
        className="absolute top-1 right-1 z-20 size-4 rounded-full bg-white shadow-sm ring-1 ring-black/10 opacity-0 transition-opacity group-hover/tile:opacity-100 hover:!bg-white [&_svg]:!text-black dark:bg-neutral-700 dark:[&_svg]:!text-white dark:hover:!bg-neutral-700"
        side="top"
      >
        <XIcon className="aui-attachment-remove-icon size-2.5" />
      </TooltipIconButton>
    </AttachmentPrimitive.Remove>
  );
};

const AttachmentDownloadAction: FC<{ media: ResolvedMedia }> = ({ media }) => {
  if (!media.r2Key) return null;
  return (
    <TooltipIconButton
      tooltip="Download"
      className="absolute top-1 right-1 z-20 size-5 rounded-full bg-background/90 shadow-sm ring-1 ring-black/10 opacity-0 backdrop-blur transition-opacity group-hover/tile:opacity-100 hover:!bg-background"
      side="top"
      onClick={(e) => {
        e.stopPropagation();
        void downloadChatAttachment(media.r2Key!, media.fileName ?? "file");
      }}
    >
      <DownloadIcon className="size-3 text-foreground" />
    </TooltipIconButton>
  );
};

/** Renders remove (composer) or download (sent message) affordance. */
function SlotActions({ media }: { media: ResolvedMedia }) {
  const aui = useAui();
  const isComposer = aui.attachment.source !== "message";
  return isComposer ? <AttachmentRemove /> : <AttachmentDownloadAction media={media} />;
}

/** Non-image attachment — Claude-style file card: full wrapped filename +
 * a small type badge (MP4/PDF/…) pinned at the bottom. */
const FileAttachmentCard: FC<{ media: ResolvedMedia }> = ({ media }) => {
  const status = useAuiState((s) => s.attachment.status);
  const uploading = status.type === "running" && status.reason === "uploading";
  const hasError = status.type === "incomplete" && status.reason === "error";

  return (
    <div
      className={cn(
        "group/tile relative flex h-32 w-40 shrink-0 select-none flex-col justify-between gap-2 overflow-hidden rounded-xl border border-border/70 bg-background p-3",
        "transition-shadow hover:shadow-sm",
        hasError && "border-red-500 ring-1 ring-red-500/50",
      )}
      role="button"
      tabIndex={0}
      aria-label={`${media.kind} attachment${media.fileName ? `: ${media.fileName}` : ""}`}
    >
      <p
        className="line-clamp-4 break-all text-[13px] leading-snug text-foreground"
        dir="ltr"
      >
        {media.fileName || "file"}
      </p>
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-md border border-border/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
          {uploading ? "…" : extLabel(media.fileName, media.contentType)}
        </span>
        {uploading && (
          <span className="text-[10px] text-muted-foreground">Uploading…</span>
        )}
      </div>
      <AttachmentStatusOverlay />
      <SlotActions media={media} />
    </div>
  );
};

const AttachmentUI: FC = () => {
  const media = useAttachmentMedia();
  const status = useAuiState((s) => s.attachment.status);
  const hasError = status.type === "incomplete" && status.reason === "error";

  return (
    <Tooltip>
      <AttachmentPrimitive.Root className="aui-attachment-root relative">
        <AttachmentPreviewDialog media={media}>
          <TooltipTrigger asChild>
            {media.kind === "image" ? (
              <div
                className={cn(
                  "group/tile relative size-32 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-border/70 bg-muted",
                  hasError && "border-red-500 ring-1 ring-red-500/50",
                )}
                role="button"
                tabIndex={0}
                aria-label={`Image attachment${media.fileName ? `: ${media.fileName}` : ""}`}
              >
                {media.src ? (
                  <img
                    src={media.src}
                    alt={media.fileName ?? "image"}
                    className="size-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    {media.loading ? (
                      <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                    ) : (
                      <div className={cn("rounded-lg p-2", KIND_ICON_STYLE.image)}>
                        <KindIcon kind="image" />
                      </div>
                    )}
                  </div>
                )}
                <AttachmentStatusOverlay />
                <SlotActions media={media} />
              </div>
            ) : (
              <FileAttachmentCard media={media} />
            )}
          </TooltipTrigger>
        </AttachmentPreviewDialog>
        <TooltipContent side="top" className="max-w-64 truncate" dir="ltr">
          {media.fileName || "Attachment"}
        </TooltipContent>
      </AttachmentPrimitive.Root>
    </Tooltip>
  );
};

export const UserMessageAttachments: FC = () => {
  return (
    <div className="aui-user-message-attachments-end col-span-full col-start-1 row-start-1 mb-0.5 flex w-full flex-row flex-wrap items-center justify-end gap-2">
      <MessagePrimitive.Attachments>
        {() => <AttachmentUI />}
      </MessagePrimitive.Attachments>
    </div>
  );
};

export const ComposerAttachments: FC = () => {
  return (
    <div className="aui-composer-attachments flex w-full flex-row flex-wrap items-center gap-2 overflow-x-auto empty:hidden">
      <ComposerPrimitive.Attachments>
        {() => <AttachmentUI />}
      </ComposerPrimitive.Attachments>
    </div>
  );
};

export const ComposerAddAttachment: FC = () => {
  useEffect(() => {
    installFileInputValidation();
  }, []);

  return (
    <ComposerPrimitive.AddAttachment asChild>
      <button
        type="button"
        className="state-layer aui-composer-add-attachment inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground p-1 font-semibold text-xs"
        aria-label="Add Attachment"
      >
        <PlusIcon className="aui-attachment-add-icon size-5 stroke-[1.5px]" />
      </button>
    </ComposerPrimitive.AddAttachment>
  );
};
