import { supabase } from "../../config/supabase.config.js";
import redis from "../../config/redis/client.js";
import { createLogger } from "../../utils/logger.js";
import {
  dequeueTextbookJob,
  confirmJobComplete,
  setTextbookProgress,
  sweepStuckJobs,
  retryDeadLetters,
  reconcileStuckTextbooks,
  requeueTextbookJob,
  setWorkerHeartbeat,
  type TextbookJobData,
} from "./textbook-queue.js";
import { processTextbookJob } from "./textbook-processor.js";
import { embedTextbookChunks } from "./textbook-embeddings.js";
import { PermanentJobError, userFacingError } from "./errors.js";
import { invalidateUserTextbookSignal } from "../chat/pipeline/rag-retrieval.js";

const log = createLogger("textbook-worker");

let running = false;
let stopRequested = false;
let errorCount = 0;
const MAX_CONSECUTIVE_ERRORS = 10;
const BASE_BACKOFF_MS = 1000;
const MAX_RETRIES = 3;
const LOCK_TTL_SECONDS = 1800; // lock lives as long as the max job budget
const WORKER_COOLDOWN_MS = 60_000; // cool down (instead of dying) after too many consecutive errors
const SHUTDOWN_TIMEOUT_MS = 30_000; // 30 seconds to finish current job
const SWEEP_INTERVAL_MS = 3600_000; // 1 hour

let sweepInterval: NodeJS.Timeout | null = null;

/** Best-effort per-textbook lock so reconciled and original jobs never run
 *  the same book concurrently (duplicate chunk writes, racing deletes). */
async function acquireTextbookLock(textbookId: string, jobId: string): Promise<boolean> {
  const result = await redis.set(`textbook:lock:${textbookId}`, jobId, "EX", LOCK_TTL_SECONDS, "NX");
  return result === "OK";
}

async function releaseTextbookLock(textbookId: string, jobId: string): Promise<void> {
  const current = await redis.get(`textbook:lock:${textbookId}`);
  if (current === jobId) {
    await redis.del(`textbook:lock:${textbookId}`);
  }
}

async function markTextbookFailed(textbookId: string, err: unknown): Promise<void> {
  await supabase
    .from("textbooks")
    .update({
      status: "failed",
      error: userFacingError(err),
      updated_at: new Date().toISOString(),
    })
    .eq("id", textbookId);
}

export async function startTextbookWorker(): Promise<void> {
  if (running) return;
  running = true;
  stopRequested = false;
  errorCount = 0;
  log.info("Textbook worker started");

  // Recover state from previous runs: sweep stuck Redis jobs, retry dead
  // letters, and reconcile DB rows whose jobs were lost entirely.
  await sweepStuckJobs().catch((err) => {
    log.warn("Failed to sweep stuck jobs", { error: (err as Error).message });
  });
  await retryDeadLetters().catch((err) => {
    log.warn("Failed to retry dead letters", { error: (err as Error).message });
  });
  await reconcileStuckTextbooks().catch((err) => {
    log.warn("Failed to reconcile stuck textbooks", { error: (err as Error).message });
  });

  // Setup periodic sweep every hour
  sweepInterval = setInterval(async () => {
    await sweepStuckJobs().catch((err) => {
      log.warn("Failed to sweep stuck jobs", { error: (err as Error).message });
    });
    await retryDeadLetters().catch((err) => {
      log.warn("Failed to retry dead letters", { error: (err as Error).message });
    });
    await reconcileStuckTextbooks().catch((err) => {
      log.warn("Failed to reconcile stuck textbooks", { error: (err as Error).message });
    });
  }, SWEEP_INTERVAL_MS);

  processLoop();
}

