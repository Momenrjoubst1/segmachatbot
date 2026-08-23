import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  ClockIcon,
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  ExternalLinkIcon,
  GlobeIcon,
  HistoryIcon,
  Loader2Icon,
  LockIcon,
  PencilIcon,
  Trash2Icon,
  TypeIcon,
  XIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { CodeIDEArtifact } from "@/components/ui/code-ide-artifact";
import { getAssistantAuthHeaders } from "@/lib/auth";
import type { Artifact, ArtifactVersion } from "@/lib/artifacts-api";
import * as api from "@/lib/artifacts-api";
import {
  ARTIFACT_TYPE_META,
  downloadArtifactFile,
} from "./artifact-utils";
import {
  ChartViewer,
  CodeHighlight,
  HtmlPreview,
  MarkdownViewer,
  MermaidViewer,
  QuizViewer,
  SvgViewer,
} from "./viewers";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

interface ArtifactViewerProps {
  artifact: Artifact;
  /** Called after any persisted change (edit/save/revert/share) so lists can refetch. */
  onChanged?: (artifact: Artifact) => void;
  /** Called after the artifact was deleted. */
  onDeleted?: () => void;
  /** Hide mutation controls (e.g. viewing someone else's public artifact). */
  readOnly?: boolean;
}

export function ArtifactViewer({ artifact, onChanged, onDeleted, readOnly = false }: ArtifactViewerProps) {
  const { t } = useTranslation(["artifacts", "common"]);
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
  const [draftContent, setDraftContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<ArtifactVersion[] | null>(null);
  const [revertingVersion, setRevertingVersion] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  const meta = ARTIFACT_TYPE_META[artifact.type];
  const canPreview = artifact.type !== "code" && artifact.type !== "ide";
  const showPreview = canPreview && viewMode === "preview";
  const isEditing = draftContent !== null;
  const fullPageUrl = `${window.location.origin}/artifacts/${artifact.id}`;
  const googleFonts = useMemo(() => detectGoogleFonts(artifact.content), [artifact.content]);
  const updatedLabel = useMemo(
    () =>
      new Date(artifact.updated_at ?? artifact.created_at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [artifact.updated_at, artifact.created_at],
  );

  // Reset transient UI when switching between artifacts.
  useEffect(() => {
    setViewMode(canPreview ? "preview" : "code");
    setDraftContent(null);
    setVersionsOpen(false);
    setVersions(null);
    setConfirmingDelete(false);
    setTitleDraft(null);
  }, [artifact.id, canPreview]);

  const handleSaveEdit = useCallback(async () => {
    if (draftContent === null || draftContent === artifact.content) {
      setDraftContent(null);
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateArtifact(artifact.id, { content: draftContent });
      toast.success(t("artifacts:saved"));
      setDraftContent(null);
      onChanged?.(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common:error"));
    } finally {
      setSaving(false);
    }
  }, [draftContent, artifact.id, artifact.content, onChanged, t]);

  const handleRename = useCallback(async () => {
    if (titleDraft === null) return;
    const nextTitle = titleDraft.trim();
    setTitleDraft(null);
    if (!nextTitle || nextTitle === artifact.title) return;
    try {
      const updated = await api.updateArtifact(artifact.id, { title: nextTitle });
      toast.success(t("artifacts:renamed"));
      onChanged?.(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common:error"));
    }
  }, [titleDraft, artifact.id, artifact.title, onChanged, t]);

  const toggleVersions = useCallback(async () => {
    const next = !versionsOpen;
    setVersionsOpen(next);
    if (next && versions === null) {
      try {
        setVersions(await api.listVersions(artifact.id));
      } catch {
        setVersions([]);
      }
    }
  }, [versionsOpen, versions, artifact.id]);

  const handleRevert = useCallback(async (version: number) => {
    setRevertingVersion(version);
    try {
      const updated = await api.revertToVersion(artifact.id, version);
      toast.success(t("artifacts:revertedTo", { version }));
      setVersionsOpen(false);
      onChanged?.(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common:error"));
    } finally {
      setRevertingVersion(null);
    }
  }, [artifact.id, onChanged, t]);

  const handleShareToggle = useCallback(async () => {
    const nextVisibility = artifact.visibility === "public" ? "private" : "public";
    try {
      const updated = await api.setVisibility(artifact.id, nextVisibility);
      if (nextVisibility === "public") {
        await navigator.clipboard.writeText(fullPageUrl).catch(() => undefined);
        toast.success(t("artifacts:shareCopied"));
      } else {
        toast.success(t("artifacts:madePrivate"));
      }
      onChanged?.(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common:error"));
    }
  }, [artifact.id, artifact.visibility, fullPageUrl, onChanged, t]);

  const handleCopyLink = useCallback(async () => {
    await navigator.clipboard.writeText(fullPageUrl);
    toast.success(t("artifacts:linkCopied"));
  }, [fullPageUrl, t]);

  const handleDelete = useCallback(async () => {
    try {
      await api.deleteArtifact(artifact.id);
      toast.success(t("artifacts:deleted"));
      onDeleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common:error"));
    }
  }, [artifact.id, onDeleted, t]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={`rounded-full border border-border bg-muted/20 px-2 py-0.5 text-[10px] font-medium uppercase ${meta?.tint ?? ""}`}>
            {meta?.icon} {t(meta?.labelKey ?? "artifacts:type.code")}
          </span>
          {titleDraft !== null ? (
            <span className="inline-flex items-center gap-1">
              <input
                autoFocus
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleRename();
                  if (event.key === "Escape") setTitleDraft(null);
                }}
                className="h-7 w-48 rounded-md border border-primary/40 bg-background px-2 text-sm"
              />
              <button
                type="button"
                onClick={() => void handleRename()}
                className="flex size-6 items-center justify-center rounded-md hover:bg-muted/50"
                aria-label={t("artifacts:saveTitle")}
              >
                <CheckIcon className="size-3.5 text-green-500" />
              </button>
              <button
                type="button"
                onClick={() => setTitleDraft(null)}
                className="flex size-6 items-center justify-center rounded-md hover:bg-muted/50"
                aria-label={t("common:cancel")}
              >
                <XIcon className="size-3.5 text-muted-foreground" />
              </button>
            </span>
          ) : (
            <h3
              className={`max-w-full truncate font-semibold text-sm ${readOnly ? "" : "cursor-text hover:underline decoration-dotted"}`}
              title={readOnly ? artifact.title : t("artifacts:clickToRename")}
              onClick={() => {
                if (!readOnly) setTitleDraft(artifact.title);
              }}
            >
              {artifact.title}
            </h3>
          )}
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            v{artifact.version}
          </span>
          <span className="hidden items-center gap-1 text-[11px] text-muted-foreground md:inline-flex" title={updatedLabel}>
            <ClockIcon className="size-3" />
            {updatedLabel}
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={() => void handleShareToggle()}
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                artifact.visibility === "public"
                  ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                  : "bg-muted/20 text-muted-foreground hover:text-foreground"
              }`}
              title={t(artifact.visibility === "public" ? "artifacts:publicTooltip" : "artifacts:privateTooltip")}
            >
              {artifact.visibility === "public" ? <GlobeIcon className="size-3" /> : <LockIcon className="size-3" />}
              {t(artifact.visibility === "public" ? "artifacts:shared" : "artifacts:private")}
            </button>
          )}
          {googleFonts.length > 0 && (
            <span
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300"
              title={`Google Fonts: ${googleFonts.join(", ")}`}
            >
              <TypeIcon className="size-2.5" />
              <span className="truncate">
                {googleFonts.length <= 2 ? googleFonts.join(", ") : `${googleFonts[0]} +${googleFonts.length - 1}`}
              </span>
            </span>
          )}
        </div>

        {/* ── Actions ─────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(canPreview || artifact.type === "ide") && (
            <div className="flex rounded-lg border border-border bg-muted/20 p-0.5">
              {canPreview && (
                <button
                  type="button"
                  onClick={() => {
                    if (isEditing) setDraftContent(null);
                    setViewMode("preview");
                  }}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs transition-colors ${
                    showPreview ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <EyeIcon className="size-3.5" />
                  {t("artifacts:preview")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setViewMode("code")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs transition-colors ${
                  !showPreview ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Code2Icon className="size-3.5" />
                {t("artifacts:code")}
              </button>
            </div>
          )}

          {!readOnly && (
            <ToolbarButton
              icon={<HistoryIcon className="size-3.5" />}
              label={`${t("artifacts:history")} (v${artifact.version})`}
              onClick={() => void toggleVersions()}
            />
          )}
          <ToolbarButton
            icon={<DownloadIcon className="size-3.5" />}
            label={t("artifacts:download")}
            onClick={() => downloadArtifactFile(artifact.title, artifact.type, artifact.content, artifact.language)}
          />
          <ToolbarButton
            icon={<CopyIcon className="size-3.5" />}
            label={t("artifacts:copyCode")}
            onClick={async () => {
              await navigator.clipboard.writeText(artifact.content);
              toast.success(t("artifacts:copied"));
            }}
          />
          <ToolbarButton
            icon={<ExternalLinkIcon className="size-3.5" />}
            label={t("artifacts:fullPage")}
            onClick={async () => {
              await navigator.clipboard.writeText(fullPageUrl).catch(() => undefined);
              window.open(fullPageUrl, "_blank", "noopener,noreferrer");
            }}
          />
          <ToolbarButton
            icon={<CopyIcon className="size-3.5" />}
            label={t("artifacts:link")}
            onClick={() => void handleCopyLink()}
          />
          {!readOnly && (
            confirmingDelete ? (
              <span className="inline-flex h-8 items-center gap-1 rounded-lg bg-red-500/10 px-2 text-xs text-red-400">
                {t("artifacts:deleteConfirm")}
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="rounded bg-red-500/20 px-1.5 py-0.5 font-semibold hover:bg-red-500/30"
                >
                  {t("common:yes")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded px-1.5 py-0.5 hover:bg-red-500/20"
                >
                  {t("common:no")}
                </button>
              </span>
            ) : (
              <ToolbarButton
                icon={<Trash2Icon className="size-3.5" />}
                label={t("artifacts:delete")}
                danger
                onClick={() => setConfirmingDelete(true)}
              />
            )
          )}
        </div>
      </div>

      {/* ── Version history dropdown ───────────────────────────── */}
      {versionsOpen && (
        <div className="shrink-0 rounded-lg border border-border bg-card p-2 shadow-lg" data-testid="version-history">
          <p className="px-2 pb-1 text-xs font-semibold text-muted-foreground">{t("artifacts:versionHistory")}</p>
          {versions === null ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" /> {t("artifacts:loadingVersions")}
            </div>
          ) : versions.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t("artifacts:noVersions")}</p>
          ) : (
            <ul className="max-h-56 space-y-0.5 overflow-auto">
              {versions.map((version) => (
                <li key={version.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/30">
                  <div className="min-w-0">
                    <span className="font-mono font-semibold">v{version.version}</span>{" "}
                    <span className="text-muted-foreground">{version.change_summary ?? t("artifacts:noSummary")}</span>{" "}
                    <span className="text-[10px] opacity-60">{new Date(version.created_at).toLocaleString()}</span>
                  </div>
                  {version.version !== artifact.version && (
                    <button
                      type="button"
                      disabled={revertingVersion !== null}
                      onClick={() => void handleRevert(version.version)}
                      className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      {revertingVersion === version.version ? <Loader2Icon className="size-3 animate-spin" /> : t("artifacts:restore")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1">
        {showPreview ? (
          <PreviewBody artifact={artifact} />
        ) : artifact.type === "ide" ? (
          <IDEBody artifact={artifact} />
        ) : isEditing ? (
          <div className="flex h-full min-h-[420px] flex-col gap-2">
            <textarea
              value={draftContent ?? ""}
              onChange={(event) => setDraftContent(event.target.value)}
              spellCheck={false}
              dir="ltr"
              className="h-full w-full flex-1 resize-none rounded-lg border border-primary/40 bg-zinc-950 p-4 font-mono text-sm leading-relaxed text-zinc-100 outline-none"
              data-testid="artifact-editor"
            />
            <div className="flex shrink-0 items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDraftContent(null)}
                className="inline-flex h-8 items-center rounded-lg bg-muted/30 px-3 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                {t("common:cancel")}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveEdit()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                {saving && <Loader2Icon className="size-3.5 animate-spin" />}
                {t("artifacts:saveChanges")}
              </button>
            </div>
          </div>
        ) : (
          <div className="relative flex h-full min-h-[420px] flex-col rounded-lg border border-border bg-card">
            <div className="min-h-0 flex-1 overflow-hidden pt-2">
              <CodeHighlight content={artifact.content} language={artifact.language} />
            </div>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setDraftContent(artifact.content)}
                className="absolute right-3 top-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-background/80 px-3 text-xs text-muted-foreground shadow backdrop-blur transition-colors hover:bg-background hover:text-foreground"
              >
                <PencilIcon className="size-3.5" />
                {t("artifacts:editCode")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors ${
        danger
          ? "bg-red-500/5 text-red-400 hover:bg-red-500/15"
          : "bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      }`}
    >
      {icon}
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

function PreviewBody({ artifact }: { artifact: Artifact }) {
  switch (artifact.type) {
    case "html":
    case "react":
      return <HtmlPreview content={artifact.content} />;
    case "svg":
      return <SvgViewer content={artifact.content} />;
    case "mermaid":
      return <MermaidViewer content={artifact.content} />;
    case "markdown":
      return <MarkdownViewer content={artifact.content} />;
    case "chart":
      return <ChartViewer content={artifact.content} />;
    case "quiz":
      return <QuizViewer content={artifact.content} />;
    default:
      return <CodeHighlight content={artifact.content} language={artifact.language} />;
  }
}

function IDEBody({ artifact }: { artifact: Artifact }) {
  let project: { projectName?: string; files: unknown } | null = null;
  try {
    project = JSON.parse(artifact.content);
  } catch {
    project = null;
  }

  if (!project || !project.files) {
    return <div className="p-4 text-sm text-muted-foreground">Invalid IDE project data</div>;
  }

  const handleExecute = async (code: string, language: string) => {
    try {
      const headers = await getAssistantAuthHeaders();
      const response = await fetch(`${BACKEND_URL}/api/tools/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify({ code, language }),
      });
      const result = await response.json();
      if (!response.ok) {
        return { success: false, error: result?.error || `Execution failed (HTTP ${response.status})` };
      }
      return { success: result.status === "success", output: result.output, error: result.error };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : "Code execution failed" };
    }
  };

  return (
    <CodeIDEArtifact
      initialProject={{
        name: project.projectName || "My Project",
        files: project.files as never,
      }}
      onExecute={handleExecute}
    />
  );
}

/** Detect Google Fonts families embedded in the artifact's HTML head links. */
function detectGoogleFonts(content: string): string[] {
  const families = new Set<string>();
  const re = /fonts\.googleapis\.com\/css2[^"'<>)\s]*family=([^"'<>)\s&]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const raw = decodeURIComponent(match[1]);
    const name = raw.split(":")[0].replace(/\+/g, " ").trim();
    if (name) families.add(name);
  }
  return Array.from(families);
}
