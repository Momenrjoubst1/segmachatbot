import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GlobeIcon, Loader2Icon, LockIcon, SearchIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Artifact } from "@/lib/artifacts-api";
import { listArtifacts } from "@/lib/artifacts-api";
import { ARTIFACT_TYPE_META } from "./artifact-utils";

const FILTER_TYPES = ["html", "react", "svg", "mermaid", "markdown", "code", "chart", "quiz", "ide"];

/**
 * Artifact library (`/artifacts`) — every artifact the user owns, with search
 * and type filters. Mirrors claude.ai/artifacts.
 */
export function ArtifactLibraryPage() {
  const { t } = useTranslation("artifacts");
  const navigate = useNavigate();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listArtifacts();
        if (!cancelled) {
          setArtifacts(list);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return artifacts.filter((artifact) => {
      if (typeFilter && artifact.type !== typeFilter) return false;
      if (query && !artifact.title.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [artifacts, search, typeFilter]);

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">{t("library.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("library.subtitle")}</p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 md:max-w-sm">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("panel.search")}
            className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={typeFilter === null} onClick={() => setTypeFilter(null)}>
            {t("library.all")}
          </FilterChip>
          {FILTER_TYPES.map((type) => (
            <FilterChip key={type} active={typeFilter === type} onClick={() => setTypeFilter(type)}>
              {ARTIFACT_TYPE_META[type]?.icon} {t(ARTIFACT_TYPE_META[type]?.labelKey ?? "artifacts:type.code")}
            </FilterChip>
          ))}
        </div>
      </div>

      {status === "loading" ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : status === "error" ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t("library.loadError")}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-sm text-muted-foreground">
          <p>{t("library.emptyTitle")}</p>
          <p className="mt-1 max-w-sm text-xs">{t("library.emptyHint")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 pb-8 sm:grid-cols-2 lg:grid-cols-3" data-testid="artifact-grid">
          {filtered.map((artifact) => {
            const meta = ARTIFACT_TYPE_META[artifact.type];
            return (
              <button
                key={artifact.id}
                onClick={() => navigate(`/artifacts/${artifact.id}`)}
                className="group flex h-44 flex-col rounded-xl border border-border bg-card p-4 text-start shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold uppercase ${meta?.tint ?? ""}`}>
                    {meta?.icon} {t(meta?.labelKey ?? "artifacts:type.code")}
                  </span>
                  {artifact.visibility === "public" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                      <GlobeIcon className="size-3" /> {t("artifacts:shared")}
                    </span>
                  ) : (
                    <LockIcon className="size-3 text-muted-foreground opacity-50" />
                  )}
                </div>
                <h3 className="mt-2 line-clamp-2 font-semibold group-hover:text-primary">{artifact.title}</h3>
                <p dir="auto" className="mt-1 line-clamp-3 flex-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                  {artifact.content.slice(0, 220)}
                </p>
                <time className="mt-2 text-[11px] text-muted-foreground">
                  {new Date(artifact.updated_at ?? artifact.created_at).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })}{" "}
                  · v{artifact.version}
                </time>
              </button>
            );
          })}
        </div>
      )}

      <footer className="pb-4">
        <Link to="/" className="text-sm text-primary hover:underline">
          ← {t("library.backToChat")}
        </Link>
      </footer>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border bg-background text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
