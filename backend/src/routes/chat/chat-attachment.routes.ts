/**
 * Chat attachment upload — the streaming path for composer file attachments.
 *
 * The client uploads a file here (multipart, streamed to disk by multer, then
 * to R2) and references it in chat messages as `r2://<key>`. This replaces the
 * legacy inline-base64 flow, which forced the browser to hold ~1.5–2 GB of
 * base64 copies for a large file and crashed the tab before the request even
 * left the machine.
 *
 * Accepted types/size tiers live in services/chat/attachment-kinds.ts — video,
 * audio, documents (pdf/office/csv/md) and text/code. Every upload is verified
 * by magic bytes (never by browser mime alone), metered against a per-user
 * daily quota, and namespaced per user (`chat-attachments/{userId}/…`); every
 * consumer of an `r2://` reference re-checks that prefix against the
 * authenticated caller, so one user can never read another's upload.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import multer from "multer";
import fs from "fs/promises";
import os from "os";
import { asyncHandler } from "../../utils/express-async-wrapper.js";
import { createLogger } from "../../utils/logger.js";
import { deleteR2Object, isR2Configured, uploadR2ObjectFromFile } from "../../services/textbook/r2-client.js";
import {
  detectKind,
  KIND_SPECS,
  sniffMatches,
  type AttachmentKind,
} from "../../services/chat/attachment-kinds.js";
import {
  QuotaExceededError,
  reserveUploadBytes,
} from "../../services/chat/attachment-quota.js";
import { uploadLimiter } from "../../middleware/rate-limiters.js";

const log = createLogger("chat-attachment-routes");
const router = Router();

/** Hard ceiling across all tiers (video). */
const MAX_FILE_SIZE = KIND_SPECS.video.maxBytes;

const KEY_PREFIX = (userId: string) => `chat-attachments/${userId}/`;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (_req, _file, cb) => {
    cb(null, `chatattach_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
});

/** Multer errors get a clean status instead of falling through as 500s. */
function handleMulterError(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(status).json({ error: err.code === "LIMIT_FILE_SIZE"
      ? `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`
      : err.message });
    return;
  }
  next(err);
}

/** First 16 bytes of a temp file, for magic-byte checks. */
async function readHead(filePath: string): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buf, 0, 16, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

router.post(
  "/attachments",
  uploadLimiter,
  upload.single("file"),
  handleMulterError,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!isR2Configured()) {
      res.status(503).json({ error: "File storage is not configured" });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    let quotaRelease: (() => Promise<void>) | null = null;

    /** Respond with an error and refund any reserved quota. */
    const failWith = async (status: number, error: string, extra?: Record<string, unknown>) => {
      if (quotaRelease) {
        await quotaRelease();
        quotaRelease = null;
      }
      res.status(status).json({ error, ...extra });
    };

    try {
      const fileName = file.originalname.substring(0, 200);
      const kind = detectKind(file.mimetype, fileName);
      if (!kind) {
        res.status(415).json({ error: "Unsupported file type" });
        return;
      }

      const spec = KIND_SPECS[kind];
      if (file.size > spec.maxBytes) {
        res.status(413).json({
          error: `File too large for ${kind} uploads. Maximum size is ${Math.round(spec.maxBytes / (1024 * 1024))}MB.`,
        });
        return;
      }

      // Never trust the browser's mime — verify the actual bytes.
      const head = await readHead(file.path);
      if (!sniffMatches(kind, head)) {
        res.status(400).json({ error: `File content does not look like a valid ${kind}` });
        return;
      }

      // Daily quota — reserve first; refunded on any failure below via failWith.
      let reservation: Awaited<ReturnType<typeof reserveUploadBytes>> | null = null;
      try {
        reservation = await reserveUploadBytes(userId, file.size);
        quotaRelease = () => reservation!.release();
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          res.status(429).json({ error: err.message, remainingBytes: err.remainingBytes });
          return;
        }
        throw err;
      }

      // Sanitized extension — alnum only, never trust the client name.
      const rawExt = fileName.includes(".") ? fileName.split(".").pop()! : "";
      const safeExt = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
      const r2Key = `${KEY_PREFIX(userId)}${crypto.randomUUID()}${safeExt ? "." + safeExt : ""}`;
      const uploaded = await uploadR2ObjectFromFile(r2Key, file.path, file.mimetype || "application/octet-stream", file.size);
      if (!uploaded) {
        log.warn("Chat attachment R2 upload failed", { userId, size: file.size });
        await failWith(502, "Failed to store the file — please try again");
        return;
      }

      log.info("Chat attachment uploaded", { userId, r2Key, kind, size: file.size });
      quotaRelease = null; // consumed on success
      res.status(201).json({
        r2Key,
        fileName,
        mimeType: file.mimetype || "application/octet-stream",
        kind: kind satisfies AttachmentKind,
        sizeBytes: file.size,
      });
    } finally {
      await fs.unlink(file.path).catch(() => {});
    }
  }),
);

router.delete(
  "/attachments",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Key arrives via query string so slashes don't need route escaping.
    const key = typeof req.query.key === "string" ? req.query.key : "";
    if (!key.startsWith(KEY_PREFIX(userId))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const deleted = await deleteR2Object(key);
    if (!deleted) {
      res.status(502).json({ error: "Failed to delete the file" });
      return;
    }
    res.json({ deleted: true });
  }),
);

export default router;
