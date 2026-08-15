import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { supabase } from "../config/supabase.config.js";
import { enqueueTextbookJob, getTextbookProgress } from "../services/textbook/textbook-queue.js";
import { invalidateStructureCache } from "../services/textbook/textbook-search.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("textbook-routes");
const router = Router();

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

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
      res.status(400).json({ error: "File size must be under 200MB" });
      return;
    }

    // Use content hash for dedup (frontend hashes file bytes), fallback to URL hash
    const fileHash = file_content_hash || crypto.createHash("sha256").update(file_url).digest("hex");

    // Check dedup: is there already a completed textbook with this hash?
    const { data: existing } = await supabase
      .from("textbooks")
      .select("id, status, file_name")
      .eq("file_hash", fileHash)
      .eq("status", "completed")
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Check if this user already has a link to this book
      const { data: alreadyLinked } = await supabase
        .from("textbooks")
        .select("id")
        .eq("user_id", userId)
        .eq("file_hash", fileHash)
        .limit(1)
        .maybeSingle();

      if (alreadyLinked) {
        res.json({
          textbook_id: alreadyLinked.id,
          status: "completed",
          deduplicated: true,
          message: "You already have this textbook in your library.",
        });
        return;
      }

      // Link this user to the existing processed book
      const { data: existingFull } = await supabase
        .from("textbooks")
        .select("structure_tree, total_pages")
        .eq("id", existing.id)
        .single();

      const { data: newRecord, error: insertError } = await supabase
        .from("textbooks")
        .insert({
          user_id: userId,
          course_id: course_id || null,
          file_name,
          file_url,
          file_hash: fileHash,
          file_size_bytes: file_size_bytes || 0,
          status: "completed",
          structure_tree: existingFull?.structure_tree || {},
          total_pages: existingFull?.total_pages || null,
        })
        .select("id")
        .single();

      if (insertError) {
        log.error("Failed to create dedup textbook record", { error: insertError.message });
        res.status(500).json({ error: "Failed to create textbook record" });
        return;
      }

      log.info("Textbook dedup: linked to existing", {
        newId: newRecord.id,
        existingId: existing.id,
      });

      res.json({
        textbook_id: newRecord.id,
        status: "completed",
        deduplicated: true,
        message: "This textbook was already processed. Linked to existing copy.",
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

router.get("/:id/status", async (req: Request, res: Response) => {
  try {
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
