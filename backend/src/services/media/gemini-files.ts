/**
 * Gemini Files API integration — server-side staging for large media.
 *
 * Videos/audio above the inline-request budget are downloaded from R2 and
 * uploaded once to the Gemini Files API (resumable protocol), then referenced
 * in model calls by fileUri — which @ai-sdk/google maps natively to
 * `fileData` parts, so no base64 ever crosses a request body.
 *
 * Files live 48h in Gemini's project storage (free tier: 2GB/file, 20GB
 * total); results are cached in Redis under sha256(r2Key) with a 46h TTL so
 * follow-up turns reuse the staged copy instead of re-uploading.
 *
 * Env: GEMINI_API_KEY. All functions return null when unconfigured/failed —
 * callers must fall back (e.g. to inline data URLs or transcription).
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import redis from "../../config/redis/client.js";
import { createLogger } from "../../utils/logger.js";
import { downloadR2ObjectToFile } from "../textbook/r2-client.js";

const log = createLogger("gemini-files");

const API_BASE = "https://generativelanguage.googleapis.com";
const CACHE_TTL_SECONDS = 46 * 3600; // stay under Gemini's 48h retention
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;

interface StagedFile {
  /** Full file URI usable as FilePart url (maps to fileData.fileUri). */
  uri: string;
  /** files/{id} resource name, for cleanup. */
  name: string;
}

function apiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
}

function cacheKey(r2Key: string): string {
  return `gemini:file:${crypto.createHash("sha256").update(r2Key).digest("hex")}`;
}

async function readCache(r2Key: string): Promise<StagedFile | null> {
  try {
    const raw = await redis.get(cacheKey(r2Key));
    return raw ? (JSON.parse(raw) as StagedFile) : null;
  } catch {
    return null;
  }
}

async function writeCache(r2Key: string, staged: StagedFile): Promise<void> {
  try {
    await redis.set(cacheKey(r2Key), JSON.stringify(staged), "EX", CACHE_TTL_SECONDS);
  } catch { /* cache is best-effort */ }
}

/**
 * Resumable-upload one local file to the Gemini Files API.
 * Returns the staged File resource or null on failure.
 */
async function uploadToGeminiFiles(
  filePath: string,
  mimeType: string,
  displayName: string,
): Promise<StagedFile | null> {
  const key = apiKey();
  if (!key) return null;

  try {
    const { size } = await fs.promises.stat(filePath);

    // Step 1: start the resumable session.
    const startRes = await fetch(`${API_BASE}/upload/v1beta/files`, {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(size),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName.substring(0, 200) } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!startRes.ok) {
      log.warn("Gemini Files start failed", { status: startRes.status, body: await startRes.text().catch(() => "") });
      return null;
    }
    const uploadUrl = startRes.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      log.warn("Gemini Files start returned no upload URL");
      return null;
    }

    // Step 2: stream bytes and finalize in one command (single-shot resumable).
    const body = fs.createReadStream(filePath);
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
        "Content-Length": String(size),
      },
      // Node fetch accepts a stream body with duplex half-open.
      body: body as unknown as AsyncIterable<Uint8Array>,
      duplex: "half",
      signal: AbortSignal.timeout(600_000),
    } as RequestInit);
    if (!uploadRes.ok) {
      log.warn("Gemini Files upload failed", { status: uploadRes.status });
      return null;
    }
    const fileJson = (await uploadRes.json()) as { file?: { uri?: string; name?: string; state?: string } };
    const fileMeta = fileJson.file;
    if (!fileMeta?.uri || !fileMeta.name) {
      log.warn("Gemini Files finalize returned unexpected shape");
      return null;
    }

    // Step 3: poll until ACTIVE (videos are processed asynchronously).
    if (fileMeta.state !== "ACTIVE") {
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let state = fileMeta.state;
      while (state === "PROCESSING" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const pollRes = await fetch(`${API_BASE}/${fileMeta.name}`, {
          headers: { "X-Goog-Api-Key": key },
          signal: AbortSignal.timeout(15_000),
        });
        if (!pollRes.ok) break;
        const polled = (await pollRes.json()) as { state?: string; error?: { message?: string } };
        state = polled.state ?? "";
        if (state === "FAILED") {
          log.warn("Gemini Files processing failed", { message: polled.error?.message });
          return null;
        }
      }
      if (state !== "ACTIVE") {
        log.warn("Gemini Files not ACTIVE before timeout", { state });
        return null;
      }
    }

    return { uri: fileMeta.uri, name: fileMeta.name };
  } catch (err) {
    log.warn("Gemini Files staging error", { error: (err as Error).message });
    return null;
  }
}

/**
 * Ensure an R2 object is available to Gemini and return its fileUri.
 * Cached per r2Key. Returns null when Gemini is unconfigured or staging fails.
 */
export async function stageMediaForGemini(
  r2Key: string,
  mimeType: string,
  displayName: string,
): Promise<StagedFile | null> {
  if (!apiKey()) return null;

  const cached = await readCache(r2Key);
  if (cached) return cached;

  const tmpPath = path.join(os.tmpdir(), `gemstaging_${crypto.randomBytes(8).toString("hex")}`);
  try {
    await downloadR2ObjectToFile(r2Key, tmpPath);
    const staged = await uploadToGeminiFiles(tmpPath, mimeType, displayName);
    if (staged) await writeCache(r2Key, staged);
    return staged;
  } catch (err) {
    log.warn("stageMediaForGemini failed", { r2Key, error: (err as Error).message });
    return null;
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}
