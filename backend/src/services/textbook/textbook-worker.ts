import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";
import { dequeueTextbookJob, confirmJobComplete, setTextbookProgress, sweepStuckJobs } from "./textbook-queue.js";
import { processTextbookJob } from "./textbook-processor.js";
import { embedTextbookChunks } from "./textbook-embeddings.js";

const log = createLogger("textbook-worker");

function sanitizeErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Remove file paths, stack traces, and internal details
  return msg
    .replace(/\/[^\s:]+/g, "[path]")
    .replace(/Error:\s*/i, "")
    .substring(0, 200);
}

let running = false;
let stopRequested = false;
let errorCount = 0;
const MAX_CONSECUTIVE_ERRORS = 10;
const BASE_BACKOFF_MS = 1000;
const SHUTDOWN_TIMEOUT_MS = 30_000; // 30 seconds to finish current job
const SWEEP_INTERVAL_MS = 3600_000; // 1 hour

let sweepInterval: NodeJS.Timeout | null = null;

export async function startTextbookWorker(): Promise<void> {
  if (running) return;
  running = true;
  stopRequested = false;
  errorCount = 0;
  log.info("Textbook worker started");
  
  // Sweep stuck jobs from previous run
  await sweepStuckJobs().catch((err) => {
    log.warn("Failed to sweep stuck jobs", { error: (err as Error).message });
  });
  
  // Setup periodic sweep every hour
  sweepInterval = setInterval(async () => {
    await sweepStuckJobs().catch((err) => {
      log.warn("Failed to sweep stuck jobs", { error: (err as Error).message });
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

async function processLoop(): Promise<void> {
  while (!stopRequested) {
    try {
      const job = await dequeueTextbookJob();
      if (!job) {
        errorCount = 0;
        continue;
      }

      log.info("Processing textbook job", { jobId: job.jobId, textbookId: job.textbookId });

      // Phase 1: PDF Processing (extraction + classification + structure + figures)
      await setTextbookProgress(job.textbookId, {
        stage: "extraction",
        pages_done: 0,
        total_pages: 0,
      });

      const result = await processTextbookJob(job);

      if (result.status !== "completed") {
        // PDF processing failed — status already set to "failed" in processor
        await confirmJobComplete(job.jobId);
        errorCount = 0;
        continue;
      }

      // Phase 2: Embedding — separate try-catch for recovery
      try {
        await setTextbookProgress(job.textbookId, {
          stage: "embedding",
          pages_done: result.totalPages || 0,
          total_pages: result.totalPages || 0,
        });

        const embedded = await embedTextbookChunks(job.textbookId);
        log.info("Textbook embeddings complete", {
          textbookId: job.textbookId,
          embedded,
        });

        // Success — mark as completed
        await supabase
          .from("textbooks")
          .update({
            status: "completed",
            processing_completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.textbookId);

        // Confirm job completion to remove from processing list
        await confirmJobComplete(job.jobId);
      } catch (embedErr) {
        // Embedding failed — recover by setting status to "failed"
        const embedErrMsg = embedErr instanceof Error ? embedErr.message : String(embedErr);
        log.error("Embedding failed, marking textbook as failed", {
          textbookId: job.textbookId,
          error: embedErrMsg,
        });

        await supabase
          .from("textbooks")
          .update({
            status: "failed",
            error: sanitizeErrorMessage(embedErr),
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.textbookId);

        await confirmJobComplete(job.jobId);
      }

      errorCount = 0;
    } catch (err) {
      errorCount++;
      log.error("Worker loop error", {
        error: (err as Error).message,
        errorCount,
      });

      const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, errorCount), 30_000);
      await new Promise((r) => setTimeout(r, backoff));

      if (errorCount >= MAX_CONSECUTIVE_ERRORS) {
        log.error("Too many consecutive errors, stopping worker");
        break;
      }
    }
  }
  running = false;
  log.info("Textbook worker stopped");
}
