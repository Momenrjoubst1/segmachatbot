/**
 * Chat files panel — Claude-style.
 *
 * A header button (paperclip + count badge) that opens a panel listing every
 * file attached to the active chat — aggregated from the message history
 * (hydrated from GET /threads/:id and mirrored by the send path), deduped by
 * R2 key, newest first. Cards show an image thumbnail or a type badge,
 * filename, and size; clicking opens the shared full preview dialog, and a
 * hover affordance downloads the file.
 */
import { useEffect, useMemo, useState, type FC } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import {
  FileIcon,
  Loader2Icon,
  DownloadIcon,
  PaperclipIcon,
} from "lucide-react";
import { useChatHistory } from "@/hooks/useChatHistory";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { resolveChatAttachmentUrl, downloadChatAttachment } from "@/lib/chatAttachmentMedia";
import {
  AttachmentPreviewDialog,
  formatFileSize,
  type ResolvedMedia,
} from "./attachment";
import { useTranslation } from "react-i18next";

interface ThreadFile {
  r2Key: string;
  fileName: string;
  mimeType: string;
  kind?: string;
  sizeBytes?: number;
}

/** All unique files attached across the active thread, newest first. */
function useThreadFiles(): ThreadFile[] {
  const { activeThreadMessages } = useChatHistory();
  return useMemo(() => {
    const byKey = new Map<string, ThreadFile>();
    const messages = activeThreadMessages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const a of messages[i]?.attachments ?? []) {
        if (!a.r2Key || byKey.has(a.r2Key)) continue;
        byKey.set(a.r2Key, {
          r2Key: a.r2Key,
          fileName: a.fileName,
          mimeType: a.mimeType,
          kind: a.kind,
          sizeBytes: a.sizeBytes,
        });
      }
    }
    return [...byKey.values()];
  }, [activeThreadMessages]);
}

function kindOf(file: ThreadFile): ResolvedMedia["kind"] {
  const mt = (file.mimeType || "").toLowerCase();
  if (mt.startsWith("video/")) return "video";
  if (mt.startsWith("audio/")) return "audio";
  if (mt.startsWith("image/")) return "image";
  const ext = (file.fileName.split(".").pop() || "").toLowerCase();
  if (["mp4", "mov", "webm", "avi", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "flac", "aac", "m4a"].includes(ext)) return "audio";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  return "document";
}

function badgeLabel(file: ThreadFile): string {
  const ext = (file.fileName.split(".").pop() || "").toUpperCase().slice(0, 5);
  return ext || file.mimeType.split("/")[1]?.toUpperCase() || "FILE";
}

/** Resolves (and caches) the presigned URL for one file. */
function useFileUrl(r2Key: string | undefined): { src?: string; loading: boolean } {
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!r2Key) return;
    let alive = true;
    setLoading(true);
    resolveChatAttachmentUrl(r2Key)
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [r2Key]);

  return { src, loading };
}

const BADGE_STYLE: Record<ResolvedMedia["kind"], string> = {
  image: "bg-violet-500/15 text-violet-500",
  video: "bg-purple-500/15 text-purple-500",
  audio: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  document: "bg-red-500/15 text-red-500",
};

/** One row in the panel — Claude-style file card. */
const PanelFileCard: FC<{ file: ThreadFile }> = ({ file }) => {
  const { t } = useTranslation();
  const kind = kindOf(file);
  const { src, loading } = useFileUrl(file.r2Key);
  const media: ResolvedMedia = {
    src,
    contentType: file.mimeType,
    kind,
    fileName: file.fileName,
    r2Key: file.r2Key,
    loading,
  };

  return (
    <AttachmentPreviewDialog media={media}>
      <div
        role="button"
        tabIndex={0}
        className="group/file relative flex w-full cursor-pointer items-center gap-3 rounded-xl border border-transparent p-2 text-start transition-colors hover:border-border/60 hover:bg-muted/60"
      >
        {kind === "image" ? (
          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
            {src ? (
              <img src={src} alt="" className="size-full object-cover" loading="lazy" />
            ) : loading ? (
              <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <FileIcon className="size-4 text-muted-foreground" />
            )}
          </div>
        ) : (
          <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg", BADGE_STYLE[kind])}>
            <span className="text-[10px] font-bold tracking-wide">{badgeLabel(file)}</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium" dir="ltr">
            {file.fileName}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {[badgeLabel(file), file.sizeBytes ? formatFileSize(file.sizeBytes) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void downloadChatAttachment(file.r2Key, file.fileName);
              }}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-focus-within/file:opacity-100 group-hover/file:opacity-100 [@media(hover:none)]:opacity-100"
              aria-label={t("chatFiles.download", "Download")}
            >
              <DownloadIcon className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{t("chatFiles.download", "Download")}</TooltipContent>
        </Tooltip>
      </div>
    </AttachmentPreviewDialog>
  );
};

/** Header button + popover panel. Renders nothing until the chat has files. */
export const ChatFilesButton: FC = () => {
  const { t } = useTranslation();
  const files = useThreadFiles();
  const [open, setOpen] = useState(false);

  if (files.length === 0) return null;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="state-layer relative shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={t("chatFiles.title", "Chat files")}
            >
              <PaperclipIcon className="size-4" />
              <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold leading-none text-primary-foreground">
                {files.length > 9 ? "9+" : files.length}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("chatFiles.title", "Chat files")}</TooltipContent>
        </Tooltip>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 overflow-hidden rounded-2xl border bg-popover shadow-lg outline-none"
        >
          <div className="flex items-center justify-between border-b px-3.5 py-2.5">
            <p className="text-[13px] font-semibold">
              {t("chatFiles.title", "Chat files")}
            </p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {files.length}
            </span>
          </div>
          <div className="max-h-80 overflow-y-auto p-1.5">
            {files.map((f) => (
              <PanelFileCard key={f.r2Key} file={f} />
            ))}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
};
