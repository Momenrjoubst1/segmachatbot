import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import multer from "multer";
import fs from "fs/promises";
import { createReadStream } from "fs";
import os from "os";
import { supabase } from "../config/supabase.config.js";
import { enqueueTextbookJob, getTextbookProgress, getRedisClient } from "../services/textbook/textbook-queue.js";
import { invalidateStructureCache } from "../services/textbook/textbook-search.js";
import { deleteR2ObjectsByPrefix, isR2Configured, uploadR2ObjectFromFile } from "../services/textbook/r2-client.js";
import { invalidateUserTextbookSignal } from "../services/chat/pipeline/rag-retrieval.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("textbook-routes");
const router = Router();

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

// Multer config: store in uploads/{userId}/
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `textbook_${Date.now()}_${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      cb(new Error("Only PDF files are supported"));
      return;
    }
    cb(null, true);
  },
});

/** Stream a file through SHA-256 without buffering it all in memory. */
async function hashFileStreaming(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

// ─── Direct file upload (bypasses Supabase Storage) ─────────────────────
router.post("/upload-file", upload.single("file"), async (req: Request, res: Response) => {
  let tmpPath: string | null = null;
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const file = req.file;
    tmpPath = file.path;
    let courseId = req.body.course_id || null;

    // Auto-create a course if none was provided (sidebar upload without selecting a course)
    if (!courseId) {
      const courseName = file.originalname.replace(/\.pdf$/i, "").substring(0, 80) || "مادة جديدة";
      const { data: newCourse } = await supabase
        .from("student_courses")
        .insert({ user_id: userId, course_name: courseName, credit_hours: 0 })
        .select("id")
        .single();
      courseId = newCourse?.id || null;
      if (courseId) {
        log.info("Auto-created course for uploaded textbook", { courseId, courseName });
      }
    }

    // Compute file hash (streamed — a 500MB upload must not be buffered)
    const fileHash = await hashFileStreaming(file.path);

    // Dedup is strictly user-scoped. A cross-user match must NOT create a
    // "completed" record without chunks — the search RPCs are user-scoped
    // (migration 013), so such a book could never actually be searched.
    const { data: existing } = await supabase
      .from("textbooks")
      .select("id, status")
      .eq("user_id", userId)
      .eq("file_hash", fileHash)
      .in("status", ["completed", "pending", "processing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      await fs.unlink(file.path).catch(() => {});
      tmpPath = null;
      res.json({
        textbook_id: existing.id,
        status: existing.status,
        deduplicated: true,
        message:
          existing.status === "completed"
            ? "You already have this textbook in your library."
            : "This textbook is already being processed.",
      });
      return;
    }

    // New book: create record first (we need its id for the storage key)
    const { data: textbook, error: insertError } = await supabase
      .from("textbooks")
      .insert({
        user_id: userId,
        course_id: courseId,
        file_name: file.originalname,
        // Placeholder until the PDF is persisted; updated right after
        file_url: `pending://${Date.now()}`,
        file_hash: fileHash,
        file_size_bytes: file.size,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError) {
      log.error("Failed to create textbook record", { error: insertError.message });
      await fs.unlink(file.path).catch(() => {});
      tmpPath = null;
      res.status(500).json({ error: "Failed to create textbook record" });
      return;
    }

    // Persist the source PDF permanently:
    // - R2 configured: `r2://<key>` — survives restarts, enables reprocessing
    //   and on-demand page rendering, works across containers.
    // - R2 not configured (local dev): keep the multer tmp file and point at
    //   it; the processor is told not to delete it so reprocess still works.
    let fileUrl: string;
    if (isR2Configured()) {
      const r2Key = `textbooks/${userId}/${textbook.id}/source.pdf`;
      const uploaded = await uploadR2ObjectFromFile(
        r2Key,
        file.path,
        "application/pdf",
        file.size,
        fileHash // real payload SHA-256 — already computed for dedup
      );
      if (!uploaded) {
        // Storage failure: remove the record so the user can retry cleanly
        await supabase.from("textbooks").delete().eq("id", textbook.id);
        await fs.unlink(file.path).catch(() => {});
        tmpPath = null;
        log.error("Failed to persist PDF to storage", { textbookId: textbook.id });
        res.status(503).json({ error: "File storage is temporarily unavailable. Please try again." });
        return;
      }
      fileUrl = `r2://${r2Key}`;
      await fs.unlink(file.path).catch(() => {});
      tmpPath = null;
    } else {
      fileUrl = `local://${file.path}`;
      tmpPath = null; // kept on purpose — processor must preserve it
    }

    const { error: urlError } = await supabase
      .from("textbooks")
      .update({ file_url: fileUrl, updated_at: new Date().toISOString() })
      .eq("id", textbook.id);

    if (urlError) {
      log.error("Failed to set file_url", { textbookId: textbook.id, error: urlError.message });
    }

    await enqueueTextbookJob({
      textbookId: textbook.id,
      fileUrl,
      userId,
      fileHash,
    });

    invalidateStructureCache(userId);
    invalidateUserTextbookSignal(userId);

    log.info("Textbook file uploaded", {
      textbookId: textbook.id,
      fileName: file.originalname,
      fileSize: file.size,
      storage: fileUrl.startsWith("r2://") ? "r2" : "local",
    });

    res.json({
      textbook_id: textbook.id,
      status: "pending",
      deduplicated: false,
    });
  } catch (err) {
    if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
    log.error("Upload-file route error", { error: (err as Error).message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── URL-based upload (original flow via Supabase Storage) ───────────────
router.post("/upload", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { file_name, file_url, file_size_bytes, file_content_hash, course_id } = req.body;
    if (!file_name || !file_url) {
      res.status(400).json({ error: "file_name and file_url are required" });
      return;
    }

    // Validate file type
    if (!file_name.toLowerCase().endsWith(".pdf")) {
      res.status(400).json({ error: "Only PDF files are supported" });
      return;
    }

    // Validate file size
    if (file_size_bytes && file_size_bytes > MAX_FILE_SIZE) {
      res.status(400).json({ error: "File size must be under 500MB" });
      return;
    }

    // Use content hash for dedup (frontend hashes file bytes), fallback to URL hash
    const fileHash = file_content_hash || crypto.createHash("sha256").update(file_url).digest("hex");

    // Check dedup: is there already a completed textbook with this hash
    // OWNED BY THIS USER? Dedup must be user-scoped: file hashes are
    // client-supplied, so a cross-user match would leak another user's
    // structure_tree/total_pages to whoever guesses or knows the hash.
    const { data: existing } = await supabase
      .from("textbooks")
      .select("id, status, file_name")
      .eq("file_hash", fileHash)
      .eq("user_id", userId)
      .eq("status", "completed")
      .limit(1)
      .maybeSingle();

    if (existing) {
      res.json({
        textbook_id: existing.id,
        status: "completed",
        deduplicated: true,
        message: "You already have this textbook in your library.",
      });
      return;
    }

    // New book: create record and enqueue
    const { data: textbook, error: insertError } = await supabase
      .from("textbooks")
      .insert({
        user_id: userId,
        course_id: course_id || null,
        file_name,
        file_url,
        file_hash: fileHash,
        file_size_bytes: file_size_bytes || 0,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError) {
      log.error("Failed to create textbook record", { error: insertError.message });
      res.status(500).json({ error: "Failed to create textbook record" });
      return;
    }

    await enqueueTextbookJob({
      textbookId: textbook.id,
      fileUrl: file_url,
      userId,
      fileHash,
    });

    invalidateStructureCache(userId);

    res.json({
      textbook_id: textbook.id,
      status: "pending",
      deduplicated: false,
    });
  } catch (err) {
    log.error("Upload route error", { error: (err as Error).message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Curriculum map (units → lessons → topics + questions + glossary) ────
router.get("/:id/curriculum", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { id } = req.params;

    const { data: textbook } = await supabase
      .from("textbooks")
      .select("id, file_name, status, book_language")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!textbook) {
      res.status(404).json({ error: "Textbook not found" });
      return;
    }

    const [{ data: sections }, { count: questionCount }] = await Promise.all([
      supabase
        .from("textbook_sections")
        .select("id, parent_id, level, title, page_start, page_end, order_index")
        .eq("textbook_id", id)
        .order("order_index"),
      supabase
        .from("textbook_questions")
        .select("id", { count: "exact", head: true })
        .eq("textbook_id", id),
    ]);

    // rebuild the tree from flat rows
    const byId = new Map<string, { id: string; title: string; children: unknown[] }>();
    const roots: { id: string; title: string; children: unknown[] }[] = [];
    for (const s of sections || []) {
      byId.set(s.id, { ...s, children: [] });
    }
    for (const s of sections || []) {
      const node = byId.get(s.id);
      if (s.parent_id && byId.has(s.parent_id)) {
        byId.get(s.parent_id).children.push(node);
      } else {
        roots.push(node);
      }
    }

    res.json({
      textbook_id: id,
      file_name: textbook.file_name,
      book_language: textbook.book_language,
      sections: roots,
      counts: {
        sections: sections?.length || 0,
        questions: questionCount ?? 0,
      },
    });
  } catch (err) {
    log.error("Curriculum route error", { error: (err as Error).message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Questions of a book (quiz-ready) ─────────────────────────────────────
router.get("/:id/questions", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const type = req.query.type as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const { data: textbook } = await supabase
      .from("textbooks")
      .select("id")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!textbook) {
      res.status(404).json({ error: "Textbook not found" });
      return;
    }

    let query = supabase
      .from("textbook_questions")
      .select("id, question_type, number, text, page_number, section_path")
      .eq("textbook_id", id)
      .limit(limit);
    if (type === "lesson_questions" || type === "unit_questions") {
      query = query.eq("question_type", type);
    }

    const { data: questions, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ questions: questions || [] });
  } catch (err) {
    log.error("Questions route error", { error: (err as Error).message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Glossary of a book ───────────────────────────────────────────────────
router.get("/:id/glossary", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { id } = req.params;

    const { data: textbook } = await supabase
      .from("textbooks")
      .select("id")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!textbook) {
      res.status(404).json({ error: "Textbook not found" });
      return;
    }

    const { data: glossary, error } = await supabase
      .from("textbook_glossary")
      .select("id, term, definition, page_number")
      .eq("textbook_id", id)
      .order("page_number")
      .limit(500);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ glossary: glossary || [] });
  } catch (err) {
    log.error("Glossary route error", { error: (err as Error).message });
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/status", async (req: Request, res: Response) => {  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { id } = req.params;

    const { data: textbook, error } = await supabase
      .from("textbooks")
      .select("id, status, progress, error, total_pages, structure_tree, created_at, updated_at")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !textbook) {
      res.status(404).json({ error: "Textbook not found" });
      return;
    }

    const redisProgress = await getTextbookProgress(id);

    res.json({
      textbook_id: textbook.id,
      status: textbook.status,
      progress: redisProgress || textbook.progress,
      error: textbook.error,
      total_pages: textbook.total_pages,
      has_structure_tree: !!textbook.structure_tree && Object.keys(textbook.structure_tree).length > 0,
      created_at: textbook.created_at,
      updated_at: textbook.updated_at,
    });
  } catch (err) {
    log.error("Status route error", { error: (err as Error).message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── SSE: real-time progress stream (replaces polling) ───────────────────
router.get("/:id/progress", async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { id } = req.params;

  // Verify ownership
  const { data: textbook } = await supabase
    .from("textbooks")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!textbook) {
    res.status(404).json({ error: "Textbook not found" });
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send current state immediately
  const current = await getTextbookProgress(id);
  if (current) {
    res.write(`data: ${JSON.stringify(current)}\n\n`);
    // If already completed/failed, close immediately
    if (current.stage === "completed" || current.stage === "failed") {
      res.end();
      return;
    }
  }

  // Subscribe to Redis Pub/Sub for live updates
  const redis = getRedisClient();
  const subscriber = redis.duplicate();
  const channel = `textbook:progress:${id}`;

  await subscriber.subscribe(channel);

  subscriber.on("message", (_ch: string, message: string) => {
    res.write(`data: ${message}\n\n`);
  });

  // Heartbeat to keep connection alive (every 15s)
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 15_000);

  // Cleanup on client disconnect
  req.on("close", async () => {
    clearInterval(heartbeat);
    await subscriber.unsubscribe(channel);
    subscriber.disconnect();
  });
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const { data: textbooks, error } = await supabase
      .from("textbooks")
      .select("id, file_name, file_url, status, total_pages, course_id, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ textbooks: textbooks || [] });
  } catch (err) {
    log.error("List route error", { error: (err as Error).message });
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/reprocess", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const isDev = process.env.NODE_ENV === "development";

    const { id } = req.params;
    
    const { data: textbook } = await supabase.from("textbooks").select("id, file_url, file_hash, user_id").eq("id", id).maybeSingle();

    if (!textbook) { res.status(404).json({ error: "Textbook not found" }); return; }
    if (!isDev && textbook.user_id !== userId) { res.status(404).json({ error: "Textbook not found" }); return; }

    // Reset status
    await supabase
      .from("textbooks")
      .update({ status: "pending", error: null, updated_at: new Date().toISOString() })
      .eq("id", id);

    // Delete old chunks, figures, page models, and curriculum rows
    await supabase.from("textbook_chunks").delete().eq("textbook_id", id);
    await supabase.from("textbook_figures").delete().eq("textbook_id", id);
    await supabase.from("textbook_pages").delete().eq("textbook_id", id);
    await supabase.from("textbook_glossary").delete().eq("textbook_id", id);
    await supabase.from("textbook_questions").delete().eq("textbook_id", id);
    await supabase.from("textbook_sections").delete().eq("textbook_id", id);

    // Re-enqueue
    await enqueueTextbookJob({
      textbookId: id,
      fileUrl: textbook.file_url,
      userId: userId || textbook.user_id || "dev",
      fileHash: textbook.file_hash || "",
    });

    log.info("Textbook requeued for processing", { textbookId: id });
    res.json({ textbook_id: id, status: "pending" });
  } catch (err) {
    log.error("Reprocess route error", { error: (err as Error).message });
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { id } = req.params;

    // First, get the textbook to find storage paths
    const { data: textbook } = await supabase
      .from("textbooks")
      .select("id, file_url")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!textbook) {
      res.status(404).json({ error: "Textbook not found" });
      return;
    }

    // Delete figures from storage
    const { data: figures } = await supabase
      .from("textbook_figures")
      .select("image_url")
      .eq("textbook_id", id);

    if (figures && figures.length > 0) {
      const imagePaths = figures
        .map((f) => {
          const url = f.image_url;
          const match = url.match(/textbook-images\/(.+)$/);
          return match ? match[1] : null;
        })
        .filter(Boolean);

      if (imagePaths.length > 0) {
        await supabase.storage.from("textbook-images").remove(imagePaths);
      }
    }

    // Mirror deletion on Cloudflare R2 — figure objects live under a
    // per-user/per-textbook prefix and would otherwise remain publicly
    // fetchable forever after the textbook is deleted.
    await deleteR2ObjectsByPrefix(`textbooks/${userId}/${id}/`);

    // Chat-originated materials keep their source PDF under pending/ —
    // delete that copy too or it becomes an orphan.
    if (textbook.file_url?.startsWith("r2://pending/")) {
      await deleteR2ObjectsByPrefix(textbook.file_url.replace("r2://", ""));
    }

    // Delete the DB record (cascades to chunks, figures via FK)
    const { error } = await supabase
      .from("textbooks")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    invalidateStructureCache(userId);

    res.json({ deleted: true });
  } catch (err) {
    log.error("Delete route error", { error: (err as Error).message });
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
