import { useEffect, useMemo, useState } from "react";
import { Code2Icon, CopyIcon, DownloadIcon, ExternalLinkIcon, EyeIcon, TypeIcon } from "lucide-react";
import DOMPurify from "dompurify";
import { CodeIDEArtifact } from "@/components/ui/code-ide-artifact";

interface Artifact {
  id: string;
  type: string;
  title: string;
  content: string;
  language?: string;
  created_at: string;
}

/**
 * Detect Google Fonts families embedded in an artifact (via
 * `fonts.googleapis.com/css2?family=...&family=...`). Returns the
 * family names without weights/styles, used to show a small badge
 * in the viewer header so users know which fonts are loaded.
 */
function detectGoogleFonts(content: string): string[] {
  const families = new Set<string>();
  const re = /fonts\.googleapis\.com\/css2[^"'<>)\s]*family=([^"'<>)\s&]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const raw = decodeURIComponent(match[1]);
    // strip the weights/styles suffix (":wght@400;700" or ":ital,wght@1,400")
    const name = raw.split(":")[0].replace(/\+/g, " ").trim();
    if (name) families.add(name);
  }
  return Array.from(families);
}

function getArtifactExtension(type: string, language?: string): string {
  if (type === "mermaid") return "mmd";
  if (type === "svg") return "svg";
  if (type === "markdown") return "md";
  if (type === "html" || type === "react") return "html";
  if (type === "chart" || type === "quiz") return "json";
  if (type === "code" && language) return language;
  return "txt";
}

function getArtifactMime(type: string): string {
  if (type === "svg") return "image/svg+xml";
  if (type === "html" || type === "react") return "text/html";
  if (type === "markdown") return "text/markdown";
  if (type === "chart" || type === "quiz") return "application/json";
  if (type === "mermaid") return "text/plain";
  return "text/plain";
}

function toSafeFileName(title: string): string {
  const base = title.trim().replace(/[^a-zA-Z0-9-_\s]/g, "").replace(/\s+/g, "-");
  return base.length > 0 ? base : "artifact";
}

function MermaidViewer({ content }: { content: string }) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg("");

    (async () => {
      try {
        // Dynamic import keeps the heavy mermaid bundle out of the main chunk
        // and is safe to call from a useEffect (browser-only).
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          // 'strict' disables clickable nodes, forces HTML labels to be sanitized
          // by mermaid itself, and rejects inline scripts in diagram source.
          securityLevel: "strict",
        });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg: rendered } = await mermaid.render(id, content);
        if (!cancelled) setSvg(rendered);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Invalid Mermaid diagram");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [content]);

  // Mermaid emits SVG. Pipe through the same DOMPurify sanitizer used by
  // SvgViewer so the rendered diagram can't smuggle <script>, on* handlers,
  // javascript: URLs, or CSS exfiltration payloads.
  const sanitized = useMemo(() => (svg ? sanitizeSvg(svg) : ""), [svg]);

  return (
    <div
      className="flex min-h-[420px] w-full items-center justify-center overflow-auto rounded-lg border border-border bg-card p-4 [&_svg]:h-auto [&_svg]:max-w-full"
    >
      {error ? (
        <div className="text-sm text-red-400">Mermaid error: {error}</div>
      ) : sanitized ? (
        <div dangerouslySetInnerHTML={{ __html: sanitized }} />
      ) : (
        <div className="text-sm text-muted-foreground">Rendering diagram…</div>
      )}
    </div>
  );
}

