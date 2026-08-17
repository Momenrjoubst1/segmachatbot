/**
 * Minimal Cloudflare R2 (S3-compatible) client — pure node:crypto SigV4.
 *
 * Provides:
 *  - `presignR2Get(key, ttlSeconds)` — short-lived presigned GET URL, so
 *    textbook figure images are never exposed via permanent public URLs.
 *  - `deleteR2ObjectsByPrefix(prefix)` — used when a textbook is deleted so
 *    its R2 figures don't outlive the textbook.
 *
 * Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.
 * All operations are no-ops (with a warn log) when R2 is not configured.
 */

import { createHash, createHmac } from "crypto";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("r2-client");

const REGION = "auto"; // R2's recommended signing region
const EMPTY_PAYLOAD_SHA256 = createHash("sha256").update("").digest("hex");

function r2Config(): { host: string; bucket: string; accessKeyId: string; secretAccessKey: string } | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    host: `${accountId}.r2.cloudflarestorage.com`,
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

export function isR2Configured(): boolean {
  return r2Config() !== null;
}

/** RFC 3986 URI-encode (everything except A-Za-z0-9-_.~).
 *  With encodeSlash=false, "/" is preserved — required for S3-style
 *  canonical URIs (the server decodes %2F back to "/" before signing). */
function uriEncode(value: string, encodeSlash = true): string {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9\-_.~]/.test(ch) || (ch === "/" && !encodeSlash)) {
      out += ch;
    } else {
      const bytes = Buffer.from(ch, "utf-8");
      for (const b of bytes) out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

/**
 * Canonical URI path for S3-style signing: each segment is URI-encoded but
 * SLASHES ARE PRESERVED. Encoding slashes as %2F in the canonical request
 * makes R2/S3 compute a different signature (SignatureDoesNotMatch), because
 * the server decodes %2F back to "/" before signing.
 */
function canonicalObjectUri(bucket: string, key: string): string {
  return `/${bucket}/${uriEncode(key, false)}`;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf-8").digest();
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf-8").digest("hex");
}

function amzDates(): { amzDate: string; datestamp: string } {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  const datestamp = `${yyyy}${mm}${dd}`;
  const amzDate = `${datestamp}T${hh}${mi}${ss}Z`;
  return { amzDate, datestamp };
}

/** Derive the bare object key from an R2 public URL (any host), if possible. */
export function extractR2KeyFromUrl(url: string): string | null {
  const match = url.match(/\/(textbooks\/[^/?#]+(?:\/[^/?#]+)*\/[^/?#]+)\b/);
  return match ? match[1] : null;
}

/**
 * Presigned GET URL (SigV4, UNSIGNED-PAYLOAD) valid for `ttlSeconds`.
 */
export function presignR2Get(key: string, ttlSeconds = 3600): string | null {
  const cfg = r2Config();
  if (!cfg) return null;

  const { amzDate, datestamp } = amzDates();
  const credentialScope = `${datestamp}/${REGION}/s3/aws4_request`;
  const credential = `${cfg.accessKeyId}/${credentialScope}`;

  const canonicalUri = canonicalObjectUri(cfg.bucket, key);
  const query = new Map<string, string>([
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(Math.min(Math.max(1, ttlSeconds), 604800))],
    ["X-Amz-SignedHeaders", "host"],
  ]);
  const canonicalQuery = [...query.entries()]
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
    .sort()
    .join("&");

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    `host:${cfg.host}`,
    "",
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, datestamp), REGION), "s3"),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf-8").digest("hex");

  return `https://${cfg.host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Signed single-object DELETE.
 */
async function deleteR2Object(key: string): Promise<boolean> {
  const cfg = r2Config();
  if (!cfg) return false;
  const { amzDate, datestamp } = amzDates();
  const credentialScope = `${datestamp}/${REGION}/s3/aws4_request`;

  const canonicalUri = canonicalObjectUri(cfg.bucket, key);
  const headers: Record<string, string> = {
    host: cfg.host,
    "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256,
    "x-amz-date": amzDate,
  };
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${headers.host}\nx-amz-content-sha256:${headers["x-amz-content-sha256"]}\nx-amz-date:${headers["x-amz-date"]}\n`;

  const canonicalRequest = [
    "DELETE",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    EMPTY_PAYLOAD_SHA256,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, datestamp), REGION), "s3"),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf-8").digest("hex");

  const res = await fetch(`https://${cfg.host}${canonicalUri}`, {
    method: "DELETE",
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });
  return res.ok || res.status === 404;
}

