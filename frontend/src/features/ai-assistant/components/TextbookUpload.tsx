import { useState, useCallback, useRef, useEffect } from "react";
import { Upload, FileText, Loader2, AlertCircle, CheckCircle2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { useTextbooks, type TextbookStatus } from "@/hooks/useTextbooks";

interface TextbookUploadProps {
  courseId?: string;
  onUploadComplete?: (textbookId: string) => void;
}

const STAGE_KEYS: Record<string, string> = {
  scanning: "textbook.stage.scanning",
  figures: "textbook.stage.figures",
  embedding: "textbook.stage.embedding",
};

export function TextbookUpload({ courseId, onUploadComplete }: TextbookUploadProps) {
  const { t } = useTranslation("study");
  const { uploadTextbook, textbooks, getStatus, deleteTextbook, refetch } = useTextbooks();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeTextbookId, setActiveTextbookId] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<TextbookStatus | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollStatus = useCallback(
    (textbookId: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      let missedPolls = 0;
      pollRef.current = setInterval(async () => {
        const status = await getStatus(textbookId);
        if (!status) {
          // Book deleted or status endpoint unreachable — stop polling after
          // a few consecutive misses instead of hammering the API forever.
          missedPolls += 1;
          if (missedPolls >= 5) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            refetch();
          }
          return;
        }
        missedPolls = 0;
        setActiveStatus(status);
        if (status.status === "completed" || status.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          // Refresh the library list so statuses there reflect the outcome
          refetch();
          if (status.status === "completed") {
            onUploadComplete?.(textbookId);
          }
        }
      }, 2000);
    },
    [getStatus, onUploadComplete, refetch]
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (file.type !== "application/pdf") {
        setUploadError(t("textbook.errNotPdf"));
        return;
      }
      if (file.size > 500 * 1024 * 1024) {
        setUploadError(t("textbook.errTooBig"));
        return;
      }

      setUploadError(null);
      setIsUploading(true);
      setUploadProgress(0);
      try {
        const result = await uploadTextbook(file, courseId, (pct) => setUploadProgress(pct));
        setActiveTextbookId(result.textbook_id);
        if (result.status === "pending") {
          pollStatus(result.textbook_id);
        }
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : t("textbook.errUploadFailed"));
      } finally {
        setIsUploading(false);
        setUploadProgress(null);
      }
    },
    [uploadTextbook, courseId, pollStatus, t]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleClick = () => fileInputRef.current?.click();

  const handleDelete = useCallback(
    async (id: string) => {
      if (pendingDeleteId === id) {
        // Second click — confirmed
        try {
          await deleteTextbook(id);
        } catch {
          // error handled in hook
        }
        setPendingDeleteId(null);
      } else {
        // First click — show confirmation
        setPendingDeleteId(id);
        // Auto-cancel after 3 seconds
        setTimeout(() => setPendingDeleteId((prev) => (prev === id ? null : prev)), 3000);
      }
    },
    [pendingDeleteId, deleteTextbook]
  );

  const statusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="size-4 text-green-500" />;
      case "failed":
        return <AlertCircle className="size-4 text-red-500" />;
      case "processing":
      case "pending":
        return <Loader2 className="size-4 animate-spin text-blue-500" />;
      default:
        return <FileText className="size-4 text-muted-foreground" />;
    }
  };

  const progressUnit =
    activeStatus?.progress?.stage === "embedding"
      ? t("textbook.unit.chunks")
      : activeStatus?.progress?.stage === "figures"
        ? t("textbook.unit.figures")
        : t("textbook.unit.pages");

  return (
    <div className="space-y-4">
      {/* Dropzone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors cursor-pointer",
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-border/60 hover:border-primary/50 hover:bg-muted/30",
          isUploading && "pointer-events-none opacity-60"
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {isUploading ? (
          <Loader2 className="size-8 animate-spin text-primary" />
        ) : (
          <Upload className="size-8 text-muted-foreground" />
        )}
        <div className="text-center">
          <p className="text-sm font-medium">
            {isUploading
              ? uploadProgress !== null
                ? t("textbook.uploadingPct", { pct: uploadProgress })
                : t("textbook.uploading")
              : isDragOver
              ? t("textbook.dropHere")
              : t("textbook.uploadPrompt")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("textbook.constraint")}
          </p>
        </div>
        {isUploading && uploadProgress !== null && (
          <div className="w-full max-w-xs">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {uploadError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" />
          {uploadError}
        </div>
      )}

      {/* Active processing indicator */}
      {activeTextbookId && activeStatus && activeStatus.status !== "completed" && activeStatus.status !== "failed" && (
        <div className="rounded-xl border border-border/60 bg-card/95 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin text-primary" />
            <span className="font-medium">{t("textbook.processing")}</span>
          </div>
          {activeStatus.progress && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{STAGE_KEYS[activeStatus.progress.stage] ? t(STAGE_KEYS[activeStatus.progress.stage]) : activeStatus.progress.stage}</span>
                <span>
                  {activeStatus.progress.pages_done}/{activeStatus.progress.total_pages || "?"}{" "}
                  {progressUnit}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{
                    width:
                      activeStatus.progress.total_pages && activeStatus.progress.total_pages > 0
                        ? `${Math.min(100, (activeStatus.progress.pages_done / activeStatus.progress.total_pages) * 100)}%`
                        : "0%",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Failed state */}
      {activeTextbookId && activeStatus?.status === "failed" && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" />
            <span className="font-medium">{t("textbook.failed")}</span>
          </div>
          <p className="text-xs text-destructive/80">{activeStatus.error}</p>
        </div>
      )}

      {/* Textbook library */}
      {textbooks.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">{t("textbook.myLibrary")}</h3>
          <div className="space-y-1.5">
            {textbooks.map((tb) => (
              <div
                key={tb.id}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/95 px-3 py-2.5"
              >
                {statusIcon(tb.status)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{tb.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {tb.total_pages
                      ? `${t("textbook.pageCount", { count: tb.total_pages })} · ${tb.status}`
                      : t("textbook.processingShort")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-8",
                    pendingDeleteId === tb.id
                      ? "text-destructive bg-destructive/10"
                      : "text-muted-foreground hover:text-destructive"
                  )}
                  onClick={() => handleDelete(tb.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
