/**
 * Pure artifact helpers — chart data normalization, quiz grading, and the
 * sandboxed-HTML preview builder. Kept free of React/DOM so they are trivially
 * unit-testable.
 */

// ---------------------------------------------------------------------------
// Type metadata
// ---------------------------------------------------------------------------

export const ARTIFACT_TYPE_META: Record<
  string,
  { icon: string; tint: string; labelKey: string; ext: string; mime: string }
> = {
  html: { icon: "🌐", tint: "text-orange-400", labelKey: "artifacts:type.html", ext: "html", mime: "text/html" },
  react: { icon: "⚛️", tint: "text-cyan-400", labelKey: "artifacts:type.react", ext: "html", mime: "text/html" },
  svg: { icon: "✒️", tint: "text-pink-400", labelKey: "artifacts:type.svg", ext: "svg", mime: "image/svg+xml" },
  mermaid: { icon: "🧩", tint: "text-violet-400", labelKey: "artifacts:type.mermaid", ext: "mmd", mime: "text/plain" },
  markdown: { icon: "📝", tint: "text-blue-400", labelKey: "artifacts:type.markdown", ext: "md", mime: "text/markdown" },
  code: { icon: "💻", tint: "text-emerald-400", labelKey: "artifacts:type.code", ext: "txt", mime: "text/plain" },
  chart: { icon: "📊", tint: "text-amber-400", labelKey: "artifacts:type.chart", ext: "json", mime: "application/json" },
  quiz: { icon: "🎯", tint: "text-rose-400", labelKey: "artifacts:type.quiz", ext: "json", mime: "application/json" },
  ide: { icon: "🗂️", tint: "text-sky-400", labelKey: "artifacts:type.ide", ext: "json", mime: "application/json" },
};

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  java: "java",
  cpp: "cpp",
  c: "c",
  rust: "rs",
  go: "go",
  ruby: "rb",
  php: "php",
  bash: "sh",
  sql: "sql",
  json: "json",
  html: "html",
  css: "css",
};

export function getArtifactExtension(type: string, language?: string | null): string {
  const meta = ARTIFACT_TYPE_META[type];
  if (type === "code" && language) return LANGUAGE_EXTENSIONS[language.toLowerCase()] ?? "txt";
  return meta?.ext ?? "txt";
}

export function toSafeFileName(title: string): string {
  const base = title.trim().replace(/[^a-zA-Z0-9-_\u0600-\u06FF\s]/g, "").replace(/\s+/g, "-");
  return base.length > 0 ? base : "artifact";
}

