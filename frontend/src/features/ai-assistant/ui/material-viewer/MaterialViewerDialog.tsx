/**
 * MaterialViewerDialog — the in-app study-material viewer.
 *
 * A single global instance mounted once in AssistantApp, driven by
 * useMaterialViewer. Renders the ORIGINAL uploaded file:
 *   - PDFs   → embedded browser PDF viewer (#page=N jumps)
 *   - images → zoomable preview
 *   - text   → monospace reader
 *   - else   → friendly fallback with an authenticated download
 *
 * The file URL comes from GET /api/textbooks/:id/file-url (presigned,
 * ownership-checked server-side).
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  Loader2Icon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { authFetch } from "@/lib/auth";
import type { MaterialRef } from "./material-link";
import {
  fetchMaterialDetails,
  invalidateMaterialCache,
  useMaterialViewer,
  type MaterialDetails,
} from "./material-viewer-store";
import { statusDotClass } from "./MaterialChipCard";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3004";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; details: MaterialDetails; url: string }
  | { kind: "error"; code: string };

// ── Download helper (authenticated stream → blob) ───────────────────────────

async function downloadMaterial(ref: MaterialRef, fileName?: string): Promise<void> {
  const res = await authFetch(`${BACKEND_URL}/api/textbooks/${encodeURIComponent(ref.id)}/file`);
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = fileName || "material.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

// ── Body: resolves one material and renders its content ─────────────────────

const MaterialBody = ({ material }: { material: MaterialRef }) => {
  const { t } = useTranslation("materials");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [page, setPage] = useState(1);
  const [zoomed, setZoomed] = useState(false);
  // Bumped by the retry button — the fetch effect keys on it so a failed
  // load can actually re-run (material alone never changes on retry).
  const [reloadNonce, setReloadNonce] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setState({ kind: "loading" });
    setPage(1);
    setZoomed(false);

    let cancelled = false;
    (async () => {
      try {
        const details = await fetchMaterialDetails(material);
        if (!cancelled && requestId === requestIdRef.current) {
          if (details.url) {
            setState({ kind: "ready", details, url: details.url });
          } else {
            setState({ kind: "error", code: details.source === "local" ? "NO_PREVIEW" : "NOT_READY" });
          }
        }
      } catch (err) {
        if (!cancelled && requestId === requestIdRef.current) {
          invalidateMaterialCache(material.id);
          setState({ kind: "error", code: err instanceof Error ? err.message : "FETCH_FAILED" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [material, reloadNonce]);

  const totalPages = state.kind === "ready" ? state.details.totalPages || null : null;
  const isPdf =
    state.kind === "ready" &&
    (state.details.mimeType === "application/pdf" ||
      !!state.details.fileName?.toLowerCase().endsWith(".pdf"));
  const isImage = state.kind === "ready" && state.details.mimeType.startsWith("image/");
  const isText =
    state.kind === "ready" &&
    (state.details.mimeType.startsWith("text/") || state.details.mimeType === "application/json");

  const goToPage = useCallback(
    (next: number) => {
      if (!totalPages) return;
      setPage(Math.min(Math.max(next, 1), totalPages));
    },
    [totalPages]
  );

  // Keyboard page navigation while a PDF is open (viewer is forced LTR,
  // so ArrowRight always means "next page" physically).
  useEffect(() => {
    if (state.kind !== "ready" || !isPdf || !totalPages || totalPages <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goToPage(page + 1);
      else if (e.key === "ArrowLeft") goToPage(page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, isPdf, totalPages, page, goToPage]);

  const handleDownload = useCallback(async () => {
    try {
      toast.info(t("download.started"));
      await downloadMaterial(material, state.kind === "ready" ? state.details.fileName : undefined);
      toast.success(t("download.done"));
    } catch {
      toast.error(t("download.failed"));
    }
  }, [material, state, t]);

  if (state.kind === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/30">
        <Loader2Icon className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{t("viewer.loading")}</p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/30 px-6 text-center">
        <span className="rounded-full bg-amber-500/10 p-3 text-amber-500">
          <AlertTriangleIcon className="size-7" />
        </span>
        <p className="max-w-sm text-sm font-medium text-foreground">
          {state.code === "NOT_FOUND"
            ? t("viewer.errorNotFound")
            : state.code === "STORAGE_UNAVAILABLE"
              ? t("viewer.errorStorage")
              : state.code === "NOT_READY"
                ? t("viewer.errorNotReady")
                : t("viewer.errorGeneric")}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            invalidateMaterialCache(material.id);
            setReloadNonce((n) => n + 1);
          }}>
            <RefreshCwIcon className="size-4" />
            {t("viewer.retry")}
          </Button>
          <Button size="sm" onClick={handleDownload}>
            <DownloadIcon className="size-4" />
            {t("viewer.download")}
          </Button>
        </div>
      </div>
    );
  }

  const { details, url } = state;

  return (
    <div className="relative h-full min-h-0">
      <AnimatePresence mode="wait">
        <motion.div
          key={`${details.textbookId}:${isPdf ? page : "single"}:${zoomed}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="h-full w-full"
        >
          {isPdf && (
            <iframe
              src={`${url}#page=${page}&view=FitH`}
              title={details.fileName}
              className="h-full w-full border-0 bg-white"
              dir="ltr"
            />
          )}

          {isImage && (
            <div
              className={cn(
                "flex h-full w-full items-center justify-center overflow-auto bg-[repeating-conic-gradient(#e5e5e5_0%_25%,white_0%_50%)] bg-[length:16px_16px]",
                zoomed && "cursor-zoom-out p-6"
              )}
              onClick={() => setZoomed((z) => !z)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setZoomed((z) => !z)}
            >
              <img
                src={url}
                alt={details.fileName}
                className={cn(
                  "rounded-lg shadow-lg transition-transform duration-200",
                  zoomed ? "max-h-none max-w-none scale-150" : "max-h-full max-w-full object-contain"
                )}
              />
            </div>
          )}

          {isText && <TextPreview material={material} />}

          {!isPdf && !isImage && !isText && (
            <div className="flex h-full flex-col items-center justify-center gap-4 bg-muted/30 px-6 text-center">
              <span className="rounded-full bg-primary/10 p-4 text-primary">
                <FileTextIcon className="size-8" />
              </span>
              <div>
                <p className="text-sm font-medium">{details.fileName}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("viewer.noInlinePreview")}</p>
              </div>
              <Button size="sm" onClick={handleDownload}>
                <DownloadIcon className="size-4" />
                {t("viewer.download")}
              </Button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Floating PDF pager */}
      {isPdf && totalPages != null && totalPages > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "absolute bottom-4 left-1/2 z-10 -translate-x-1/2",
            "flex items-center gap-1 rounded-full border border-border/60 bg-background/90 px-1.5 py-1 shadow-lg backdrop-blur-md"
          )}
          dir="ltr"
        >
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            aria-label={t("viewer.prevPage")}
            className="rounded-full p-1.5 text-foreground/80 transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          <span className="min-w-[5.5rem] text-center text-xs font-medium tabular-nums">
            {t("viewer.pageOf", { page, total: totalPages })}
          </span>
          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages}
            aria-label={t("viewer.nextPage")}
            className="rounded-full p-1.5 text-foreground/80 transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRightIcon className="size-4" />
          </button>
        </motion.div>
      )}
    </div>
  );
};

