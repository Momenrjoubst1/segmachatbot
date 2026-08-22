import { describe, it, expect, beforeEach, vi } from "vitest";
import redis from "../config/redis/client.js";

/**
 * Daily upload quota against the globally-mocked redis client (see
 * __tests__/setup.ts — get() resolves null by default). We back the mock with
 * a real Map here so reserve/release arithmetic is exercised end-to-end.
 * The byte limit is read from env at module load; each case loads a fresh
 * module registry with its own limit.
 */

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.mocked(redis.get).mockImplementation(async (key: string) => store.get(key) ?? null);
  vi.mocked(redis.set).mockImplementation(async (key: string, value: string) => {
    store.set(key, String(value));
    return "OK" as const;
  });
});

async function loadQuotaModule(limitBytes: string) {
  process.env.UPLOAD_DAILY_BYTES_LIMIT = limitBytes;
  vi.resetModules();
  return await import("../services/chat/attachment-quota.js");
}

describe("attachment quota", () => {
  it("allows uploads within the daily budget", async () => {
    const { reserveUploadBytes } = await loadQuotaModule("1000");
    const reservation = await reserveUploadBytes("user-a", 600);
    expect(reservation.bytes).toBe(600);
    await reservation.release();
  });

  it("rejects uploads beyond the daily budget with remaining bytes", async () => {
    const { reserveUploadBytes, QuotaExceededError } = await loadQuotaModule("1000");
    const first = await reserveUploadBytes("user-b", 700);

    await expect(reserveUploadBytes("user-b", 500)).rejects.toBeInstanceOf(QuotaExceededError);
    // A different user has their own bucket.
    const other = await reserveUploadBytes("user-c", 500);
    expect(other.bytes).toBe(500);
    await other.release();

    await first.release();
  });

  it("release refunds reserved bytes", async () => {
    const { reserveUploadBytes } = await loadQuotaModule("1000");
    const first = await reserveUploadBytes("user-d", 800);
    await first.release();

    // After the refund the full budget is available again.
    const second = await reserveUploadBytes("user-d", 1000);
    expect(second.bytes).toBe(1000);
    await second.release();
  });

  it("fails open when redis errors (metering never blocks chat)", async () => {
    vi.mocked(redis.get).mockRejectedValueOnce(new Error("connection lost"));
    const { reserveUploadBytes } = await loadQuotaModule("1000");
    const reservation = await reserveUploadBytes("user-e", 999_999);
    expect(reservation.bytes).toBe(999_999);
    await reservation.release();
  });
});
