
import { type PropsWithChildren, useEffect, useState, type FC } from "react";
import { XIcon, PlusIcon, FileText, Loader2Icon, AlertCircleIcon } from "lucide-react";
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
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "./tooltip-icon-button";
import { cn } from "@/lib/cn";

const MAX_FILE_SIZE = 500 * 1024 * 1024;

const ACCEPTED_FILE_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/plain": [".txt"],
  "text/x-python": [".py"],
  "text/javascript": [".js"],
  "application/javascript": [".js"],
  "text/typescript": [".ts"],
  "application/typescript": [".ts"],
  "application/json": [".json"],
};

function isAcceptedFileType(file: File): boolean {
  if (file.type && ACCEPTED_FILE_TYPES[file.type]) return true;
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  return Object.values(ACCEPTED_FILE_TYPES).some((exts) => exts.includes(ext));
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let validationObserverInstalled = false;

function installFileInputValidation() {
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

const useAttachmentSrc = () => {
  const { file, src } = useAuiState(
    useShallow((s): { file?: File; src?: string } => {
      if (s.attachment.type !== "image") return {};
      if (s.attachment.file) return { file: s.attachment.file };
      const src = s.attachment.content?.filter((c) => c.type === "image")[0]
        ?.image;
      if (!src) return {};
      return { src };
    }),
  );

  return useFileSrc(file) ?? src;
};

type AttachmentPreviewProps = {
  src: string;
};

const AttachmentPreview: FC<AttachmentPreviewProps> = ({ src }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  return (
    <img
      src={src}
      alt="Attachment preview"
      className={cn(
        "block h-auto max-h-[80vh] w-auto max-w-full object-contain",
        isLoaded
          ? "aui-attachment-preview-image-loaded"
          : "aui-attachment-preview-image-loading invisible",
      )}
      onLoad={() => setIsLoaded(true)}
    />
  );
};

const AttachmentPreviewDialog: FC<PropsWithChildren> = ({ children }) => {
  const src = useAttachmentSrc();

  if (!src) return children;

  return (
    <Dialog>
      <DialogTrigger
        className="aui-attachment-preview-trigger cursor-pointer transition-colors hover:bg-accent/50"
        asChild
      >
        {children}
      </DialogTrigger>
      <DialogContent className="aui-attachment-preview-dialog-content p-2 sm:max-w-3xl [&>button]:rounded-full [&>button]:bg-foreground/60 [&>button]:p-1 [&>button]:opacity-100 [&>button]:ring-0! [&_svg]:text-background [&>button]:hover:[&_svg]:text-destructive">
        <DialogTitle className="aui-sr-only sr-only">
          Image Attachment Preview
        </DialogTitle>
        <div className="aui-attachment-preview relative mx-auto flex max-h-[80dvh] w-full items-center justify-center overflow-hidden bg-background">
          <AttachmentPreview src={src} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

const AttachmentThumb: FC = () => {
  const src = useAttachmentSrc();

  return (
    <Avatar className="aui-attachment-tile-avatar h-full w-full rounded-none">
      <AvatarImage
        src={src}
        alt="Attachment preview"
        className="aui-attachment-tile-image object-cover"
      />
      <AvatarFallback>
        <FileText className="aui-attachment-tile-fallback-icon size-8 text-muted-foreground" />
      </AvatarFallback>
    </Avatar>
  );
};

const AttachmentStatusOverlay: FC = () => {
  const status = useAuiState((s) => s.attachment.status);

  if (status.type === "running" && status.reason === "uploading") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-2xl">
        <Loader2Icon className="size-5 text-white animate-spin" />
      </div>
    );
  }

  if (status.type === "incomplete" && status.reason === "error") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-red-500/20 rounded-2xl">
        <AlertCircleIcon className="size-5 text-red-500" />
      </div>
    );
  }

  return null;
};

const AttachmentFileSize: FC = () => {
  const file = useAuiState((s) => s.attachment.file);

  if (file) {
    return (
      <span className="absolute bottom-0.5 left-0 right-0 text-center text-[9px] text-muted-foreground bg-background/70 truncate px-0.5">
        {formatFileSize(file.size)}
      </span>
    );
  }

  return null;
};

const AttachmentUI: FC = () => {
  const aui = useAui();
  const isComposer = aui.attachment.source !== "message";

  const isImage = useAuiState((s) => s.attachment.type === "image");
  const typeLabel = useAuiState((s) => {
    const type = s.attachment.type;
    switch (type) {
      case "image":
        return "Image";
      case "document":
        return "Document";
      case "file":
        return "File";
      default:
        return type;
    }
  });
  const status = useAuiState((s) => s.attachment.status);
  const hasError = status.type === "incomplete" && status.reason === "error";

  return (
    <Tooltip>
      <AttachmentPrimitive.Root
        className={cn(
          "aui-attachment-root relative",
          isImage && "aui-attachment-root-composer only:*:first:size-24",
        )}
      >
        <AttachmentPreviewDialog>
          <TooltipTrigger asChild>
            <div
              className={cn(
                "aui-attachment-tile size-14 cursor-pointer overflow-hidden rounded-2xl border bg-muted transition-opacity hover:opacity-75",
                hasError && "border-red-500 ring-1 ring-red-500/50",
              )}
              role="button"
              tabIndex={0}
              aria-label={`${typeLabel} attachment`}
            >
              <AttachmentThumb />
              <AttachmentStatusOverlay />
              <AttachmentFileSize />
            </div>
          </TooltipTrigger>
        </AttachmentPreviewDialog>
        {isComposer && <AttachmentRemove />}
      </AttachmentPrimitive.Root>
      <TooltipContent side="top">
        <AttachmentPrimitive.Name />
      </TooltipContent>
    </Tooltip>
  );
};

const AttachmentRemove: FC = () => {
  return (
    <AttachmentPrimitive.Remove asChild>
      <TooltipIconButton
        tooltip="Remove file"
        className="aui-attachment-tile-remove absolute top-1.5 right-1.5 size-3.5 rounded-full bg-white text-muted-foreground opacity-100 shadow-sm hover:bg-white! [&_svg]:text-black hover:[&_svg]:text-destructive"
        side="top"
      >
        <XIcon className="aui-attachment-remove-icon size-3" />
      </TooltipIconButton>
    </AttachmentPrimitive.Remove>
  );
};

export const UserMessageAttachments: FC = () => {
  return (
    <div className="aui-user-message-attachments-end col-span-full col-start-1 row-start-1 flex w-full flex-row justify-end gap-2">
      <MessagePrimitive.Attachments>
        {() => <AttachmentUI />}
      </MessagePrimitive.Attachments>
    </div>
  );
};

export const ComposerAttachments: FC = () => {
  return (
    <div className="aui-composer-attachments flex w-full flex-row items-center gap-2 overflow-x-auto empty:hidden">
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
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="state-layer aui-composer-add-attachment inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground p-1 font-semibold text-xs"
            aria-label="Add Attachment"
          >
            <PlusIcon className="aui-attachment-add-icon size-5 stroke-[1.5px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Add Attachment</TooltipContent>
      </Tooltip>
    </ComposerPrimitive.AddAttachment>
  );
};