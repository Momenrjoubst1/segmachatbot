import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, FileTextIcon, BookOpenIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type RagSource } from "@/context/ragSourcesBridge";
import { BookPageViewer } from "./BookPageViewer";

interface SourcesPanelProps {
  messageContent: string;
  structuredSources?: RagSource[];
  className?: string;
}

/**
 * Renders sources/citations from an assistant message.
 * Prefers structured sources from X-RAG-Sources header when available.
 * Falls back to markdown parsing for legacy/historical messages.
 */
export function SourcesPanel({ messageContent, structuredSources, className }: SourcesPanelProps) {
  const { t } = useTranslation("chat");
  const [isOpen, setIsOpen] = useState(true);
  const [viewerState, setViewerState] = useState<{
    open: boolean;
    textbookId: string | undefined;
    page: number | undefined;
    sourceName: string;
  }>({ open: false, textbookId: undefined, page: undefined, sourceName: "" });

  const useStructured = structuredSources && structuredSources.length > 0;
  const fallbackData = useMemo(() => parseSources(messageContent), [messageContent]);

  const sourceCount = useStructured ? structuredSources.length : fallbackData.sources.length;
  const hasAny = useStructured || fallbackData.hasSources;

  if (!hasAny) return null;

  return (
    <>
      <div className={cn("mt-4 rounded-xl border border-border/40 bg-muted/30 overflow-hidden", className)}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "w-full flex items-center justify-between gap-3 p-3 text-left text-sm font-medium text-foreground hover:bg-muted/50 transition-colors",
            isOpen && "bg-muted/50"
          )}
          aria-expanded={isOpen}
        >
          <div className="flex items-center gap-2">
            <BookOpenIcon className="h-4 w-4 text-muted-foreground" />
            <span>{t("sources.title", { count: sourceCount })}</span>
          </div>
          <ChevronDownIcon className={cn("h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
        </button>

        {isOpen && (
          <div className="p-3 space-y-3 border-t border-border/30 animate-in slide-in-from-top-2 duration-150">
            {useStructured ? (
              <StructuredSourcesList
                sources={structuredSources}
                onOpenPage={(s) =>
                  setViewerState({
                    open: true,
                    textbookId: s.textbookId,
                    page: s.page,
                    sourceName: s.source,
                  })
                }
              />
            ) : (
              <FallbackSourcesList data={fallbackData} />
            )}
          </div>
        )}
      </div>

      <BookPageViewer
        open={viewerState.open}
        onOpenChange={(open) => setViewerState((prev) => ({ ...prev, open }))}
        textbookId={viewerState.textbookId}
        page={viewerState.page}
        sourceName={viewerState.sourceName}
      />
    </>
  );
}

function StructuredSourcesList({
  sources,
  onOpenPage,
}: {
  sources: RagSource[];
  onOpenPage: (s: RagSource) => void;
}) {
  const { t } = useTranslation("chat");

  // Hybrid retrieval scores (0.5*weighted + 0.5*RRF) top out around ~0.45,
  // so raw*100 reads as a misleadingly low "37%" for an excellent match.
  // Normalize RELATIVE to the best source in this answer: top = 100%, the
  // rest keep their proportional gap. Monotonic, comparable within a
  // message — which is exactly what a confidence chip should communicate.
  const bestScore = sources.reduce((m, s) => Math.max(m, s.similarity), 0);
  const toPct = (score: number): number | null => {
    if (!(bestScore > 0)) return null;
    return Math.max(1, Math.min(100, Math.round((score / bestScore) * 100)));
  };

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {t("sources.documents")}
      </h4>
      <div className="flex flex-wrap gap-2">
        {sources.map((s, i) => {
          const hasPage = typeof s.page === "number" && s.page > 0;
          const confidence = toPct(s.similarity);

          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => hasPage && onOpenPage(s)}
                  disabled={!hasPage}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors",
                    hasPage
                      ? "hover:bg-blue-50/50 hover:border-blue-300/40 cursor-pointer"
                      : "opacity-70 cursor-default"
                  )}
                >
                  <FileTextIcon className="h-3 w-3 text-muted-foreground" />
                  <span>{s.source}</span>
                  {hasPage && (
                    <span className="text-[10px] text-muted-foreground">
                      {t("sources.page")} {s.page}
                    </span>
                  )}
                  {confidence !== null && (
                    <span className="text-[10px] text-muted-foreground/70">
                      {t("sources.confidence", { pct: confidence })}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {hasPage
                  ? t("sources.openPage", { page: s.page, name: s.source })
                  : s.source}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function FallbackSourcesList({ data }: { data: ParsedSources }) {
  const { t } = useTranslation("study");

  return (
    <>
      {data.sources.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("sources.documents")}</h4>
          <div className="flex flex-wrap gap-2">
            {data.sources.map((src, i) => (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors">
                    <FileTextIcon className="h-3 w-3 text-muted-foreground" />
                    {src}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("sources.tooltipSource", { name: src })}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}

      {data.pageRefs.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/30">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("sources.pageReferences")}</h4>
          <div className="flex flex-wrap gap-2">
            {data.pageRefs.map((ref, i) => (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-background px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50/50 transition-colors">
                    <span className="text-[10px] font-bold">p.</span>
                    {ref}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("sources.tooltipPage", { num: ref })}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}

      {data.inlineCitations.length > 0 && data.sources.length === 0 && (
        <div className="text-xs text-muted-foreground/70 italic">
          {t("sources.noFormattedSources")}
        </div>
      )}
    </>
  );
}

interface ParsedSources {
  hasSources: boolean;
  sources: string[];
  pageRefs: string[];
  inlineCitations: string[];
}

function parseSources(content: string): ParsedSources {
  const sources: string[] = [];
  const pageRefs: string[] = [];
  const inlineCitations: string[] = [];

  const sourcesSectionMatch = content.match(/#{1,3}\s*📚\s*المصادر المعتمدة\s*\(Sources\):\s*\n([\s\S]*?)(?:\n#{1,3}|\n\*\*\*|\n---|$)/i);
  if (sourcesSectionMatch) {
    const section = sourcesSectionMatch[1];
    const sourceLines = section.match(/^[\s]*[-*]\s*(?:📄\s*)?(?:\*\*)?([^*\n]+?)(?:\*\*)?\s*$/gim);
    if (sourceLines) {
      for (const line of sourceLines) {
        const clean = line.replace(/^[\s]*[-*]\s*(?:📄\s*)?(?:\*\*)?/, "").replace(/(?:\*\*)?\s*$/, "").trim();
        if (clean && !sources.includes(clean)) sources.push(clean);
      }
    }
  }

  const citationRegex = /\[Source:\s*([^\]]+)\]/gi;
  let match;
  while ((match = citationRegex.exec(content)) !== null) {
    const cited = match[1].trim();
    if (cited && !inlineCitations.includes(cited)) inlineCitations.push(cited);
    if (!sources.includes(cited)) sources.push(cited);
  }

  const pageRegex = /(?:\(|\[)\s*(?:page|p\.?|ص)\s*(\d+)\s*(?:\)|\])/gi;
  while ((match = pageRegex.exec(content)) !== null) {
    const page = match[1];
    if (!pageRefs.includes(page)) pageRefs.push(page);
  }

  pageRefs.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const uniqueSources = [...new Set(sources)];

  return {
    hasSources: uniqueSources.length > 0 || pageRefs.length > 0 || inlineCitations.length > 0,
    sources: uniqueSources,
    pageRefs,
    inlineCitations,
  };
}
