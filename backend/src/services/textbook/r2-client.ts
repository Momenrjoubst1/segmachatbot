/**
 * Minimal Cloudflare R2 (S3-compatible) client — AWS SDK v3.
 *
 * Provides:
 *  - `presignR2Get(key, ttlSeconds)` — short-lived presigned GET URL, so
 *    textbook figure images are never exposed via permanent public URLs.
 *  - `deleteR2ObjectsByPrefix(prefix)` — batch-deletes every object under a
 *    prefix (1000 per call) when a textbook is deleted.
 *
 * Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.
 * All operations are no-ops (with a warn log) when R2 is not configured.
 */

import { S3Client, ListObjectsV2Command, DeleteObjectsCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream } from "fs";
import { Readable } from "stream";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("r2-client");

const REGION = "auto";

let _client: S3Client | null = null;
let _bucket: string | null = null;
let _publicBase: string | null = null;

function r2Client(): S3Client | null {
  if (_client) return _client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;

  _bucket = bucket;
  _client = new S3Client({
    region: REGION,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  _publicBase = process.env.R2_PUBLIC_URL || `https://${bucket}.${accountId}.r2.cloudflarestorage.com`;
  return _client;
}

export function isR2Configured(): boolean {
  return r2Client() !== null;
}

/** Derive the bare object key from an R2 public URL (any host), if possible. */
export function extractR2KeyFromUrl(url: string): string | null {
  const match = url.match(/\/(textbooks\/[^/?#]+(?:\/[^/?#]+)*\/[^/?#]+)\b/);
  return match ? match[1] : null;
}

/**
 * Presigned GET URL valid for `ttlSeconds`.
 */
export async function presignR2Get(key: string, ttlSeconds = 3600): Promise<string | null> {
  const client = r2Client();
  if (!client || !_bucket) return null;

  const command = new GetObjectCommand({ Bucket: _bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: ttlSeconds });
}

/**
 * Size of an R2 object in bytes (HEAD request — no download).
 * Returns null when the object is missing or R2 is unconfigured.
 */
export async function statR2Object(key: string): Promise<number | null> {
  const client = r2Client();
  if (!client || !_bucket) return null;

  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: _bucket, Key: key }));
    return res.ContentLength ?? null;
  } catch {
    return null;
  }
}

/**
 * Streaming upload of a large file to R2.
 * Returns true on success, false on failure.
 */
export async function uploadR2ObjectFromFile(
  key: string,
  filePath: string,
  contentType: string,
  contentLength?: number,
  payloadSha256Hex?: string
): Promise<boolean> {
  const client = r2Client();
  if (!client || !_bucket) {
    log.warn("R2 not configured — skipping streaming upload", { key });
    return false;
  }

  try {
    const body = createReadStream(filePath);
    const command = new PutObjectCommand({
      Bucket: _bucket,
      Key: key,
      ContentType: contentType,
      Body: body,
      ...(contentLength !== undefined && { ContentLength: contentLength }),
    });
    await client.send(command);
    log.info("R2 streaming upload complete", { key });
    return true;
  } catch (err) {
    log.error("R2 streaming upload error", { key, error: (err as Error).message });
    return false;
  }
}

/**
 * Signed GET of an R2 object as a web stream — pipe large files (source
 * PDFs) straight to the HTTP response without buffering them in memory.
 * Returns null when R2 is unconfigured or the object is missing.
 */
export async function getR2ObjectWebStream(
  key: string
): Promise<ReadableStream<Uint8Array> | null> {
  const client = r2Client();
  if (!client || !_bucket) return null;

  try {
    const response = await client.send(new GetObjectCommand({ Bucket: _bucket, Key: key }));
    if (!response.Body) return null;
    return response.Body.transformToWebStream() as unknown as ReadableStream<Uint8Array>;
  } catch {
    return null;
  }
}

/**
 * Streaming download of an R2 object to a local file.
 * Returns the number of bytes written; throws on failure.
 */
export async function downloadR2ObjectToFile(key: string, destPath: string): Promise<number> {
  const client = r2Client();
  if (!client || !_bucket) throw new Error("R2 not configured");

  const { createWriteStream } = await import("fs");
  const { pipeline } = await import("stream/promises");
  const stat = await import("fs/promises");

  const command = new GetObjectCommand({ Bucket: _bucket, Key: key });
  const response = await client.send(command);

  if (!response.Body) throw new Error("R2 GET returned empty body");

  await pipeline(response.Body.transformToWebStream() as unknown as NodeJS.ReadableStream, createWriteStream(destPath));
  const { size } = await stat.default.stat(destPath);
  return size;
}

/**
 * Signed GET of a (small) R2 object into a Buffer. For thumbnails and
 * figure images — large PDFs should use downloadR2ObjectToFile instead.
 */
export async function downloadR2ObjectToBuffer(key: string): Promise<Buffer> {
  const client = r2Client();
  if (!client || !_bucket) throw new Error("R2 not configured");

  const command = new GetObjectCommand({ Bucket: _bucket, Key: key });
  const response = await client.send(command);

  if (!response.Body) throw new Error("R2 GET returned empty body");

  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

/**
 * Upload a buffer to R2.
 * Returns the public URL on success, null on failure.
 */
export async function uploadR2Object(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string | null> {
  const client = r2Client();
  if (!client || !_bucket || !_publicBase) {
    log.warn("R2 not configured — skipping upload", { key });
    return null;
  }

  try {
    const command = new PutObjectCommand({
      Bucket: _bucket,
      Key: key,
      ContentType: contentType,
      Body: body,
    });
    await client.send(command);
    const publicUrl = `${_publicBase}/${key}`;
    log.info("R2 upload complete", { key, size: body.length });
    return publicUrl;
  } catch (err) {
    log.error("R2 upload error", { key, error: (err as Error).message });
    return null;
  }
}

/**
 * Delete a single R2 object by key.
 * Returns true on success, false on failure.
 */
export async function deleteR2Object(key: string): Promise<boolean> {
  const client = r2Client();
  if (!client || !_bucket) {
    log.warn("R2 not configured — skipping delete", { key });
    return false;
  }

  try {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: _bucket,
        Delete: { Objects: [{ Key: key }], Quiet: true },
      })
    );
    log.info("R2 object deleted", { key });
    return true;
  } catch (err) {
    log.error("R2 delete error", { key, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * List and batch-delete every object under `prefix`.
 * Sends up to 1000 keys per DeleteObjects call.
 * Best-effort: failures are logged, never thrown.
 */
export async function deleteR2ObjectsByPrefix(prefix: string): Promise<number> {
  const client = r2Client();
  if (!client || !_bucket) {
    log.warn("R2 not configured — skipping prefix deletion", { prefix });
    return 0;
  }

  try {
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
      const listRes = await client.send(
        new ListObjectsV2Command({
          Bucket: _bucket,
          Prefix: prefix,
          MaxKeys: 1000,
          ...(continuationToken && { ContinuationToken: continuationToken }),
        })
      );

      const objects = listRes.Contents ?? [];
      if (objects.length > 0) {
        const deleteRes = await client.send(
          new DeleteObjectsCommand({
            Bucket: _bucket,
            Delete: {
              Objects: objects.map((obj) => ({ Key: obj.Key! })),
              Quiet: true,
            },
          })
        );
        deleted += objects.length;
        if (deleteRes.Errors?.length) {
          for (const err of deleteRes.Errors) {
            log.error("R2 batch delete error", { key: err.Key, code: err.Code, message: err.Message });
          }
        }
      }

      continuationToken = listRes.NextContinuationToken;
    } while (continuationToken);

    log.info("R2 prefix deletion complete", { prefix, deleted });
    return deleted;
  } catch (err) {
    log.warn("R2 prefix deletion failed (non-fatal)", {
      prefix,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
