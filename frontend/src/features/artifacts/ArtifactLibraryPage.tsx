import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlobeIcon, Loader2Icon, LockIcon, SearchIcon, ShapesIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Artifact } from "@/lib/artifacts-api";
import { listArtifacts } from "@/lib/artifacts-api";
import { ARTIFACT_TYPE_META } from "./artifact-utils";

/**
 * Artifact library (`/artifacts`) — every artifact the user owns, with search
 * and type filters. Claude-style layout: centered title, top-right search +
 * "New artifact" actions, illustrated empty state.
 */
export function ArtifactLibraryPage() {
  const { t } = useTranslation("artifacts");
  const navigate = useNavigate();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

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
      if (query && !artifact.title.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [artifacts, search]);

  // Start a new chat where the user can ask Sigma to build an artifact.
  const newArtifact = () => navigate("/");

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto p-6">
      {/* Claude-style header: centered title, actions pinned right */}
      <header className="relative mb-8 flex items-center justify-center">
        <h1 className="text-[28px] font-bold tracking-tight">
          {t("library.title", { defaultValue: "Artifacts" })}
        </h1>
        <div className="absolute end-0 flex items-center gap-2">
          {searchOpen ? (
            <div className="relative w-72">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("panel.search")}
                className="h-10 w-full rounded-lg border border-[#2C2825]/50 bg-white pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(false);
                  setSearch("");
                }}
                aria-label={t("library.clearSearch", { defaultValue: "Close search" })}
                className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label={t("panel.search")}
              className="flex size-9 items-center justify-center rounded-full border border-border bg-white transition-colors hover:bg-[#F9F6F0]"
            >
              <SearchIcon className="size-4 text-[#2C2825]" />
            </button>
          )}
          <button
            type="button"
            onClick={newArtifact}
            className="rounded-full bg-[#1a1a19] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#3d3a37]"
          >
            {t("library.newArtifact", { defaultValue: "New artifact" })}
          </button>
        </div>
      </header>

      {status === "loading" ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : status === "error" ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t("library.loadError")}</div>
      ) : artifacts.length === 0 ? (
        /* Claude-style illustrated empty state */
        <div className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
          <ShapesIcon className="size-16 text-[#2C2825]" strokeWidth={1.1} />
          <h2 className="mt-5 text-lg font-semibold text-foreground">
            {t("library.buildTitle", {
              defaultValue: "What will you build with artifacts?",
            })}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {t("library.buildHint", {
              defaultValue:
                "If you can dream it, you can build it. Take apps, games, templates, and tools from thought to reality.",
            })}
          </p>
          <button
            type="button"
            onClick={newArtifact}
            className="mt-6 rounded-xl border border-[#EBE5DF] bg-white px-5 py-2.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-[#F9F6F0]"
          >
            {t("library.newArtifact", { defaultValue: "New artifact" })}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("library.noMatches", { defaultValue: "No artifacts match your search." })}
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
    </div>
  );
}
