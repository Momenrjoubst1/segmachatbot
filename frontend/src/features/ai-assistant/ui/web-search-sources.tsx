/**
 * Web-search source cards — renders results returned by the `web_search`
 * tool as a compact, collapsible "Sources" section under the assistant
 * answer (Perplexity/Claude style). Data is read straight from the message's
 * tool parts, so it needs no extra transport.
 */

import { useMemo } from "react";
import { ChevronDownIcon, GlobeIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

export interface WebSourceItem {
  title: string;
  url: string;
  snippet?: string;
}

/**
 * Extract web-search results from raw tool part output. Tolerates the
 * several shapes the tool result can take after runtime conversion
 * ({output | result}, array or {results: []}).
 */
export function extractWebSources(rawOutput: unknown, max = 8): WebSourceItem[] {
  const list = Array.isArray(rawOutput)
    ? rawOutput
    : rawOutput && typeof rawOutput === "object" && Array.isArray((rawOutput as { results?: unknown[] }).results)
      ? (rawOutput as { results: unknown[] }).results
      : [];

  const out: WebSourceItem[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { title, url, snippet, link } = item as Record<string, unknown>;
    const href = typeof url === "string" ? url : typeof link === "string" ? link : undefined;
    if (!href) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({
      title: typeof title === "string" && title.trim() ? title.trim() : href,
      url: href,
      ...(typeof snippet === "string" ? { snippet: snippet.slice(0, 200) } : {}),
    });
    if (out.length >= max) break;
  }
  return out;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function WebSearchSources({ sources }: { sources: WebSourceItem[] }) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);

  const visible = useMemo(() => (open ? sources : sources.slice(0, 3)), [open, sources]);

  if (sources.length === 0) return null;

  return (
    <section
      className="aui-web-sources mt-4 rounded-xl border border-border/40 bg-muted/30"
      data-testid="web-search-sources"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
      >
        <span className="flex items-center gap-2">
          <GlobeIcon className="size-4 text-muted-foreground" />
          {t("sources.webTitle", { count: sources.length })}
        </span>
        <ChevronDownIcon
          className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      <div className="space-y-2 border-t border-border/30 p-3">
        {visible.map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            dir="auto"
            className="block rounded-lg border border-transparent bg-background px-3 py-2 transition-colors hover:border-border/60 hover:bg-accent/40"
          >
            <span className="flex items-baseline gap-2">
              <span className="truncate text-sm font-medium text-foreground">{s.title}</span>
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground" dir="ltr">
                {domainOf(s.url)}
              </span>
            </span>
            {s.snippet && (
              <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                {s.snippet}
              </span>
            )}
          </a>
        ))}
        {!open && sources.length > visible.length && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs font-medium text-primary hover:underline"
          >
            {t("sources.showMore", { count: sources.length - visible.length })}
          </button>
        )}
      </div>
    </section>
  );
}