/**
 * Streaming upload of a large file to R2 via signed PUT (SigV4,
 * UNSIGNED-PAYLOAD). Unlike `uploadR2Object`, the file is never buffered in
 * memory — required for source PDFs up to 500MB.
 * Returns true on success, false on failure.
 */
export async function uploadR2ObjectFromFile(
  key: string,
  filePath: string,
  contentType: string,
  contentLength?: number,
  payloadSha256Hex?: string
): Promise<boolean> {
  const cfg = r2Config();
  if (!cfg) {
    log.warn("R2 not configured — skipping streaming upload", { key });
    return false;
  }

  const { createReadStream } = await import("fs");
  const { Readable } = await import("stream");

  const { amzDate, datestamp } = amzDates();
  const credentialScope = `${datestamp}/${REGION}/s3/aws4_request`;
  // Prefer the real payload hash (the caller already computes it for dedup);
  // UNSIGNED-PAYLOAD otherwise.
  const payloadHash = payloadSha256Hex || "UNSIGNED-PAYLOAD";

  const canonicalUri = canonicalObjectUri(cfg.bucket, key);
  const headers: Record<string, string> = {
    host: cfg.host,
    "content-type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `content-type:${headers["content-type"]}\nhost:${headers.host}\nx-amz-content-sha256:${headers["x-amz-content-sha256"]}\nx-amz-date:${headers["x-amz-date"]}\n`;

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, datestamp), REGION), "s3"),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf-8").digest("hex");

  const requestHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentLength !== undefined) {
    requestHeaders["Content-Length"] = String(contentLength);
  }

  try {
    const body = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream;
    const res = await fetch(`https://${cfg.host}${canonicalUri}`, {
      method: "PUT",
      headers: requestHeaders,
      body,
      // `duplex: "half"` is required by Node's undici for streaming bodies
      duplex: "half",
    } as RequestInit);

    if (res.ok) {
      log.info("R2 streaming upload complete", { key });
      return true;
    } else {
      const text = await res.text();
      log.error("R2 streaming upload failed", { key, status: res.status, body: text.substring(0, 200) });
      return false;
    }
  } catch (err) {
    log.error("R2 streaming upload error", { key, error: (err as Error).message });
    return false;
  }
}

/**
 * Streaming download of an R2 object to a local file.
 * Returns the number of bytes written; throws on failure.
 */
export async function downloadR2ObjectToFile(key: string, destPath: string): Promise<number> {
  const cfg = r2Config();
  if (!cfg) {
    throw new Error("R2 not configured");
  }

  const { createWriteStream } = await import("fs");
  const stat = await import("fs/promises");
  const { pipeline } = await import("stream/promises");
  const { Readable } = await import("stream");

  const { amzDate, datestamp } = amzDates();
  const credentialScope = `${datestamp}/${REGION}/s3/aws4_request`;

  const canonicalUri = canonicalObjectUri(cfg.bucket, key);
  const headers: Record<string, string> = {
    host: cfg.host,
    "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256,
    "x-amz-date": amzDate,
  };
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${headers.host}\nx-amz-content-sha256:${headers["x-amz-content-sha256"]}\nx-amz-date:${headers["x-amz-date"]}\n`;

  const canonicalRequest = [
    "GET",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    EMPTY_PAYLOAD_SHA256,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, datestamp), REGION), "s3"),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf-8").digest("hex");

  const res = await fetch(`https://${cfg.host}${canonicalUri}`, {
    method: "GET",
    headers: {
      Host: cfg.host,
      "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });

  if (!res.ok) {
    throw new Error(`R2 GET failed with status ${res.status}`);
  }
  if (!res.body) {
    throw new Error("R2 GET returned empty body");
  }

  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(destPath));
  const { size } = await stat.default.stat(destPath);
  return size;
}

/**
 * Signed GET of a (small) R2 object into a Buffer. For thumbnails and
 * figure images — large PDFs should use downloadR2ObjectToFile instead.
 */
