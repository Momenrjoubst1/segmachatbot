// Daily per-user upload quota kept in Redis; Redis failures fail open.
import redis from "../../config/redis/client.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("attachment-quota");

/** Default: 2 GB/day/user. Override with UPLOAD_DAILY_BYTES_LIMIT. */
export const DAILY_BYTES_LIMIT = Number(process.env.UPLOAD_DAILY_BYTES_LIMIT || 2 * 1024 * 1024 * 1024);

const TTL_SECONDS = 172_800; // 2 days — rolls over naturally per UTC day

function todayKey(userId: string): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `uploads:bytes:${userId}:${ymd}`;
}

export interface QuotaReservation {
  bytes: number;
  release(): Promise<void>;
}

// Reserve bytes against today's quota, throwing when the user is over the limit.
export async function reserveUploadBytes(userId: string, bytes: number): Promise<QuotaReservation> {
  let reserved = false;
  try {
    const key = todayKey(userId);
    // Deliberately non-atomic read+write: a race only loosens the counter slightly
    const usedRaw = await redis.get(key);
    const used = usedRaw ? parseInt(usedRaw, 10) : 0;
    if (used + bytes > DAILY_BYTES_LIMIT) {
      throw new QuotaExceededError(DAILY_BYTES_LIMIT - used);
    }
    await redis.set(key, String(used + bytes), "EX", TTL_SECONDS);
    reserved = true;
  } catch (err) {
    if (err instanceof QuotaExceededError) throw err;
    log.warn("Upload quota check failed open", { userId, error: (err as Error).message });
  }

  return {
    bytes,
    async release() {
      if (!reserved) return;
      reserved = false;
      try {
        const key = todayKey(userId);
        const usedRaw = await redis.get(key);
        const used = usedRaw ? parseInt(usedRaw, 10) : 0;
        await redis.set(key, String(Math.max(0, used - bytes)), "EX", TTL_SECONDS);
      } catch (err) {
        log.warn("Upload quota release failed", { userId, error: (err as Error).message });
      }
    },
  };
}

export class QuotaExceededError extends Error {
  readonly remainingBytes: number;
  constructor(remainingBytes: number) {
    super("Daily upload limit reached");
    this.name = "QuotaExceededError";
    this.remainingBytes = Math.max(0, remainingBytes);
  }
}
