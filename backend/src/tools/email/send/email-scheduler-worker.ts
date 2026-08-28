/**
 * Email Scheduler Worker
 * ----------------------
 * Polls `email_schedules` every minute and dispatches emails whose
 * `scheduled_at` time has arrived.  Also retries failed `email_jobs`
 * whose `next_retry_at` has passed.
 *
 * Designed to run as a long-lived background process alongside the
 * textbook worker.  It never throws — all errors are caught and logged.
 */

import { supabase } from "../../../config/supabase.config.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("email-scheduler-worker");

const POLL_INTERVAL_MS = 60_000;          // 1 minute
const MAX_BATCH = 20;                     // max schedules per tick
const MAX_RETRY_ATTEMPTS = 3;

let running = false;
let stopRequested = false;
let pollTimer: NodeJS.Timeout | null = null;

// ──────────────────────────────────────────────────────────────────────────────
// Dynamic import helpers (optional deps)
// ──────────────────────────────────────────────────────────────────────────────
async function sendViaProvider(
  to: string,
  subject: string,
  body: string,
  html: string | undefined,
  cc: string[],
  bcc: string[]
): Promise<{ provider: string; success: boolean; error?: string }> {
  // Lazy-import to avoid circular deps
  const { sendEmailViaProvider } = (await import("./sender.js")) as { sendEmailViaProvider?: (...args: unknown[]) => Promise<{ provider: string; success: boolean; error?: string }> };
  if (typeof sendEmailViaProvider !== "function") {
    return { provider: "none", success: false, error: "sendEmailViaProvider not exported" };
  }
  return sendEmailViaProvider(to, subject, body, html, cc, bcc);
}

