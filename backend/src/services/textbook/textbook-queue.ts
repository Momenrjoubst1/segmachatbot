import Redis from "ioredis";
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
  chunks?: Array<{ page_number: number; structure_path: string; content: string }>;
  totalPages?: number;
}

const QUEUE_NAME = "textbook:jobs";
const PROCESSING_KEY = "textbook:processing";
const DLQ_KEY = "textbook:dead_letter";
const RESULT_PREFIX = "textbook:result:";
const PROGRESS_PREFIX = "textbook:progress:";
const JOB_TIMEOUT = 3600; // 1 hour
const MAX_RETRIES = 3;

let redis: Redis | null = null;

function getRedis(): Redis {
  if (redis) return redis;
  redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  redis.on("connect", () => log.info("Textbook queue Redis connected"));
  redis.on("error", (err: Error) => log.error("Textbook queue Redis error: " + err.message));
  return redis;
}

export async function enqueueTextbookJob(data: TextbookJobData): Promise<string> {
  const r = getRedis();
  const jobId = `${data.textbookId}:${Date.now()}`;
  const payload = JSON.stringify({ ...data, jobId, createdAt: Date.now() });
  await r.lpush(QUEUE_NAME, payload);
  log.info("Textbook job enqueued", { jobId, textbookId: data.textbookId });
  return jobId;
}

export async function setTextbookProgress(
  textbookId: string,
  progress: { stage: string; pages_done: number; total_pages: number }
): Promise<void> {
  const r = getRedis();
  await r.set(`${PROGRESS_PREFIX}${textbookId}`, JSON.stringify(progress), "EX", JOB_TIMEOUT);
}

export async function getTextbookProgress(
  textbookId: string
): Promise<{ stage: string; pages_done: number; total_pages: number } | null> {
  const r = getRedis();
  const raw = await r.get(`${PROGRESS_PREFIX}${textbookId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function setJobResult(result: TextbookJobResult): Promise<void> {
  const r = getRedis();
  await r.set(`${RESULT_PREFIX}${result.textbookId}`, JSON.stringify(result), "EX", JOB_TIMEOUT);
}

export async function getJobResult(
  textbookId: string
): Promise<TextbookJobResult | null> {
  const r = getRedis();
  const raw = await r.get(`${RESULT_PREFIX}${textbookId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function dequeueTextbookJob(): Promise<(TextbookJobData & { jobId: string }) | null> {
  const r = getRedis();
  // Use RPOPLUSH to atomically move job to processing list
  // This prevents job loss on crash
  const raw = await r.rpoplpush(QUEUE_NAME, PROCESSING_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Log malformed job and push to DLQ instead of silently losing it
    log.error("Malformed job in queue, moving to DLQ", { raw: raw?.substring(0, 200) });
    await r.lrem(PROCESSING_KEY, 1, raw);
    await r.lpush(DLQ_KEY, JSON.stringify({
      raw,
      error: "JSON parse failed",
      failed_at: new Date().toISOString(),
    }));
    return null;
  }
}

export async function confirmJobComplete(jobId: string): Promise<void> {
  const r = getRedis();
  // Remove from processing list after successful completion
  const jobs = await r.lrange(PROCESSING_KEY, 0, -1);
  for (const jobStr of jobs) {
    try {
      const job = JSON.parse(jobStr);
      if (job.jobId === jobId) {
        await r.lrem(PROCESSING_KEY, 1, jobStr);
        break;
      }
    } catch {
      // Ignore parse errors
    }
  }
}

export async function deadLetterJob(jobData: TextbookJobData & { jobId: string }, error: string): Promise<void> {
  const r = getRedis();
  const entry = {
    ...jobData,
    error,
    failed_at: new Date().toISOString(),
    retry_count: (jobData.retry_count || 0) + 1,
  };
  await r.lpush(DLQ_KEY, JSON.stringify(entry));
  log.warn("Job moved to DLQ", {
    textbookId: jobData.textbookId,
    retry: entry.retry_count,
    error,
  });
}

export async function retryDeadLetters(): Promise<number> {
  const r = getRedis();
  let retried = 0;

  // Use RPOPLPUSH to atomically pop from DLQ and push to processing list
  // This prevents race conditions between concurrent retry calls
  while (true) {
    const raw = await r.rpoplpush(DLQ_KEY, "textbook:dlq:processing");
    if (!raw) break;

    try {
      const job = JSON.parse(raw);
      if (job.retry_count < MAX_RETRIES) {
        await r.lpush(QUEUE_NAME, JSON.stringify(job));
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
      // Remove from processing list after successful handling
      await r.lrem("textbook:dlq:processing", 1, raw);
    } catch {
      log.error("Failed to parse dead letter job", { raw });
      // Remove from processing list on parse failure
      await r.lrem("textbook:dlq:processing", 1, raw);
    }
  }

  return retried;
}

export function getRedisClient(): Redis {
  return getRedis();
}

const STUCK_JOB_TIMEOUT_MS = 3600_000; // 1 hour

export async function sweepStuckJobs(): Promise<number> {
  const r = getRedis();
  let swept = 0;

  const jobs = await r.lrange(PROCESSING_KEY, 0, -1);
  const now = Date.now();

  for (const jobStr of jobs) {
    try {
      const job = JSON.parse(jobStr);
      if (job.createdAt && now - job.createdAt > STUCK_JOB_TIMEOUT_MS) {
        // Job is stuck — move to DLQ
        await r.lrem(PROCESSING_KEY, 1, jobStr);
        await r.lpush(DLQ_KEY, JSON.stringify({
          ...job,
          error: "Job stuck in processing (timeout)",
          failed_at: new Date().toISOString(),
        }));
        swept++;
        log.warn("Swept stuck job to DLQ", { jobId: job.jobId, textbookId: job.textbookId });
      }
    } catch {
      // Remove malformed entries
      await r.lrem(PROCESSING_KEY, 1, jobStr);
      swept++;
    }
  }

  if (swept > 0) {
    log.info("Swept stuck jobs from processing queue", { count: swept });
  }
  return swept;
}