export async function downloadR2ObjectToBuffer(key: string): Promise<Buffer> {
  const cfg = r2Config();
  if (!cfg) {
    throw new Error("R2 not configured");
  }

  const { amzDate, datestamp } = amzDates();
  const credentialScope = `${datestamp}/${REGION}/s3/aws4_request`;

  const canonicalUri = canonicalObjectUri(cfg.bucket, key);
  const headers: Record<string, string> = {
    host: cfg.host,
    "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256,
    "x-amz-date": amzDate,
  };
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${headers.host}\nx-amz-content-sha256:${headers["x-amz-content-sha256"]}\nx-amz-date:${headers["x-amz-date"]}\n`;

  const canonicalRequest = [
    "GET",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    EMPTY_PAYLOAD_SHA256,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, datestamp), REGION), "s3"),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf-8").digest("hex");

  const res = await fetch(`https://${cfg.host}${canonicalUri}`, {
    method: "GET",
    headers: {
      Host: cfg.host,
      "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });

  if (!res.ok) {
    throw new Error(`R2 GET failed with status ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Upload a buffer to R2 via signed PUT (SigV4).
 * Returns the public URL on success, null on failure.
 */
export async function uploadR2Object(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string | null> {
  const cfg = r2Config();
  if (!cfg) {
    log.warn("R2 not configured — skipping upload", { key });
    return null;
  }

  const { amzDate, datestamp } = amzDates();
  const credentialScope = `${datestamp}/${REGION}/s3/aws4_request`;
  const payloadHash = createHash("sha256").update(body).digest("hex");

  const canonicalUri = canonicalObjectUri(cfg.bucket, key);
  const headers: Record<string, string> = {
    host: cfg.host,
    "content-type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `content-type:${headers["content-type"]}\nhost:${headers.host}\nx-amz-content-sha256:${headers["x-amz-content-sha256"]}\nx-amz-date:${headers["x-amz-date"]}\n`;

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, datestamp), REGION), "s3"),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf-8").digest("hex");

  try {
    const res = await fetch(`https://${cfg.host}${canonicalUri}`, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        Host: cfg.host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body,
    });

    if (res.ok) {
      const publicUrl = `${process.env.R2_PUBLIC_URL || `https://${cfg.bucket}.${cfg.host}`}/${key}`;
      log.info("R2 upload complete", { key, size: body.length });
      return publicUrl;
    } else {
      const text = await res.text();
      log.error("R2 upload failed", { key, status: res.status, body: text.substring(0, 200) });
      return null;
    }
  } catch (err) {
    log.error("R2 upload error", { key, error: (err as Error).message });
    return null;
  }
}

/**
 * List (via signed ListObjectsV2) and delete every object under `prefix`.
 * Best-effort: failures are logged, never thrown.
 */
export async function deleteR2ObjectsByPrefix(prefix: string): Promise<number> {
  const cfg = r2Config();
  if (!cfg) {
    log.warn("R2 not configured — skipping prefix deletion", { prefix });
    return 0;
  }
  try {
    let deleted = 0;
    let continuationToken: string | undefined;
    do {
      const { amzDate, datestamp } = amzDates();
      const credentialScope = `${datestamp}/${REGION}/s3/aws4_request`;
      const query: Record<string, string> = {
        "list-type": "2",
        prefix,
        "max-keys": "100",
      };
      if (continuationToken) query["continuation-token"] = continuationToken;
      query["X-Amz-Algorithm"] = "AWS4-HMAC-SHA256";
      query["X-Amz-Credential"] = `${cfg.accessKeyId}/${credentialScope}`;
      query["X-Amz-Date"] = amzDate;
      query["X-Amz-Expires"] = "60";
      query["X-Amz-SignedHeaders"] = "host";
      const canonicalQuery = Object.entries(query)
        .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
        .sort()
        .join("&");
      const canonicalUri = `/${cfg.bucket}`;
      const canonicalRequest = [
        "GET",
        canonicalUri,
        canonicalQuery,
        `host:${cfg.host}`,
        "",
        "host",
        "UNSIGNED-PAYLOAD",
      ].join("\n");
      const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
      ].join("\n");
      const signingKey = hmac(
        hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, datestamp), REGION), "s3"),
        "aws4_request"
      );
      const signature = createHmac("sha256", signingKey).update(stringToSign, "utf-8").digest("hex");
      const listRes = await fetch(
        `https://${cfg.host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
      );
      if (!listRes.ok) throw new Error(`LIST failed with ${listRes.status}`);
      const xml = await listRes.text();
      const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
      const nextToken = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
      for (const key of keys) {
        if (await deleteR2Object(key)) deleted++;
      }
      continuationToken = nextToken;
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
