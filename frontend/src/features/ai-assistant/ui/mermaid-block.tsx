/**
 * Mermaid diagram block — renders fenced ```mermaid code blocks as diagrams
 * (Claude-style). Mermaid is loaded lazily via dynamic import so it never
 * touches the main bundle; failures fall back to the raw code view.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2Icon, CodeIcon, GitGraphIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

let mermaidModulePromise: Promise<typeof import("mermaid").default> | null = null;
let mermaidInitialized = false;

function loadMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      if (!mermaidInitialized) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            // Match the app's neutral surfaces; text stays readable in
            // both light and dark modes.
            background: "transparent",
            primaryColor: "#e8eefc",
            primaryTextColor: "#1a202c",
            primaryBorderColor: "#94a3b8",
            lineColor: "#64748b",
            fontFamily: "inherit",
          },
        });
        mermaidInitialized = true;
      }
      return mermaid;
    });
  }
  return mermaidModulePromise;
}

let renderSeq = 0;

export function MermaidDiagram({ code, className }: { code: string; className?: string }) {
  const { t } = useTranslation("chat");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const renderIdRef = useRef(`sigma-mermaid-${++renderSeq}`);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    loadMermaid()
      .then((mermaid) => mermaid.render(renderIdRef.current, code))
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(rendered);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setShowSource(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <figure
      className="aui-mermaid my-4 overflow-hidden rounded-xl border border-border/50 bg-muted/30 shadow-sm"
      data-testid="mermaid-block"
    >
      <figcaption
        className="flex items-center gap-2 border-b border-border/40 bg-muted/50 px-3 py-1.5 text-xs font-semibold text-muted-foreground"
        dir="ltr"
      >
        <GitGraphIcon className="size-3.5" />
        {t("mermaid.label")}
        {!failed && (
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            className="state-layer ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium hover:text-foreground"
          >
            {showSource ? (
              <>
                <GitGraphIcon className="size-3" />
                {t("mermaid.showDiagram")}
              </>
            ) : (
              <>
                <CodeIcon className="size-3" />
                {t("mermaid.showSource")}
              </>
            )}
          </button>
        )}
      </figcaption>

      <div className="p-4" dir="ltr">
        {showSource ? (
          <pre className="overflow-x-auto text-[13px] leading-relaxed text-foreground/90">
            <code>{code}</code>
          </pre>
        ) : svg ? (
          <div
            className={cn("aui-mermaid-svg flex justify-center overflow-x-auto", className)}
            // Mermaid output with securityLevel:"strict" is sanitized.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : failed ? (
          <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
            <CodeIcon className="size-6" />
            <span className="text-xs">{t("mermaid.renderFailed")}</span>
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2Icon className="size-5 animate-spin" />
          </div>
        )}
      </div>
    </figure>
  );
}