function HtmlViewer({ content }: { content: string }) {
  const srcDoc = useMemo(() => {
    const isFullDocument = /<!doctype html|<html[\s>]/i.test(content);
    if (isFullDocument) return content;
    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        padding: 20px;
        background: #1e1e2e;
        color: #e0e0e0;
        font-family: system-ui, sans-serif;
      }
    </style>
  </head>
  <body>${content}</body>
</html>`;
  }, [content]);

  return (
    <iframe
      srcDoc={srcDoc}
      className="h-full min-h-[620px] w-full rounded-lg border border-border bg-card"
      title="HTML Preview"
      sandbox="allow-scripts allow-forms allow-modals"
    />
  );
}

function sanitizeSvg(raw: string): string {
  // No DOM (SSR/tests): refuse to render. Safer than returning the raw SVG.
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return "";
  }

  // DOMPurify with the SVG profile is a battle-tested, OWASP-recommended
  // sanitizer that handles every bypass a hand-rolled regex misses:
  //   - <script>, <foreignObject>, <use xlink:href="external">
  //   - on* event handlers (incl. <animate attributeName="onbegin">)
  //   - javascript:, data:text/html, entity-encoded & whitespace-padded
  //     payloads (j&#x09;avascript:, j\tavascript:)
  //   - CSS-based exfiltration (<style> + background:url())
  //   - SVG filter primitives used as XSS vectors
  //
  // The default DOMPurify config also strips dangerous URL schemes, so we
  // don't need to enumerate them ourselves. Tests live next to this file.
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}

function SvgViewer({ content }: { content: string }) {
  const sanitized = useMemo(() => sanitizeSvg(content), [content]);
  return (
    <div
      className="flex min-h-[420px] w-full items-center justify-center rounded-lg border border-border bg-card p-4 [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

function MarkdownViewer({ content }: { content: string }) {
  return (
    <div className="w-full rounded-lg border border-border bg-card p-6 text-base leading-8 whitespace-pre-wrap">
      {content}
    </div>
  );
}

function CodeViewer({ content, language }: { content: string; language?: string }) {
  return (
    <div className="h-full min-h-[620px] w-full overflow-hidden rounded-lg border border-border bg-card">
      {language && (
        <div className="border-b border-border bg-muted/30 px-4 py-2 font-mono text-xs text-muted-foreground">
          {language}
        </div>
      )}
      <pre className="h-full overflow-auto p-4 text-sm leading-relaxed"><code>{content}</code></pre>
    </div>
  );
}

function ChartViewer({ content }: { content: string }) {
  let data: any[];
  try { data = JSON.parse(content); } catch { data = []; }

  if (!Array.isArray(data) || data.length === 0) {
    return <div className="p-4 text-muted-foreground">Invalid chart data</div>;
  }

  const keys = Object.keys(data[0]);
  const xKey = keys[0];
  const yKeys = keys.slice(1);
  const maxVal = Math.max(...data.map((d: any) => Math.max(...yKeys.map((k) => Number(d[k]) || 0))));

  return (
    <div className="w-full rounded-lg border border-border bg-card p-6">
      <div className="flex items-end gap-1" style={{ height: 240 }}>
        {data.map((d: any, i: number) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            {yKeys.map((k) => {
              const h = maxVal > 0 ? ((Number(d[k]) || 0) / maxVal) * 210 : 4;
              return (
                <div
                  key={k}
                  className="w-full rounded-t-sm transition-all"
                  style={{
                    height: Math.max(h, 4),
                    background: `hsl(${(i * 40 + 200) % 360}, 60%, 55%)`,
                    minWidth: 20,
                  }}
                  title={`${k}: ${d[k]}`}
                />
              );
            })}
            <span className="mt-1 origin-left rotate-45 whitespace-nowrap text-[10px] text-muted-foreground">
              {d[xKey]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuizViewer({ content }: { content: string }) {
  let quiz: any;
  try { quiz = JSON.parse(content); } catch { quiz = null; }

  if (!quiz || !quiz.questions) {
    return <div className="p-4 text-muted-foreground">Invalid quiz data</div>;
  }

  return (
    <div className="w-full space-y-6 rounded-lg border border-border bg-card p-6">
      {quiz.title && <h3 className="text-lg font-bold">{quiz.title}</h3>}
      {quiz.questions.map((q: any, i: number) => (
        <div key={i} className="space-y-2 rounded-lg bg-muted/20 p-4">
          <p className="font-medium text-sm">{i + 1}. {q.question}</p>
          <div className="space-y-1.5">
            {(q.options || []).map((opt: string, j: number) => (
              <label
                key={j}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm transition-colors ${
                  q.answer === opt
                    ? "border-green-500/30 bg-green-500/10 text-green-400"
                    : "border-transparent bg-muted/10 hover:bg-muted/20"
                }`}
              >
                <input
                  type={q.multiple ? "checkbox" : "radio"}
                  name={`q-${i}`}
                  value={opt}
                  className="accent-primary"
                  disabled
                />
                {opt}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function IDEViewer({ content }: { content: string }) {
  let project: any;
  try { 
    project = JSON.parse(content); 
  } catch { 
    project = null; 
  }

  if (!project || !project.files) {
    return <div className="p-4 text-muted-foreground">Invalid IDE project data</div>;
  }

  // Handle code execution
  const handleExecute = async (code: string, language: string) => {
    try {
      // Call the backend API to execute code
      const response = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'ide_execute_code',
          args: { code, language }
        }),
      });
      
      const result = await response.json();
      return {
        success: result.status === 'success',
        output: result.output,
        error: result.error,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'فشل في تنفيذ الكود',
      };
    }
  };

  return (
    <CodeIDEArtifact
      initialProject={{
        name: project.projectName || "My Project",
        files: project.files,
      }}
      onExecute={handleExecute}
    />
  );
}