export function stopTextbookWorker(): Promise<void> {
  return new Promise((resolve) => {
    if (!running) {
      resolve();
      return;
    }
    stopRequested = true;
    log.info("Textbook worker stopping");

    // Clear periodic sweep
    if (sweepInterval) {
      clearInterval(sweepInterval);
      sweepInterval = null;
    }

    const timeout = setTimeout(() => {
      log.warn("Textbook worker shutdown timed out, forcing stop");
      running = false;
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);

    const checkInterval = setInterval(() => {
      if (!running) {
        clearTimeout(timeout);
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
  });
}

async function handleJobFailure(job: TextbookJobData & { jobId: string }, err: unknown): Promise<void> {
  const isPermanent = err instanceof PermanentJobError;
  const retriesSoFar = job.retry_count || 0;

  if (!isPermanent && retriesSoFar < MAX_RETRIES) {
    // Transient failure (network/timeout/5xx) — back into the queue with an
    // incremented retry counter. Status returns to pending so the UI keeps
    // showing progress instead of a premature "failed".
    await supabase
      .from("textbooks")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("id", job.textbookId);
    await requeueTextbookJob(job);
    return;
  }

  log.error("Textbook job failed permanently", {
    textbookId: job.textbookId,
    retries: retriesSoFar,
    isPermanent,
    error: err instanceof Error ? err.message : String(err),
  });
  await markTextbookFailed(job.textbookId, err);
}

async function processLoop(): Promise<void> {
  while (!stopRequested) {
    try {
      // Write heartbeat every iteration so reconcileStuckTextbooks knows
      // this worker is alive (key expires after 60s if we die).
      setWorkerHeartbeat().catch(() => {});

      const job = await dequeueTextbookJob();
      if (!job) {
        errorCount = 0;
        // Avoid tight polling loop — sleep 2s before checking again
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      log.info("Processing textbook job", { jobId: job.jobId, textbookId: job.textbookId });

      // Another worker (or a reconciled duplicate) already owns this book
      if (!(await acquireTextbookLock(job.textbookId, job.jobId))) {
        log.info("Textbook locked elsewhere, skipping job", { textbookId: job.textbookId });
        await confirmJobComplete(job.jobId);
        continue;
      }

      try {
        // Phase 1: PDF Processing (extraction + classification + structure +
        // figures). Per-page progress is reported to Redis by the Python
        // service under stage "scanning".
        const result = await processTextbookJob(job);

        // Phase 2: Embedding — separate try-catch for recovery
        try {
          await setTextbookProgress(job.textbookId, {
            stage: "embedding",
            pages_done: 0,
            total_pages: 0,
          });

          const embedded = await embedTextbookChunks(job.textbookId, (done, total) => {
            setTextbookProgress(job.textbookId, {
              stage: "embedding",
              pages_done: done,
              total_pages: total,
            }).catch(() => {});
          });
          log.info("Textbook embeddings complete", {
            textbookId: job.textbookId,
            embedded,
          });

          // Success — mark as completed (the book is usable from here)
          await supabase
            .from("textbooks")
            .update({
              status: "completed",
              processing_completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.textbookId);

          invalidateUserTextbookSignal(job.userId);

          // Notify the originating chat thread (chat-attached materials):
          // the user was told "we'll ping you here when it's ready".
          try {
            const { data: book } = await supabase
              .from("textbooks")
              .select("file_name, source_thread_id")
              .eq("id", job.textbookId)
              .single();

            if (book?.source_thread_id) {
              await supabase.from("chat_messages").insert([
                {
                  session_id: book.source_thread_id,
                  role: "assistant",
                  content:
                    `✅ خلصت! المادة «${book.file_name}» صارت جاهزة — فهمت دروسها ومصطلحاتها ورسماتها.\n\n` +
                    `جرّب عليّ: «علّمني الدرس الأول»، «شو مواضيع الوحدة الأولى؟»، أو «اختبرني بالدرس الثاني» 🎓`,
                },
              ]);
            }
          } catch (notifyErr) {
            log.warn("Completion notification failed (non-fatal)", {
              textbookId: job.textbookId,
              error: (notifyErr as Error).message,
            });
          }

          // Phase 3 — selective visual understanding (VLM). Best-effort:
          // runs after completion so a VLM outage never blocks the book.
          try {
            const { enrichTextbookVisually } = await import("./textbook-visual.js");
            await setTextbookProgress(job.textbookId, {
              stage: "visual",
              pages_done: 0,
              total_pages: 0,
            });
            const visual = await enrichTextbookVisually(job.textbookId, (done, total) => {
              setTextbookProgress(job.textbookId, {
                stage: "visual",
                pages_done: done,
                total_pages: total,
              }).catch(() => {});
            });
            log.info("Visual enrichment done", {
              textbookId: job.textbookId,
              pages: visual.pages,
              figures: visual.figures,
            });
          } catch (visualErr) {
            log.warn("Visual enrichment skipped (non-fatal)", {
              textbookId: job.textbookId,
              error: (visualErr as Error).message,
            });
          }

          // Confirm job completion to remove from processing list
          await confirmJobComplete(job.jobId);
        } catch (embedErr) {
          // Embedding failed — counts as transient: requeue the whole job
          // (extraction is idempotent — chunks are rewritten) so embeddings
          // get another chance instead of failing the book outright.
          log.error("Embedding failed", {
            textbookId: job.textbookId,
            error: embedErr instanceof Error ? embedErr.message : String(embedErr),
          });
          await handleJobFailure(job, embedErr);
          await confirmJobComplete(job.jobId);
        }

        errorCount = 0;
      } catch (err) {
        await handleJobFailure(job, err);
        await confirmJobComplete(job.jobId);
        errorCount = 0;
      } finally {
        await releaseTextbookLock(job.textbookId, job.jobId);
      }
    } catch (err) {
      errorCount++;
      log.error("Worker loop error", {
        error: (err as Error).message,
        errorCount,
      });

      const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, errorCount), 30_000);
      await new Promise((r) => setTimeout(r, backoff));

      if (errorCount >= MAX_CONSECUTIVE_ERRORS) {
        log.warn("Too many consecutive errors — pausing worker for 5 minutes before resuming");
        // Do NOT break — sleep (interruptibly, so shutdown isn't blocked for
        // 5 minutes) and reset the counter so the worker survives transient
        // outages and resumes afterwards.
        const resumeAt = Date.now() + 5 * 60_000;
        while (!stopRequested && Date.now() < resumeAt) {
          await new Promise((r) => setTimeout(r, 1000));
        }
        errorCount = 0;
      }
    }
  }
  running = false;
  log.info("Textbook worker stopped");
}
