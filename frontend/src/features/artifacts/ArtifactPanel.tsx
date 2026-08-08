import { useState, useEffect, useCallback, useRef } from "react";
import { Maximize2Icon, Minimize2Icon, RefreshCwIcon, XIcon } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ArtifactViewer } from "./ArtifactViewer";

interface Artifact {
  id: string;
  type: string;
  title: string;
  content: string;
  language?: string;
  created_at: string;
}

interface ArtifactPanelProps {
  open: boolean;
  onClose: () => void;
  activeArtifactId?: string | null;
}

export function ArtifactPanel({ open, onClose, activeArtifactId }: ArtifactPanelProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLatest = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch("/api/artifacts", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const list: Artifact[] = await res.json();
        setArtifacts(list);
        if (activeArtifactId && list.some((artifact) => artifact.id === activeArtifactId)) {
          setActiveId(activeArtifactId);
        } else if (list.length > 0 && !activeId) {
          setActiveId(list[0].id);
        }
      }
    } catch {
      // Keep the panel quiet; chat can continue even if artifact fetch fails.
    } finally {
      setLoading(false);
    }
  }, [activeArtifactId, activeId]);

  useEffect(() => {
    if (open) fetchLatest();
  }, [open, fetchLatest]);

  useEffect(() => {
    if (!open || typeof supabase?.channel !== "function") return;

    const channel = supabase
      .channel("artifacts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "artifacts" },
        () => fetchLatest()
      )
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") {
          fallbackRef.current = setInterval(fetchLatest, 15000);
        }
      });

    return () => {
      if (typeof supabase?.removeChannel === "function" && channel) {
        supabase.removeChannel(channel);
      }
      if (fallbackRef.current) {
        clearInterval(fallbackRef.current);
        fallbackRef.current = null;
      }
    };
  }, [open, fetchLatest]);

  const activeArtifact = artifacts.find((a) => a.id === activeId);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-y-0 right-0 z-40 flex h-full flex-col overflow-hidden border-l border-border bg-background/95 shadow-2xl backdrop-blur-xl transition-[width] duration-200 md:relative md:z-auto ${
        expanded ? "w-full md:w-[min(920px,58vw)]" : "w-full md:w-[min(680px,44vw)]"
      }`}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Artifacts</h2>
          <p className="truncate text-[11px] text-muted-foreground">Preview, inspect code, or open full page</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchLatest}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title="Refresh"
          >
            <RefreshCwIcon className="size-4" />
          </button>
          <button
            onClick={() => setExpanded((value) => !value)}
            className="hidden size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground md:flex"
            title={expanded ? "Compact panel" : "Wide panel"}
          >
            {expanded ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
          </button>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>

      {artifacts.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 py-2">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              onClick={() => setActiveId(artifact.id)}
              className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                artifact.id === activeId
                  ? "bg-primary/15 text-primary"
                  : "bg-muted/20 text-muted-foreground hover:text-foreground"
              }`}
            >
              {artifact.title}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading && artifacts.length === 0 ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-lg bg-muted/20" />
            ))}
          </div>
        ) : activeArtifact ? (
          <ArtifactViewer artifact={activeArtifact} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-sm text-muted-foreground">
            <svg className="mb-3 size-10 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p>No artifacts yet</p>
            <p className="mt-1 text-xs">Ask Sigma to create a web page, chart, diagram, or code artifact.</p>
          </div>
        )}
      </div>
    </div>
  );
}
