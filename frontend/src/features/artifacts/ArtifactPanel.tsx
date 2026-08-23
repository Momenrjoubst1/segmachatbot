import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLinkIcon,
  Maximize2Icon,
  Minimize2Icon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabaseClient";
import type { Artifact } from "@/lib/artifacts-api";
import { listArtifacts } from "@/lib/artifacts-api";
import { ARTIFACT_TYPE_META } from "./artifact-utils";
import { ArtifactViewer } from "./ArtifactViewer";

interface ArtifactPanelProps {
  open: boolean;
  onClose: () => void;
  activeArtifactId?: string | null;
  /** Ask the host layout to open the panel (auto-open on new artifact). */
  onRequestOpen?: () => void;
  /** When set, the panel only shows artifacts from this conversation. */
  threadId?: string | null;
}

export function ArtifactPanel({ open, onClose, activeArtifactId, onRequestOpen, threadId }: ArtifactPanelProps) {
  const { t } = useTranslation("artifacts");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isFetchingArtifacts, setIsFetchingArtifacts] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const fallbackTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Latest-value refs keep the realtime subscription stable across parent
  // re-renders (onRequestOpen is usually an inline arrow in the layout).
  const onRequestOpenRef = useRef(onRequestOpen);
  onRequestOpenRef.current = onRequestOpen;
  const openRef = useRef(open);
  openRef.current = open;

  const fetchLatest = useCallback(async () => {
    setIsFetchingArtifacts(true);
    try {
      const list = await listArtifacts(threadId ? { threadId } : {});
      setArtifacts(list);
      setActiveId((current) => {
        if (activeArtifactId && list.some((artifact) => artifact.id === activeArtifactId)) {
          return activeArtifactId;
        }
        if (current && list.some((artifact) => artifact.id === current)) return current;
        return list[0]?.id ?? null;
      });
    } catch {
      // Keep the panel quiet; chat can continue even if artifact fetch fails.
    } finally {
      setIsFetchingArtifacts(false);
    }
  }, [activeArtifactId, threadId]);

  useEffect(() => {
    fetchLatest();
  }, [fetchLatest]);

  // Realtime subscription stays live even while the panel is closed so a new
  // artifact created by the assistant pops the panel open immediately.
  useEffect(() => {
    if (typeof supabase?.channel !== "function") return;

    let ownerId: string | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        ownerId = data?.user?.id ?? null;
      } catch {
        ownerId = null;
      }
      if (cancelled) return;

      channel = supabase
        .channel("artifacts-live")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "artifacts",
            ...(ownerId ? { filter: `owner_id=eq.${ownerId}` } : {}),
          },
          (payload: { eventType?: string; new?: Record<string, unknown> }) => {
            void fetchLatest();
            if (payload.eventType === "INSERT" && typeof payload.new?.id === "string") {
              setActiveId(payload.new.id);
              if (!openRef.current) onRequestOpenRef.current?.();
            }
          },
        )
        .subscribe((status: string) => {
          // Realtime unavailable (local dev without the publication): poll.
          if (status !== "SUBSCRIBED" && !fallbackTimer.current) {
            fallbackTimer.current = setInterval(() => void fetchLatest(), 15000);
          }
        });
    })();

    return () => {
      cancelled = true;
      if (typeof supabase?.removeChannel === "function" && channel) {
        void supabase.removeChannel(channel);
      }
      if (fallbackTimer.current) {
        clearInterval(fallbackTimer.current);
        fallbackTimer.current = null;
      }
    };
  }, [fetchLatest]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return artifacts;
    return artifacts.filter((artifact) => artifact.title.toLowerCase().includes(query));
  }, [artifacts, search]);

  const activeArtifact = filtered.find((a) => a.id === activeId) ?? artifacts.find((a) => a.id === activeId);

  const handleChanged = useCallback((updated: Artifact) => {
    setArtifacts((prev) => prev.map((artifact) => (artifact.id === updated.id ? updated : artifact)));
  }, []);

  const handleDeleted = useCallback(() => {
    setArtifacts((prev) => {
      const next = prev.filter((artifact) => artifact.id !== activeId);
      setActiveId(next[0]?.id ?? null);
      return next;
    });
  }, [activeId]);

  return (
    <div
      aria-hidden={!open}
      className={`fixed inset-y-0 right-0 z-40 h-full flex-col overflow-hidden border-l border-border bg-background/95 shadow-2xl backdrop-blur-xl transition-[width] duration-200 md:relative md:z-auto ${
        open ? "flex" : "hidden"
      } ${expanded ? "w-full md:w-[min(980px,62vw)]" : "w-full md:w-[min(720px,48vw)]"}`}
      dir="ltr"
      data-testid="artifact-panel"
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {t("panel.title")}
            {artifacts.length > 0 && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{artifacts.length}</span>
            )}
          </h2>
          <p className="truncate text-[11px] text-muted-foreground">{t("panel.subtitle")}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchLatest}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title={t("panel.refresh")}
          >
            <RefreshCwIcon className="size-4" />
          </button>
          <a
            href="/artifacts"
            className="hidden size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground md:flex"
            title={t("panel.library")}
          >
            <ExternalLinkIcon className="size-4" />
          </a>
          <button
            onClick={() => setExpanded((value) => !value)}
            className="hidden size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground md:flex"
            title={expanded ? t("panel.compact") : t("panel.wide")}
          >
            {expanded ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
          </button>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title={t("panel.close")}
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>

      {/* ── Body: sidebar list + viewer ────────────────────────── */}
      {artifacts.length === 0 ? (
        <EmptyState isFetching={isFetchingArtifacts} hint={t("panel.emptyHint")} title={t("panel.emptyTitle")} />
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Sidebar (desktop) */}
          <aside className="hidden w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-muted/10 p-2 md:flex">
            <div className="relative mb-1">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("panel.search")}
                className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none focus:border-primary/50"
              />
            </div>
            {filtered.map((artifact) => {
              const meta = ARTIFACT_TYPE_META[artifact.type];
              return (
                <button
                  key={artifact.id}
                  onClick={() => setActiveId(artifact.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start transition-colors ${
                    artifact.id === activeId
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                  }`}
                >
                  <span aria-hidden className="shrink-0 text-sm">{meta?.icon ?? "📄"}</span>
                  <span className="min-w-0 flex-1 truncate text-xs">{artifact.title}</span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">{t("panel.noMatches")}</p>
            )}
          </aside>

          {/* Chips strip (mobile) */}
          <div className="absolute inset-x-0 top-12 z-10 flex gap-1 overflow-x-auto border-b border-border bg-background/95 px-3 py-2 backdrop-blur md:hidden">
            {filtered.map((artifact) => (
              <button
                key={artifact.id}
                onClick={() => setActiveId(artifact.id)}
                className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                  artifact.id === activeId
                    ? "bg-primary/15 text-primary"
                    : "bg-muted/20 text-muted-foreground hover:text-foreground"
                }`}
              >
                {ARTIFACT_TYPE_META[artifact.type]?.icon} {artifact.title}
              </button>
            ))}
          </div>

          {/* Viewer */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-14 md:pt-4">
            {activeArtifact ? (
              <ArtifactViewer
                key={activeArtifact.id}
                artifact={activeArtifact}
                onChanged={handleChanged}
                onDeleted={handleDeleted}
              />
            ) : (
              <EmptyState isFetching={isFetchingArtifacts} hint={t("panel.noMatches")} title={t("panel.emptyTitle")} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ isFetching, title, hint }: { isFetching: boolean; title: string; hint: string }) {
  const { t } = useTranslation("artifacts");
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {isFetching ? (
        <RefreshCwIcon className="mb-3 size-6 animate-spin opacity-50" />
      ) : (
        <svg className="mb-3 size-10 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )}
      <p>{title}</p>
      <p className="mt-1 max-w-xs text-xs">{hint}</p>
      <p className="mt-3 rounded-full border border-border px-2.5 py-1 text-[10px] uppercase tracking-wide opacity-70">
        Ctrl + Shift + A
      </p>
      <span className="sr-only">{t("panel.shortcutHint")}</span>
    </div>
  );
}
