import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
// Transitive deps hoisted to node_modules root; resolved by Vite.
// eslint-disable-next-line import/no-extraneous-dependencies
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
// @ts-expect-error - react-syntax-highlighter module interop
import { Prism } from "react-syntax-highlighter";
// @ts-expect-error - react-syntax-highlighter CJS style interop
import { oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism";

import {
  PREVIEW_SANDBOX,
  buildPreviewSrcDoc,
  normalizeChartSpec,
  parseQuiz,
  gradeQuestion,
  normalizeAnswerIndices,
  parsePreviewConsoleEvent,
  type NormalizedChart,
  type PreviewConsoleEntry,
} from "./artifact-utils";

// ---------------------------------------------------------------------------
// HTML / React preview — sandboxed iframe with console + error capture
// ---------------------------------------------------------------------------

export function HtmlPreview({ content }: { content: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [logs, setLogs] = useState<PreviewConsoleEntry[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const srcDoc = useMemo(() => buildPreviewSrcDoc(content), [content]);

  // Reload clears captured logs so the drawer matches what is on screen.
  useEffect(() => {
    setLogs([]);
  }, [reloadKey]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const entry = parsePreviewConsoleEvent(event.data);
      if (!entry) return;
      setLogs((prev) => [...prev.slice(-199), { ...entry, at: Date.now() }]);
      if (entry.level === "error") setConsoleOpen(true);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const errorCount = logs.filter((log) => log.level === "error").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <iframe
        key={reloadKey}
        srcDoc={srcDoc}
        className="min-h-[420px] w-full flex-1 rounded-lg border border-border bg-white"
        title="Artifact preview"
        sandbox={PREVIEW_SANDBOX}
      />
      <div className="shrink-0 pt-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-muted/30 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            ↻ <span>Reload</span>
          </button>
          <button
            type="button"
            onClick={() => setConsoleOpen((open) => !open)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors ${
              errorCount > 0
                ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            ▤ Console{logs.length > 0 ? ` (${logs.length})` : ""}
          </button>
        </div>
        {consoleOpen && (
          <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-border bg-zinc-950 p-2 font-mono text-[11px] leading-relaxed" data-testid="artifact-console">
            {logs.length === 0 ? (
              <p className="text-zinc-500">No output</p>
            ) : (
              logs.map((log, index) => (
                <pre
                  key={`${log.at}-${index}`}
                  className={`whitespace-pre-wrap ${
                    log.level === "error" ? "text-red-400" : log.level === "warn" ? "text-amber-300" : "text-emerald-300"
                  }`}
                >
                  [{log.level}] {log.args.join(" ")}
                </pre>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG / Mermaid
// ---------------------------------------------------------------------------

/** DOMPurify (SVG profile) — blocks script/handler/URL-payload smuggling. */
export function sanitizeSvg(raw: string): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return "";
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}

export function SvgViewer({ content }: { content: string }) {
  const sanitized = useMemo(() => sanitizeSvg(content), [content]);
  return (
    <div
      dir="ltr"
      className="flex min-h-[420px] w-full items-center justify-center rounded-lg border border-border bg-card p-4 [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

export function MermaidViewer({ content }: { content: string }) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg("");

    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
          securityLevel: "strict",
        });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg: rendered } = await mermaid.render(id, content);
        if (!cancelled) setSvg(rendered);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Invalid Mermaid diagram");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [content]);

  const sanitized = useMemo(() => (svg ? sanitizeSvg(svg) : ""), [svg]);

  return (
    <div
      dir="ltr"
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

// ---------------------------------------------------------------------------
// Markdown — real rendering (GFM + math) with highlighted code fences
// ---------------------------------------------------------------------------

export function MarkdownViewer({ content }: { content: string }) {
  return (
    <div
      dir="auto"
      className="aui-md w-full rounded-lg border border-border bg-card p-6 text-base leading-8"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code ({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const codeText = String(children ?? "").replace(/\n$/, "");
            if (match || codeText.includes("\n")) {
              return (
                <Prism language={match?.[1] ?? "text"} style={oneDark} wrapLongLines={false}>
                  {codeText}
                </Prism>
              );
            }
            return (
              <code className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[0.85em]" {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Code — syntax-highlighted read view (editing lives in ArtifactViewer)
// ---------------------------------------------------------------------------

const PRISM_LANGUAGES = new Set([
  "javascript", "typescript", "jsx", "tsx", "python", "java", "c", "cpp", "csharp",
  "go", "rust", "ruby", "php", "bash", "sql", "json", "html", "css", "yaml", "markdown", "kotlin", "swift", "dart",
]);

export function CodeHighlight({ content, language }: { content: string; language?: string | null }) {
  const lang = language?.toLowerCase() ?? "text";
  const supported = PRISM_LANGUAGES.has(lang);
  return (
    <div dir="ltr" className="h-full min-h-0 w-full overflow-auto">
      <Prism
        language={supported ? lang : "text"}
        style={oneDark}
        showLineNumbers
        lineNumberStyle={{ color: "#6b7280", minWidth: "2.25rem", textAlign: "right", paddingRight: "1rem", userSelect: "none" }}
        customStyle={{ margin: 0, width: "100%", background: "transparent", padding: "1rem", fontSize: "0.85rem", lineHeight: 1.5 }}
      >
        {content}
      </Prism>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts — dependency-free SVG renderer for bar/line/area/pie/donut
// ---------------------------------------------------------------------------

const CHART_COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c", "#22d3ee", "#f87171"];

export function ChartViewer({ content }: { content: string }) {
  const spec = useMemo(() => normalizeChartSpec(content), [content]);
  if (spec.error) {
    return (
      <div className="w-full rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Invalid chart data ({spec.error})
      </div>
    );
  }
  return (
    <div className="w-full rounded-lg border border-border bg-card p-6" data-testid="chart-view">
      {spec.title && <h3 className="mb-4 text-center font-semibold">{spec.title}</h3>}
      {(spec.kind === "pie" || spec.kind === "donut") ? (
        <PieChart spec={spec} donut={spec.kind === "donut"} />
      ) : spec.kind === "bar" ? (
        <BarChart spec={spec} />
      ) : (
        <LineAreaChart spec={spec} area={spec.kind === "area"} />
      )}
    </div>
  );
}

function BarChart({ spec }: { spec: NormalizedChart }) {
  const maxVal = Math.max(
    ...spec.rows.flatMap((row) => spec.yKeys.map((k) => Number(row[k]) || 0)),
    1,
  );
  return (
    <div className="flex flex-col gap-4" dir="ltr">
      <Legend items={spec.yKeys} />
      <div className="flex items-end gap-3 overflow-x-auto pb-2" style={{ height: 260 }}>
        {spec.rows.map((row, i) => (
          <div key={i} className="flex h-full min-w-[48px] flex-1 flex-col items-center justify-end gap-1.5">
            <div className="flex h-full w-full items-end justify-center gap-1">
              {spec.yKeys.map((key, kIndex) => {
                const value = Number(row[key]) || 0;
                const height = Math.max((value / maxVal) * 210, value > 0 ? 4 : 0);
                return (
                  <div
                    key={key}
                    className="w-full max-w-[28px] rounded-t-sm transition-all"
                    style={{ height, background: CHART_COLORS[kIndex % CHART_COLORS.length] }}
                    title={`${row[spec.xKey]} · ${key}: ${value}`}
                  />
                );
              })}
            </div>
            <span className="max-w-full truncate text-[11px] text-muted-foreground">{String(row[spec.xKey])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineAreaChart({ spec, area }: { spec: NormalizedChart; area: boolean }) {
  const W = 640;
  const H = 260;
  const PAD_X = 36;
  const PAD_Y = 24;
  const values = spec.rows.flatMap((row) => spec.yKeys.map((k) => Number(row[k]) || 0));
  const maxVal = Math.max(...values, 1);
  const stepX = spec.rows.length > 1 ? (W - PAD_X * 2) / (spec.rows.length - 1) : 0;

  const pointFor = (rowIndex: number, value: number) => ({
    x: PAD_X + rowIndex * stepX,
    y: H - PAD_Y - (value / maxVal) * (H - PAD_Y * 2),
  });

  return (
    <div dir="ltr" className="overflow-x-auto">
      <Legend items={spec.yKeys} />
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full min-w-[480px]" role="img">
        {[0.25, 0.5, 0.75, 1].map((frac) => (
          <line
            key={frac}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={H - PAD_Y - frac * (H - PAD_Y * 2)}
            y2={H - PAD_Y - frac * (H - PAD_Y * 2)}
            stroke="currentColor"
            strokeOpacity={0.08}
          />
        ))}
        {spec.yKeys.map((key, kIndex) => {
          const points = spec.rows.map((row, rowIndex) =>
            pointFor(rowIndex, Number(row[key]) || 0),
          );
          const path = points
            .map((p, index) => `${index === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join(" ");
          const color = CHART_COLORS[kIndex % CHART_COLORS.length];
          return (
            <g key={key}>
              {area && (
                <path
                  d={`${path} L${points[points.length - 1]?.x.toFixed(1)},${H - PAD_Y} L${points[0]?.x.toFixed(1)},${H - PAD_Y} Z`}
                  fill={color}
                  fillOpacity={0.15}
                />
              )}
              <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              {points.map((p, index) => (
                <circle
                  key={index}
                  cx={p.x}
                  cy={p.y}
                  r={3.5}
                  fill={color}
                  className="[&_circle]:cursor-pointer"
                >
                  <title>{`${spec.rows[index][spec.xKey]} · ${key}: ${Number(spec.rows[index][key]) || 0}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {spec.rows.map((row, index) => (
          <text
            key={index}
            x={PAD_X + index * stepX}
            y={H - 6}
            textAnchor="middle"
            fontSize={11}
            fill="currentColor"
            opacity={0.55}
          >
            {String(row[spec.xKey]).slice(0, 10)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function PieChart({ spec, donut }: { spec: NormalizedChart; donut: boolean }) {
  const key = spec.yKeys[0];
  const total = spec.rows.reduce((sum, row) => sum + Math.max(Number(row[key]) || 0, 0), 0) || 1;

  let angle = -90;
  interface Slice {
    label: string;
    value: number;
    fraction: number;
    startAngle: number;
    endAngle: number;
    color: string;
    index: number;
    path: string;
  }
  const slices: Slice[] = spec.rows.map((row, index) => {
    const value = Math.max(Number(row[key]) || 0, 0);
    const fraction = value / total;
    const startAngle = angle;
    angle += fraction * 360;
    return {
      label: String(row[spec.xKey]),
      value,
      fraction,
      startAngle,
      endAngle: angle,
      color: CHART_COLORS[index % CHART_COLORS.length],
      index,
      path: "",
    };
  });

  const CX = 130;
  const CY = 130;
  const R = 100;

  return (
    <div dir="ltr" className="flex flex-wrap items-center justify-center gap-6">
      <svg viewBox="0 0 260 260" className="w-56 shrink-0" role="img">
        {slices.map((slice) => (
          <path
            key={slice.index}
            d={buildSlice(CX, CY, R, donut ? R * 0.58 : 0, slice.startAngle, slice.endAngle)}
            fill={slice.color}
            stroke="none"
          >
            <title>{`${slice.label}: ${slice.value} (${(slice.fraction * 100).toFixed(1)}%)`}</title>
          </path>
        ))}
        {donut && <circle cx={CX} cy={CY} r={R * 0.42} fill="transparent" />}
      </svg>
      <ul className="space-y-1.5 text-sm">
        {slices.map((slice) => (
          <li key={slice.index} className="flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ background: slice.color }} />
            <span className="max-w-[180px] truncate">{slice.label}</span>
            <span className="text-muted-foreground">
              {slice.value} · {(slice.fraction * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function buildSlice(cx: number, cy: number, r: number, innerR: number, startAngle: number, endAngle: number): string {
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const fullCircle = endAngle - startAngle >= 359.999;
  if (fullCircle) {
    return (
      `M${cx},${cy - r} A${r},${r} 0 1 1 ${cx - 0.01},${cy - r} ` +
      (innerR > 0 ? `M${cx},${cy - innerR} A${innerR},${innerR} 0 1 0 ${cx + 0.01},${cy - innerR} Z` : "Z")
    );
  }
  const x1 = cx + r * Math.cos(rad(startAngle));
  const y1 = cy + r * Math.sin(rad(startAngle));
  const x2 = cx + r * Math.cos(rad(endAngle));
  const y2 = cy + r * Math.sin(rad(endAngle));
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  if (innerR <= 0) {
    return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`;
  }
  const ix1 = cx + innerR * Math.cos(rad(endAngle));
  const iy1 = cy + innerR * Math.sin(rad(endAngle));
  const ix2 = cx + innerR * Math.cos(rad(startAngle));
  const iy2 = cy + innerR * Math.sin(rad(startAngle));
  return (
    `M${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} ` +
    `L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc} 0 ${ix2},${iy2} Z`
  );
}

function Legend({ items }: { items: string[] }) {
  if (items.length <= 1) return null;
  return (
    <div className="mb-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
      {items.map((item, index) => (
        <span key={item} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
          {item}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quiz — fully interactive with grading and explanations
// ---------------------------------------------------------------------------

export function QuizViewer({ content }: { content: string }) {
  const parsed = useMemo(() => parseQuiz(content), [content]);
  const [selections, setSelections] = useState<number[][]>(() =>
    "error" in parsed ? [] : parsed.questions.map(() => []),
  );
  const [submitted, setSubmitted] = useState(false);

  if ("error" in parsed) {
    return <div className="p-4 text-sm text-muted-foreground">Invalid quiz data ({parsed.error})</div>;
  }

  const questions = parsed.questions;
  const score = submitted
    ? questions.reduce((sum, question, index) => sum + (gradeQuestion(question, selections[index] ?? []) ? 1 : 0), 0)
    : 0;
  const percent = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;

  return (
    <div className="w-full space-y-5 rounded-lg border border-border bg-card p-6" data-testid="quiz-view">
      {parsed.title && <h3 className="text-lg font-bold">{parsed.title}</h3>}

      {questions.map((question, questionIndex) => {
        const selected = selections[questionIndex] ?? [];
        const correctIndices = normalizeAnswerIndices(question);
        return (
          <div key={questionIndex} className="space-y-2.5 rounded-lg bg-muted/20 p-4">
            <p className="text-sm font-medium" dir="auto">
              {questionIndex + 1}. {question.question}
            </p>
            <div className="space-y-1.5" dir="auto">
              {question.options.map((option, optionIndex) => {
                const isSelected = selected.includes(optionIndex);
                const isCorrect = correctIndices.includes(optionIndex);
                const stateClass = !submitted
                  ? isSelected
                    ? "border-primary/50 bg-primary/10"
                    : "border-transparent bg-muted/10 hover:bg-muted/20"
                  : isCorrect
                    ? "border-green-500/40 bg-green-500/10 text-green-500"
                    : isSelected
                      ? "border-red-500/40 bg-red-500/10 text-red-400"
                      : "border-transparent bg-muted/10 opacity-70";
                return (
                  <label
                    key={optionIndex}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm transition-colors ${stateClass}`}
                  >
                    <input
                      type={question.multiple ? "checkbox" : "radio"}
                      name={`quiz-${questionIndex}`}
                      checked={isSelected}
                      disabled={submitted}
                      onChange={() => {
                        setSelections((prev) => {
                          const next = prev.map((entry) => [...entry]);
                          const current = next[questionIndex];
                          if (question.multiple) {
                            next[questionIndex] = current.includes(optionIndex)
                              ? current.filter((v) => v !== optionIndex)
                              : [...current, optionIndex].sort();
                          } else {
                            next[questionIndex] = [optionIndex];
                          }
                          return next;
                        });
                      }}
                      className="accent-primary"
                    />
                    <span className="flex-1">{option}</span>
                    {submitted && isCorrect && <span aria-hidden>✓</span>}
                  </label>
                );
              })}
            </div>
            {submitted && question.explanation && (
              <p dir="auto" className="rounded-md border border-border bg-background/60 p-2.5 text-xs leading-6 text-muted-foreground">
                💡 {question.explanation}
              </p>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        {!submitted ? (
          <button
            type="button"
            onClick={() => setSubmitted(true)}
            disabled={selections.every((selection) => selection.length === 0)}
            className="inline-flex h-9 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            Submit answers
          </button>
        ) : (
          <>
            <div className="text-sm font-medium" data-testid="quiz-score">
              Score: {score}/{questions.length} · {percent}%
            </div>
            <button
              type="button"
              onClick={() => {
                setSelections(questions.map(() => []));
                setSubmitted(false);
              }}
              className="inline-flex h-9 items-center rounded-lg bg-muted/40 px-4 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