// ──────────────────────────────────────────────────────────────────────────────
// Process one tick
// ──────────────────────────────────────────────────────────────────────────────
async function processTick(): Promise<void> {
  const now = new Date().toISOString();

  // 0. Reclaim rows stuck in "processing" (e.g. the process died between
  // locking and the terminal update) so they are retried instead of orphaned.
  const staleCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  for (const table of ["email_schedules", "email_jobs"] as const) {
    const { error: reclaimErr } = await supabase
      .from(table)
      .update({ status: "pending", updated_at: now })
      .eq("status", "processing")
      .lt("updated_at", staleCutoff);
    if (reclaimErr) {
      log.warn(`Could not reclaim stale processing rows in ${table}`, { error: reclaimErr.message });
    }
  }

  // 1. Pick up pending scheduled emails whose time has arrived
  const { data: schedules, error: fetchErr } = await supabase
    .from("email_schedules")
    .select("*")
    .lte("scheduled_at", now)
    .eq("status", "pending")
    .limit(MAX_BATCH);

  if (fetchErr) {
    log.error("Failed to fetch scheduled emails", { error: fetchErr.message });
  } else if (schedules?.length) {
    for (const schedule of schedules) {
      await processScheduledEmail(schedule);
    }
  }

  // 2. Retry failed email_jobs whose next_retry_at has passed
  const { data: retryJobs, error: retryErr } = await supabase
    .from("email_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("next_retry_at", now)
    .lt("attempts", MAX_RETRY_ATTEMPTS)
    .limit(MAX_BATCH);

  if (retryErr) {
    log.error("Failed to fetch retry jobs", { error: retryErr.message });
  } else if (retryJobs?.length) {
    for (const job of retryJobs) {
      await processRetryJob(job);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Send a scheduled email
// ──────────────────────────────────────────────────────────────────────────────
async function processScheduledEmail(schedule: { id: string; user_id: string; to_address: string; subject: string; body?: string; html?: string; cc_addresses?: string[]; bcc_addresses?: string[]; attempts?: number }): Promise<void> {
  const { id, user_id, to_address, subject, body, html, cc_addresses, bcc_addresses, attempts } = schedule;

  // Mark as processing (optimistic lock). Supabase reports NO error for an
  // update that matched zero rows, so the lock must be verified by the
  // returned row count — an unverified "lock" would allow a second worker
  // (or a racing tick) to send the same email twice.
  const { data: locked, error: lockErr } = await supabase
    .from("email_schedules")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")        // only if still pending (prevents double-send)
    .select("id");

  if (lockErr || !locked || locked.length === 0) {
    log.warn("Could not lock scheduled email (already processing?)", { id, error: lockErr?.message });
    return;
  }

  try {
    const result = await sendViaProvider(
      to_address,
      subject,
      body ?? "",
      html,
      cc_addresses ?? [],
      bcc_addresses ?? []
    );

    if (result.success) {
      await supabase
        .from("email_schedules")
        .update({ status: "completed", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id);
      log.info("Scheduled email sent", { id, provider: result.provider, to: to_address });
    } else {
      const nextAttempts = (attempts ?? 0) + 1;
      const newStatus = nextAttempts >= MAX_RETRY_ATTEMPTS ? "failed" : "pending";
      const retryDelay = [30_000, 300_000, 900_000][nextAttempts - 1] ?? 900_000;
      await supabase
        .from("email_schedules")
        .update({
          status: newStatus,
          attempts: nextAttempts,
          error: result.error?.substring(0, 500),
          ...(newStatus === "pending" ? { scheduled_at: new Date(Date.now() + retryDelay).toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      log.warn("Scheduled email send failed", { id, status: newStatus, error: result.error });
    }
  } catch (err: unknown) {
    log.error("Exception while sending scheduled email", { id, error: err instanceof Error ? err.message : String(err) });
    await supabase
      .from("email_schedules")
      .update({ status: "failed", error: "Internal error", updated_at: new Date().toISOString() })
      .eq("id", id);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Retry a failed email_job
// ──────────────────────────────────────────────────────────────────────────────
async function processRetryJob(job: { id: string; user_id: string; to_address: string; subject: string; body?: string; html?: string; cc_addresses?: string[]; bcc_addresses?: string[]; attempts?: number }): Promise<void> {
  const { id, user_id, to_address, subject, body, html, cc_addresses, bcc_addresses, attempts } = job;

  // Optimistic lock — verified via returned rows (see processScheduledEmail).
  const { data: locked, error: lockErr } = await supabase
    .from("email_jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");

  if (lockErr || !locked || locked.length === 0) {
    log.warn("Could not lock email job", { id, error: lockErr?.message });
    return;
  }

  try {
    const result = await sendViaProvider(
      to_address,
      subject,
      body ?? "",
      html,
      cc_addresses ?? [],
      bcc_addresses ?? []
    );

    const nextAttempts = (attempts ?? 0) + 1;

    if (result.success) {
      await supabase
        .from("email_jobs")
        .update({ status: "completed", attempts: nextAttempts, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id);
      log.info("Retry email job succeeded", { id, provider: result.provider });
    } else {
      const newStatus = nextAttempts >= MAX_RETRY_ATTEMPTS ? "failed" : "pending";
      const retryDelay = [30_000, 300_000, 900_000][nextAttempts - 1] ?? 900_000;
      await supabase
        .from("email_jobs")
        .update({
          status: newStatus,
          attempts: nextAttempts,
          error: result.error?.substring(0, 500),
          last_attempt_at: new Date().toISOString(),
          ...(newStatus === "pending" ? { next_retry_at: new Date(Date.now() + retryDelay).toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      log.warn("Retry email job failed", { id, status: newStatus });
    }
  } catch (err: unknown) {
    log.error("Exception while retrying email job", { id, error: err instanceof Error ? err.message : String(err) });
    await supabase
      .from("email_jobs")
      .update({ status: "failed", error: "Internal error", updated_at: new Date().toISOString() })
      .eq("id", id);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ──────────────────────────────────────────────────────────────────────────────
export function startEmailSchedulerWorker(): void {
  if (running) return;
  running = true;
  stopRequested = false;
  log.info("Email scheduler worker started (poll interval: 60s)");

  function scheduleTick() {
    if (stopRequested) {
      running = false;
      log.info("Email scheduler worker stopped");
      return;
    }
    pollTimer = setTimeout(async () => {
      try {
        await processTick();
      } catch (err: unknown) {
        log.error("Unexpected error in email scheduler tick", { error: err instanceof Error ? err.message : String(err) });
      }
      scheduleTick();
    }, POLL_INTERVAL_MS);
  }

  // Run first tick immediately (in case there are overdue emails on startup)
  processTick().catch((err) => {
    log.error("First tick error", { error: err instanceof Error ? err.message : String(err) });
  }).finally(scheduleTick);
}

export function stopEmailSchedulerWorker(): void {
  stopRequested = true;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  running = false;
  log.info("Email scheduler worker stop requested");
}