/** Download any artifact content as a file (browser-only). */
export function downloadArtifactFile(title: string, type: string, content: string, language?: string | null): void {
  if (typeof document === "undefined") return;
  const filename = `${toSafeFileName(title)}.${getArtifactExtension(type, language)}`;
  const blob = new Blob([content], { type: ARTIFACT_TYPE_META[type]?.mime ?? "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// HTML preview builder
// ---------------------------------------------------------------------------

/**
 * Script injected into every HTML/React preview iframe. It:
 *   - forwards console.* calls and uncaught errors to the parent via postMessage
 *     so the viewer can show a Claude-style console drawer,
 *   - stubs localStorage/sessionStorage (the sandboxed iframe has an opaque
 *     origin, where real storage access throws SecurityError).
 * Serialized as JSON so it survives embedding inside srcDoc.
 */
export const PREVIEW_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var storageStub = function () {
      var store = {};
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem: function (k, v) { store[k] = String(v); },
        removeItem: function (k) { delete store[k]; },
        clear: function () { store = {}; },
        key: function (i) { return Object.keys(store)[i] ?? null; },
        get length() { return Object.keys(store).length; }
      };
    };
    try { window.localStorage.getItem('x'); } catch (e) {
      Object.defineProperty(window, 'localStorage', { value: storageStub(), configurable: true });
      Object.defineProperty(window, 'sessionStorage', { value: storageStub(), configurable: true });
    }
  } catch (e) {}

  var MAX_LOGS = 200;
  var send = function (level, args) {
    try {
      if (window.__artifactLogCount === undefined) window.__artifactLogCount = 0;
      if (window.__artifactLogCount >= MAX_LOGS) return;
      window.__artifactLogCount++;
      parent.postMessage({
        source: 'artifact-preview',
        level: level,
        args: Array.prototype.map.call(args, serializeArg)
      }, '*');
    } catch (e) {}
  };
  function serializeArg(value) {
    if (value instanceof Error) return value.stack || String(value);
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, function (_k, v) { return typeof v === 'function' ? '[Function]' : v; }, 2); }
    catch (e) { return String(value); }
  }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level] ? console[level].bind(console) : function () {};
    console[level] = function () { send(level === 'debug' ? 'log' : level, arguments); original.apply(null, arguments); };
  });
  window.addEventListener('error', function (event) {
    send('error', [event.message + (event.filename ? ' (' + event.filename + ':' + event.lineno + ')' : '')]);
  });
  window.addEventListener('unhandledrejection', function (event) {
    send('error', ['Unhandled promise rejection: ' + serializeArg(event.reason)]);
  });
})();
`;

/**
 * Build the full srcDoc for a preview. Wraps fragments in a minimal document
 * and injects the bootstrap script as the FIRST thing in <head> so console
 * capture is active before user code runs.
 */
export function buildPreviewSrcDoc(content: string): string {
  const bootstrapTag = `<script>${PREVIEW_BOOTSTRAP_SCRIPT}</script>`;
  const isFullDocument = /<!doctype html|<html[\s>]/i.test(content);
  if (isFullDocument) {
    // Inject after <head> when present; otherwise prepend.
    if (/<head[^>]*>/i.test(content)) {
      return content.replace(/<head([^>]*)>/i, `<head$1>${bootstrapTag}`);
    }
    return `${bootstrapTag}${content}`;
  }
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${bootstrapTag}
<style>
  body { margin: 0; padding: 16px; background: transparent; color: inherit; font-family: system-ui, sans-serif; }
</style>
</head>
<body>${content}</body>
</html>`;
}

/** Sandbox flags for the preview iframe. Scripts run in an opaque origin —
 * no same-origin access, so the host app's cookies/storage stay isolated. */
export const PREVIEW_SANDBOX = "allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock";

export interface PreviewConsoleEntry {
  level: string;
  args: string[];
  at: number;
}

/** Parse a message event from the preview iframe; null for unrelated messages. */
export function parsePreviewConsoleEvent(data: unknown): Pick<PreviewConsoleEntry, "level" | "args"> | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.source !== "artifact-preview") return null;
  const level = typeof record.level === "string" ? record.level : "log";
  const args = Array.isArray(record.args) ? record.args.map(String) : [];
  return { level, args };
}

// ---------------------------------------------------------------------------
// Chart data normalization
// ---------------------------------------------------------------------------

export type ChartKind = "bar" | "line" | "area" | "pie" | "donut";

export interface NormalizedChart {
  kind: ChartKind;
  title?: string;
  xKey: string;
  yKeys: string[];
  rows: Array<Record<string, number | string>>;
  error?: string;
}

function isRecordArray(value: unknown): value is Array<Record<string, unknown>> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => item && typeof item === "object" && !Array.isArray(item))
  );
}

/**
 * Accepts both the rich shape ({type,title,data,xKey,yKeys}) and the legacy
 * plain array of row objects produced by earlier prompts. Numeric cells are
 * coerced so models passing strings ("42") still render.
 */
