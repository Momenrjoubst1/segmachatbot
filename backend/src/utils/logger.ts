/**
 * Structured Application Logger
 * مسجل منظم للتطبيق
 *
 * Features:
 *  - Structured metadata (objects, not just strings)
 *  - Per-module child loggers via `createLogger(module)`
 *  - Log levels with environment-controlled threshold
 *  - Pretty output in development, JSON in production
 *  - ISO timestamps + trace correlation (requestId/threadId)
 *  - Backward compatible API: `logger.info(msg, meta)`
 *
 * Usage:
 *   const log = createLogger('chat-pipeline');
 *   log.info('Step complete', { step: 3, durationMs: 12 });
 *
 * Replace any error sink in your catch blocks with `log.error()` — it
 * serialises Error objects (message + stack) automatically.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import * as Sentry from '@sentry/node';
import { getModuleLogLevel } from './log-config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

/** Force JSON output regardless of NODE_ENV (set to '1' to enable). */
const FORCE_JSON = process.env.LOG_JSON === '1';

/** Allow attaching per-request trace IDs that propagate through the call chain. */
type TraceContext = { requestId?: string; threadId?: string; userId?: string };

const traceStorage = new AsyncLocalStorage<TraceContext>();

export function setTraceContext(ctx: TraceContext): void {
  const store = traceStorage.getStore();
  if (store) {
    Object.assign(store, ctx);
  } else {
    traceStorage.enterWith({ ...ctx });
  }
}

/**
 * Run `fn` inside a dedicated trace-context scope. Preferred over
 * `enterWith` for request middleware: each request gets its own store and
 * the context dies naturally when the scope ends.
 */
export function runWithTraceContext<T>(ctx: TraceContext, fn: () => T): T {
  return traceStorage.run({ ...ctx }, fn);
}

export function clearTraceContext(): void {
  // Intentional no-op. The old implementation called `traceStorage.disable()`,
  // which switched the AsyncLocalStorage instance off PROCESS-WIDE — one
  // finishing request dropped requestId correlation for every other
  // in-flight request. Contexts are now scoped via runWithTraceContext.
}

function getTraceContext(): TraceContext {
  return traceStorage.getStore() ?? {};
}

/** Plain serialisable value — never `any`. */
export type LogMeta =
  | string
  | number
  | boolean
  | null
  | undefined
  | LogMeta[]
  | { [key: string]: LogMeta }
  | Error
  | Date
  | unknown; // Allow objects with arbitrary shape (e.g. ZodIssue[]) — they'll be normalise()'d at runtime

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  meta?: Record<string, LogMeta>;
  trace?: TraceContext;
  pid: number;
}

export interface Logger {
  debug(message: string, meta?: LogContext): void;
  info(message: string, meta?: LogContext): void;
  warn(message: string, meta?: LogContext): void;
  error(message: string, meta?: LogContext): void;
  fatal(message: string, meta?: LogContext): void;
  child(subModule: string): Logger;
  setLevel(level: LogLevel): void;
}

/**
 * Anything that can be attached to a log entry.
 *  - a structured key/value object (preferred for new code)
 *  - an `Error` instance
 *  - any primitive / serialisable value (legacy `log.error(msg, value)`)
 */
export type LogContext =
  | Record<string, LogMeta>
  | Error
  | string
  | number
  | boolean
  | null
  | undefined;

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/** Normalises a meta value into a plain LogMeta (handles Error, Date, etc.). */
function normalise(value: LogMeta): LogMeta {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(normalise);
  }
  if (typeof value === 'object') {
    const out: { [key: string]: LogMeta } = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalise(v as LogMeta);
    }
    return out;
  }
  return value;
}

/** Formats a log entry for human-readable output. */
function formatPretty(entry: LogEntry): string {
  const metaStr = entry.meta && Object.keys(entry.meta).length > 0
    ? ' ' + JSON.stringify(entry.meta)
    : '';
  return `[${entry.timestamp}] ${entry.level.toUpperCase().padEnd(5)} [${entry.module}] ${entry.message}${metaStr}`;
}

// ---------------------------------------------------------------------------
// Sink
// ---------------------------------------------------------------------------

/**
 * Streams a log entry to the appropriate console method.
 *
 * TODO: Integrate external logging sinks (Sentry, Datadog, etc.) here.
 * Example for Sentry:
 *   import * as Sentry from '@sentry/node';
 *   if (level === 'error' || level === 'fatal') {
 *     Sentry.captureException(entry.meta?.error ?? entry.message, { extra: entry });
 *   }
 * Example for Datadog:
 *   Forward `entry` to a Datadog Logs API endpoint or use their Node client.
 */
function emit(level: LogLevel, entry: LogEntry): void {
  const line = FORCE_JSON || process.env.NODE_ENV === 'production'
    ? JSON.stringify(entry)
    : formatPretty(entry);

  switch (level) {
    case 'debug':
      // Use process.stdout.write to avoid the "DEBUG:" prefix noise
      process.stdout.write(line + '\n');
      return;
    case 'info':
      process.stdout.write(line + '\n');
      return;
    case 'warn':
      process.stderr.write(line + '\n');
      return;
    case 'error':
    case 'fatal':
      process.stderr.write(line + '\n');
      if (Sentry.isInitialized()) {
        const errorFromMeta = entry.meta?.error;
        const errorObj =
          errorFromMeta instanceof Error
            ? errorFromMeta
            : new Error(entry.message);
        Sentry.captureException(errorObj, {
          level: level === 'fatal' ? 'fatal' : 'error',
          extra: {
            module: entry.module,
            meta: entry.meta,
            trace: entry.trace,
          },
        });
      }
      return;
  }
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.2,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function buildLogger(module: string, levelRef: { current: LogLevel }): Logger {
  const log = (level: LogLevel, message: string, meta?: LogContext): void => {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[levelRef.current]) return;

    let normalisedMeta: Record<string, LogMeta> | undefined;
    if (meta !== undefined && meta !== null) {
      // Wrap non-object values under a `value` key so they round-trip through
      // JSON cleanly.  Errors and plain objects get inlined.
      if (meta instanceof Error) {
        normalisedMeta = normalise({ error: meta }) as Record<string, LogMeta>;
      } else if (typeof meta === 'object') {
        normalisedMeta = normalise(meta as LogMeta) as Record<string, LogMeta>;
      } else {
        normalisedMeta = { value: meta };
      }
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      meta: normalisedMeta,
      trace: { ...getTraceContext() },
      pid: process.pid,
    };
    emit(level, entry);
  };

  return {
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
    fatal: (msg, meta) => log('fatal', msg, meta),
    child: (subModule) => buildLogger(`${module}:${subModule}`, levelRef),
    setLevel: (level) => {
      levelRef.current = level;
    },
  };
}

export function createLogger(module: string): Logger {
  // Use module-specific log level from configuration
  const moduleLevel = getModuleLogLevel(module);
  const levelRef = { current: moduleLevel };
  return buildLogger(module, levelRef);
}

/** Backward-compatible singleton for legacy `logger.xxx(msg, meta)` calls. */
export const logger = createLogger('app');
export { logger as log };
