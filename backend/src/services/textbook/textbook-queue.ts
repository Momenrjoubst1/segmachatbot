import { supabase } from "../../config/supabase.config.js";
import redis from "../../config/redis/client.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("textbook-queue");

export interface TextbookJobData {
  textbookId: string;
  fileUrl: string;
  userId: string;
  fileHash: string;
  retry_count?: number;
}

export interface TextbookJobResult {
  textbookId: string;
  status: "completed" | "failed";
  error?: string;
  structureTree?: Record<string, unknown>;
  figures?: Array<Record<string, unknown>>;
  chunks?: Array<{
    page_number: number;
    structure_path: string;
    content: string;
    block_role?: string;
    text_color?: string;
    bbox?: Record<string, number>;
  }>;
  totalPages?: number;
}

const QUEUE_NAME = "textbook:jobs";
const PROCESSING_KEY = "textbook:processing";
const DLQ_KEY = "textbook:dead_letter";
const RESULT_PREFIX = "textbook:result:";
const PROGRESS_PREFIX = "textbook:progress:";
const JOB_TIMEOUT = 3600; // 1 hour
const MAX_RETRIES = 3;

export async function enqueueTextbookJob(data: TextbookJobData): Promise<string> {
  const jobId = `${data.textbookId}:${Date.now()}`;
  const payload = JSON.stringify({ ...data, jobId, createdAt: Date.now() });
  await redis.lpush(QUEUE_NAME, payload);
  log.info("Textbook job enqueued", { jobId, textbookId: data.textbookId });
  return jobId;
}

/**
 * Re-enqueue a failed job with an incremented retry_count (worker-driven
 * retry for transient failures). Fresh jobId/createdAt so stuck-job sweeping
 * measures from the retry time, not the original enqueue.
 */
export async function requeueTextbookJob(data: TextbookJobData): Promise<string> {
  const jobId = `${data.textbookId}:retry${(data.retry_count || 0) + 1}:${Date.now()}`;
  const payload = JSON.stringify({
    ...data,
    retry_count: (data.retry_count || 0) + 1,
    jobId,
    createdAt: Date.now(),
  });
  await redis.lpush(QUEUE_NAME, payload);
  log.warn("Textbook job requeued for retry", {
    jobId,
    textbookId: data.textbookId,
    retry: (data.retry_count || 0) + 1,
  });
  return jobId;
}

export async function setTextbookProgress(
  textbookId: string,
  progress: { stage: string; pages_done: number; total_pages: number }
): Promise<void> {
  await redis.set(`${PROGRESS_PREFIX}${textbookId}`, JSON.stringify(progress), "EX", JOB_TIMEOUT);
}