export function normalizeChartSpec(raw: string): NormalizedChart {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "bar", xKey: "", yKeys: [], rows: [], error: "invalid-json" };
  }

  let kind: ChartKind = "bar";
  let title: string | undefined;
  let declaredX: string | undefined;
  let declaredY: string[] | string | undefined;
  let data: unknown;

  if (isRecordArray(parsed)) {
    data = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (["bar", "line", "area", "pie", "donut"].includes(String(obj.type))) {
      kind = obj.type as ChartKind;
    } else if (typeof obj.type === "string" && obj.type === "horizontal-bar") {
      kind = "bar";
    }
    if (typeof obj.title === "string") title = obj.title;
    if (typeof obj.xKey === "string") declaredX = obj.xKey;
    if (typeof obj.yKey === "string") declaredY = obj.yKey;
    else if (Array.isArray(obj.yKeys)) declaredY = obj.yKeys.filter((k): k is string => typeof k === "string");
    data = obj.data;
  }

  if (!isRecordArray(data)) {
    return { kind, xKey: "", yKeys: [], rows: [], error: "no-data" };
  }

  const keys = new Set<string>();
  for (const row of data) {
    for (const key of Object.keys(row)) keys.add(key);
  }
  const allKeys = Array.from(keys);

  const numericKey = (key: string) =>
    data.some((row) => {
      const value = row[key];
      return typeof value === "number" || (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)));
    });

  const xKey =
    (declaredX && allKeys.includes(declaredX) ? declaredX : undefined) ??
    allKeys.find((key) => !numericKey(key)) ??
    allKeys[0];

  const wantedSeries = declaredY
    ? (Array.isArray(declaredY) ? declaredY : [declaredY]).filter((key) => key !== xKey && allKeys.includes(key))
    : [];
  let yKeys: string[];
  if (wantedSeries.length > 0) {
    yKeys = wantedSeries;
  } else {
    const numericSeries = allKeys.filter((key) => key !== xKey && numericKey(key));
    yKeys = numericSeries.length > 0 ? numericSeries : allKeys.filter((key) => key !== xKey);
  }
  if (yKeys.length === 0) {
    return { kind, xKey, yKeys: [], rows: [], error: "no-series" };
  }

  const rows = data.map((row) => {
    const normalized: Record<string, number | string> = {};
    normalized[xKey] = coerceCell(row[xKey]);
    for (const key of yKeys) normalized[key] = coerceCell(row[key]);
    return normalized;
  });

  // Pie/donut charts render one series only.
  if ((kind === "pie" || kind === "donut") && yKeys.length > 1) {
    yKeys = yKeys.slice(0, 1);
  }

  return { kind, title, xKey, yKeys, rows };
}

function coerceCell(value: unknown): number | string {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
    return value;
  }
  return value == null ? "" : String(value);
}

// ---------------------------------------------------------------------------
// Quiz grading
// ---------------------------------------------------------------------------

export interface QuizQuestion {
  question: string;
  options: string[];
  answer: number | string | Array<number | string>;
  explanation?: string;
  multiple?: boolean;
}

export interface QuizSpec {
  title?: string;
  questions: QuizQuestion[];
}

export function parseQuiz(raw: string): QuizSpec | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "invalid-json" };
  }
  const obj = parsed as Record<string, unknown>;
  if (!obj || !Array.isArray(obj.questions) || obj.questions.length === 0) {
    return { error: "no-questions" };
  }
  const questions: QuizQuestion[] = obj.questions.map((q) => {
    const record = (q ?? {}) as Record<string, unknown>;
    return {
      question: String(record.question ?? ""),
      options: Array.isArray(record.options) ? record.options.map(String) : [],
      answer: (record.answer ?? 0) as QuizQuestion["answer"],
      explanation: typeof record.explanation === "string" ? record.explanation : undefined,
      multiple: Boolean(record.multiple),
    };
  });
  return { title: typeof obj.title === "string" ? obj.title : undefined, questions };
}

/**
 * Grade one question. Answers may be option indices or literal option text —
 * models emit both shapes, so accept either.
 */
export function gradeQuestion(question: QuizQuestion, selected: number[]): boolean {
  const expected = normalizeAnswerIndices(question);
  const picked = [...selected].sort().join(",");
  const correct = [...expected].sort().join(",");
  return picked === correct && expected.length > 0;
}

export function normalizeAnswerIndices(question: QuizQuestion): number[] {
  const asIndex = (value: number | string): number | null => {
    if (typeof value === "number") return value >= 0 && value < question.options.length ? value : null;
    const byText = question.options.findIndex((option) => option === value);
    if (byText !== -1) return byText;
    const byNumber = Number(value);
    return !Number.isNaN(byNumber) && byNumber >= 0 && byNumber < question.options.length ? byNumber : null;
  };
  if (Array.isArray(question.answer)) {
    return question.answer.map(asIndex).filter((v): v is number => v !== null);
  }
  const single = asIndex(question.answer);
  return single === null ? [] : [single];
}