const VIEWER_MAP: Record<string, React.FC<{ content: string; language?: string }>> = {
  html: HtmlViewer,
  react: HtmlViewer,
  svg: SvgViewer,
  mermaid: MermaidViewer,
  markdown: MarkdownViewer,
  code: CodeViewer,
  chart: ChartViewer,
  quiz: QuizViewer,
  ide: IDEViewer,
};

export function ArtifactViewer({ artifact }: { artifact: Artifact }) {
  const Viewer = VIEWER_MAP[artifact.type] || CodeViewer;
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
  const canPreview = artifact.type !== "code";
  const showPreview = canPreview && viewMode === "preview";
  const fullPageUrl = `${window.location.origin}/artifacts/${artifact.id}`;
  const ext = getArtifactExtension(artifact.type, artifact.language);
  const googleFonts = useMemo(() => detectGoogleFonts(artifact.content), [artifact.content]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase text-primary">
            {artifact.type}
          </span>
          <h3 className="truncate font-semibold text-sm">{artifact.title}</h3>
          {googleFonts.length > 0 && (
            <span
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300"
              title={`Google Fonts: ${googleFonts.join(", ")}`}
            >
              <TypeIcon className="size-2.5" />
              <span className="truncate">
                {googleFonts.length <= 2
                  ? googleFonts.join(", ")
                  : `${googleFonts[0]} +${googleFonts.length - 1}`}
              </span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-muted/20 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              disabled={!canPreview}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                showPreview ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <EyeIcon className="size-3.5" />
              Preview
            </button>
            <button
              type="button"
              onClick={() => setViewMode("code")}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs transition-colors ${
                !showPreview ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Code2Icon className="size-3.5" />
              Code
            </button>
          </div>
          <a
            href={fullPageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted/30 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <ExternalLinkIcon className="size-3.5" />
            Full page
          </a>
          <button
            onClick={() => navigator.clipboard.writeText(fullPageUrl)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted/30 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <CopyIcon className="size-3.5" />
            Link
          </button>
          <button
            onClick={() => {
              const filename = `${toSafeFileName(artifact.title)}.${ext}`;
              const blob = new Blob([artifact.content], { type: getArtifactMime(artifact.type) });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = filename;
              document.body.appendChild(link);
              link.click();
              link.remove();
              URL.revokeObjectURL(url);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted/30 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <DownloadIcon className="size-3.5" />
            Download
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(artifact.content)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted/30 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <CopyIcon className="size-3.5" />
            Copy
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {showPreview ? (
          <Viewer content={artifact.content} language={artifact.language} />
        ) : (
          <CodeViewer content={artifact.content} language={artifact.language || ext} />
        )}
      </div>
    </div>
  );
}