/** Small text reader — fetches through the authenticated proxy (no CORS dependency). */
const TextPreview = ({ material }: { material: MaterialRef }) => {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${BACKEND_URL}/api/textbooks/${encodeURIComponent(material.id)}/file`);
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.text();
        if (!cancelled) setText(body.slice(0, 400_000));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [material]);

  if (failed)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Failed to load text.
      </div>
    );
  if (text == null)
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2Icon className="size-6 animate-spin text-primary" />
      </div>
    );

  return (
    <pre
      dir="auto"
      className="h-full w-full overflow-auto whitespace-pre-wrap bg-card p-6 font-mono text-[13px] leading-relaxed text-foreground"
    >
      {text}
    </pre>
  );
};

// ── The dialog shell ─────────────────────────────────────────────────────────

export const MaterialViewerDialog = memo(function MaterialViewerDialog() {
  const { t } = useTranslation("materials");
  const isOpen = useMaterialViewer((s) => s.isOpen);
  const items = useMaterialViewer((s) => s.items);
  const index = useMaterialViewer((s) => s.index);
  const closeMaterialViewer = useMaterialViewer((s) => s.closeMaterialViewer);
  const nextItem = useMaterialViewer((s) => s.nextItem);
  const prevItem = useMaterialViewer((s) => s.prevItem);

  const current = items[index];

  // Warm the presigned-URL cache for neighbouring materials so flipping to
  // the next card doesn't wait on a round-trip.
  useEffect(() => {
    if (!isOpen) return;
    for (const neighbor of [items[index + 1], items[index - 1]]) {
      if (neighbor) fetchMaterialDetails(neighbor).catch(() => {});
    }
  }, [isOpen, items, index]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeMaterialViewer();
    },
    [closeMaterialViewer]
  );

  const handleDownload = useCallback(async () => {
    if (!current) return;
    try {
      toast.info(t("download.started"));
      await downloadMaterial(current);
      toast.success(t("download.done"));
    } catch {
      toast.error(t("download.failed"));
    }
  }, [current, t]);

  const handleOpenExternal = useCallback(() => {
    if (!current) return;
    fetchMaterialDetails(current)
      .then((d) => {
        if (d.url) window.open(d.url, "_blank", "noopener,noreferrer");
        else toast.error(t("viewer.noInlinePreview"));
      })
      .catch(() => toast.error(t("download.failed")));
  }, [current, t]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[92dvh] w-[min(1080px,94vw)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0",
          "[&>button:last-child]:hidden" // custom chrome below owns closing
        )}
      >
        <DialogTitle className="sr-only">{t("viewer.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("viewer.description")}</DialogDescription>

        {current && (
          <header className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-gradient-to-r from-primary/[0.06] via-transparent to-primary/[0.04] px-4 py-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileTextIcon className="size-4.5" />
            </span>
            <span className="min-w-0 flex-1" dir="auto">
              <p className="truncate text-sm font-semibold leading-tight">
                {(current.name || t("card.unnamed")).replace(/\.pdf$/i, "")}
              </p>
              <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                {current.course && <span className="truncate">{current.course}</span>}
                {current.status && (
                  <span className="inline-flex items-center gap-1">
                    <span aria-hidden className={cn("size-1.5 rounded-full", statusDotClass(current.status))} />
                  </span>
                )}
                {items.length > 1 && (
                  <span className="tabular-nums">
                    {index + 1} / {items.length}
                  </span>
                )}
              </p>
            </span>

            <div className="flex shrink-0 items-center gap-1">
              {items.length > 1 && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={prevItem}
                    disabled={index === 0}
                    aria-label={t("viewer.prevMaterial")}
                  >
                    <ChevronRightIcon className="size-4 rtl:rotate-180" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={nextItem}
                    disabled={index >= items.length - 1}
                    aria-label={t("viewer.nextMaterial")}
                  >
                    <ChevronLeftIcon className="size-4 rtl:rotate-180" />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={handleOpenExternal}
                aria-label={t("viewer.openExternal")}
                title={t("viewer.openExternal")}
              >
                <ExternalLinkIcon className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={handleDownload}
                aria-label={t("viewer.download")}
                title={t("viewer.download")}
              >
                <DownloadIcon className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={closeMaterialViewer}
                aria-label={t("viewer.close")}
                title={t("viewer.close")}
              >
                <XIcon className="size-4" />
              </Button>
            </div>
          </header>
        )}

        <div className="min-h-0 flex-1">
          {current ? <MaterialBody key={current.id} material={current} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
});

export default MaterialViewerDialog;