export async function getTextbookProgress(
  textbookId: string
): Promise<{ stage: string; pages_done: number; total_pages: number } | null> {
  const raw = await redis.get(`${PROGRESS_PREFIX}${textbookId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function setJobResult(result: TextbookJobResult): Promise<void> {
  await redis.set(`${RESULT_PREFIX}${result.textbookId}`, JSON.stringify(result), "EX", JOB_TIMEOUT);
}

export async function getJobResult(
  textbookId: string
): Promise<TextbookJobResult | null> {
  const raw = await redis.get(`${RESULT_PREFIX}${textbookId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function dequeueTextbookJob(): Promise<(TextbookJobData & { jobId: string }) | null> {
  const raw = await redis.rpoplpush(QUEUE_NAME, PROCESSING_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    log.error("Malformed job in queue, moving to DLQ", { raw: raw?.substring(0, 200) });
    await redis.lrem(PROCESSING_KEY, 1, raw);
    await redis.lpush(DLQ_KEY, JSON.stringify({
      raw,
      error: "JSON parse failed",
      failed_at: new Date().toISOString(),
    }));
    return null;
  }
}

export async function confirmJobComplete(jobId: string): Promise<void> {
  const jobs = await redis.lrange(PROCESSING_KEY, 0, -1);
  for (const jobStr of jobs) {
    try {
      const job = JSON.parse(jobStr);
      if (job.jobId === jobId) {
        await redis.lrem(PROCESSING_KEY, 1, jobStr);
        break;
      }
    } catch {
      // Ignore parse errors
    }
  }
}

export async function deadLetterJob(jobData: TextbookJobData & { jobId: string }, error: string): Promise<void> {
  const entry = {
    ...jobData,
    error,
    failed_at: new Date().toISOString(),
    retry_count: (jobData.retry_count || 0) + 1,
  };
  await redis.lpush(DLQ_KEY, JSON.stringify(entry));
  log.warn("Job moved to DLQ", {
    textbookId: jobData.textbookId,
    retry: entry.retry_count,
    error,
  });
}

export async function retryDeadLetters(): Promise<number> {
  let retried = 0;

  while (true) {
    const raw = await redis.rpoplpush(DLQ_KEY, "textbook:dlq:processing");
    if (!raw) break;

    try {
      const job = JSON.parse(raw);
      if (job.retry_count < MAX_RETRIES) {
        await redis.lpush(QUEUE_NAME, JSON.stringify(job));
        retried++;
        log.info("Retrying dead letter job", {
          textbookId: job.textbookId,
          retry: job.retry_count,
        });
      } else {
        log.warn("Job exceeded max retries, dropping", {
          textbookId: job.textbookId,
          retry: job.retry_count,
        });
      }
      await redis.lrem("textbook:dlq:processing", 1, raw);
    } catch {
      log.error("Failed to parse dead letter job", { raw });
      await redis.lrem("textbook:dlq:processing", 1, raw);
    }
  }

  return retried;
}

export function getRedisClient() {
  return redis;
}

const STUCK_JOB_TIMEOUT_MS = 3600_000; // 1 hour

/**
 * DB-level reconciliation: books stuck in pending/processing with no live
 * queue job (lost after a Redis flush, in-memory mock restart, or a crash
 * between insert and enqueue) are re-enqueued from their stored file_url.
 *
 * - `pending` older than 15 min: the queue should have picked it up within
 *   seconds — if not, the job is gone.
 * - `processing` older than 75 min: beyond the 1h job timeout + slack.
 *
 * Books currently present in the Redis processing list are left alone (a
 * worker may legitimately still be chewing on them).
 */
export async function reconcileStuckTextbooks(): Promise<number> {
  const now = Date.now();
  const pendingCutoff = new Date(now - 15 * 60_000).toISOString();
  const processingCutoff = new Date(now - 75 * 60_000).toISOString();

  const { data: stuck, error } = await supabase
    .from("textbooks")
    .select("id, user_id, file_url, file_hash, status, updated_at")
    .or(
      `and(status.eq.pending,updated_at.lt.${pendingCutoff}),and(status.eq.processing,updated_at.lt.${processingCutoff})`
    )
    .limit(50);

  if (error || !stuck || stuck.length === 0) {
    return 0;
  }

  // Skip any textbook that still has a live job in the processing list
  const processingRaw = await redis.lrange(PROCESSING_KEY, 0, -1);
  const activeIds = new Set<string>();
  for (const jobStr of processingRaw) {
    try {
      const job = JSON.parse(jobStr);
      if (job.textbookId) activeIds.add(job.textbookId);
    } catch {
      // ignore
    }
  }

  let requeued = 0;
  for (const book of stuck) {
    if (activeIds.has(book.id)) continue;
    if (!book.file_url || book.file_url.startsWith("pending://")) continue;

    if (book.status === "processing") {
      await supabase
        .from("textbooks")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", book.id);
    }

    await enqueueTextbookJob({
      textbookId: book.id,
      fileUrl: book.file_url,
      userId: book.user_id,
      fileHash: book.file_hash || "",
    });

    requeued++;
    log.warn("Reconciled stuck textbook", { textbookId: book.id, prevStatus: book.status });
  }

  if (requeued > 0) {
    log.info("Reconciled stuck textbooks", { count: requeued });
  }
  return requeued;
}

export async function sweepStuckJobs(): Promise<number> {
  let swept = 0;

  const jobs = await redis.lrange(PROCESSING_KEY, 0, -1);
  const now = Date.now();

  for (const jobStr of jobs) {
    try {
      const job = JSON.parse(jobStr);
      if (job.createdAt && now - job.createdAt > STUCK_JOB_TIMEOUT_MS) {
        await redis.lrem(PROCESSING_KEY, 1, jobStr);
        await redis.lpush(DLQ_KEY, JSON.stringify({
          ...job,
          error: "Job stuck in processing (timeout)",
          failed_at: new Date().toISOString(),
        }));

        if (job.textbookId) {
          await supabase
            .from("textbooks")
            .update({
              status: "failed",
              error: "Processing timed out (stuck job)",
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.textbookId)
            .eq("status", "processing");
        }

        swept++;
        log.warn("Swept stuck job to DLQ", { jobId: job.jobId, textbookId: job.textbookId });
      }
    } catch {
      await redis.lrem(PROCESSING_KEY, 1, jobStr);
      swept++;
    }
  }

  if (swept > 0) {
    log.info("Swept stuck jobs from processing queue", { count: swept });
  }
  return swept;
}
