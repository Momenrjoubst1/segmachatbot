/**
 * Textbook pipeline error classification + user-safe message sanitizing.
 *
 * - PermanentJobError: retrying can never help (corrupt PDF, page limit,
 *   missing source). The worker marks the textbook failed immediately.
 * - TransientJobError: network blips, timeouts, 5xx — retried up to
 *   MAX_RETRIES by the worker.
 *
 * `sanitizeErrorMessage` strips server paths/internal details before an
 * error is persisted to the DB, because `/status` returns `textbooks.error`
 * verbatim to the client.
 */

export class PermanentJobError extends Error {
  constructor(
    message: string,
    public readonly userMessage?: string
  ) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export class TransientJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientJobError";
  }
}

export function sanitizeErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/[A-Za-z]:\\[^\s:]+/g, "[path]") // Windows paths
    .replace(/\/[^\s:]+/g, "[path]") // POSIX paths
    .replace(/Error:\s*/i, "")
    .substring(0, 200);
}

/** Map an error to a user-facing message, preferring explicit userMessage. */
export function userFacingError(err: unknown): string {
  if (err instanceof PermanentJobError && err.userMessage) {
    return err.userMessage;
  }
  return sanitizeErrorMessage(err);
}
