import crypto from "crypto";
import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";
import { uploadR2Object, downloadR2ObjectToFile } from "./r2-client.js";
import { PermanentJobError, TransientJobError } from "./errors.js";
import type { TextbookJobResult } from "./textbook-queue.js";

const log = createLogger("textbook-processor");

const PDF_PROCESSOR_URL = process.env.PDF_PROCESSOR_URL || "http://localhost:8000";
const ALLOWED_URL_HOSTS = new Set([
  "supabase.co",
  "r2.dev",
]);
const ALLOWED_URL_PORTS = new Set([443, 80]);

function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PermanentJobError(`Invalid file URL: ${url.substring(0, 60)}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new PermanentJobError("Only HTTP(S) URLs are allowed");
  }
  const host = parsed.hostname;
  const isAllowed = [...ALLOWED_URL_HOSTS].some(
    (h) => host === h || host.endsWith("." + h)
  );
  if (!isAllowed) {
    throw new PermanentJobError(`URL host not allowed: ${host}`);
  }
  const port = parsed.port ? parseInt(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
  if (!ALLOWED_URL_PORTS.has(port)) {
    throw new PermanentJobError(`URL port not allowed: ${port}`);
  }
  if (parsed.pathname.includes("..") || parsed.pathname.includes("~")) {
    throw new PermanentJobError("URL path contains invalid characters");
  }
}

/**
 * Resolve the job's fileUrl into a local path the Python processor can read.
 * Returns the local path plus whether the worker should delete it afterwards.
 *
 * Supported sources:
 *  - `r2://<key>`     — the permanent copy in Cloudflare R2 (production flow)
 *  - `local://<path>` — multer tmp file kept for local dev without R2; never
 *                       deleted here, otherwise reprocessing becomes impossible
 *  - `https://...`    — legacy records pointing at Supabase Storage / R2 URLs
 */
async function resolveSourceFile(
  fileUrl: string,
  userId: string
): Promise<{ tmpPath: string; needsCleanup: boolean }> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const os = await import("os");

  const randomName = crypto.randomBytes(16).toString("hex");

  if (fileUrl.startsWith("r2://")) {
    const key = fileUrl.replace("r2://", "");
    const tmpPath = path.join(os.tmpdir(), `textbook_${randomName}.pdf`);
    try {
      const size = await downloadR2ObjectToFile(key, tmpPath);
      if (size === 0) throw new PermanentJobError("Stored PDF is empty — please re-upload the book", "Stored PDF is empty — please re-upload the book");
      return { tmpPath, needsCleanup: true };
    } catch (err) {
      if (err instanceof PermanentJobError) throw err;
      // 404 manifests as a generic GET failure — anything else (network,
      // 5xx) is worth retrying
      throw new TransientJobError(`Failed to fetch PDF from storage: ${(err as Error).message}`);
    }
  }

  if (fileUrl.startsWith("local://")) {
    const tmpPath = fileUrl.replace("local://", "");
    try {
      await fs.access(tmpPath);
    } catch {
      throw new PermanentJobError(
        `Local source file missing: ${tmpPath}`,
        "The uploaded file is no longer available on the server. Please upload the book again."
      );
    }
    return { tmpPath, needsCleanup: false };
  }

  // Legacy remote URL flow
  validateUrl(fileUrl);
  const downloadController = new AbortController();
  const downloadTimeout = setTimeout(() => downloadController.abort(), 120_000);
  let pdfResponse: Response;
  try {
    pdfResponse = await fetch(fileUrl, { signal: downloadController.signal });
  } catch (err) {
    throw new TransientJobError(`Failed to download PDF: ${(err as Error).message}`);
  } finally {
    clearTimeout(downloadTimeout);
  }
  if (!pdfResponse.ok) {
    const msg = `Failed to download PDF: ${pdfResponse.status}`;
    if (pdfResponse.status >= 400 && pdfResponse.status < 500) throw new PermanentJobError(msg);
    throw new TransientJobError(msg);
  }
  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `textbook_${randomName}.pdf`);
  await fs.writeFile(tmpPath, pdfBuffer);
  return { tmpPath, needsCleanup: true };
}

interface CurriculumNodeData {
  level: string;
  title: string;
  page_start: number;
  page_end: number;
  order_index: number;
  children?: CurriculumNodeData[];
}

/** Recursively persist the section tree, linking children to parent ids. */
async function insertSectionTree(
  textbookId: string,
  nodes: CurriculumNodeData[],
  parentId: string | null
): Promise<void> {
  for (const node of nodes) {
    const { data: row, error } = await supabase
      .from("textbook_sections")
      .insert({
        textbook_id: textbookId,
        parent_id: parentId,
        level: node.level,
        title: node.title,
        page_start: node.page_start,
        page_end: node.page_end,
        order_index: node.order_index ?? 0,
      })
      .select("id")
      .single();

    if (error || !row) {
      log.warn("Failed to insert section", { title: node.title, error: error?.message });
      continue;
    }
    if (node.children && node.children.length > 0) {
      await insertSectionTree(textbookId, node.children, row.id);
    }
  }
}

export async function processTextbookJob(jobData: {
  textbookId: string;
  fileUrl: string;
  userId: string;
}): Promise<TextbookJobResult> {  const { textbookId, fileUrl, userId } = jobData;

  // Update status to processing. Errors from here on are thrown to the
  // worker, which owns retry/failure handling — no silent swallowing.
  await supabase
    .from("textbooks")
    .update({
      status: "processing",
      processing_started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", textbookId);

  const fs = await import("fs/promises");

  const { tmpPath, needsCleanup } = await resolveSourceFile(fileUrl, userId);

  try {
    // Call Python microservice. Progress reporting during extraction is
    // written straight to Redis by the Python service (stage "scanning").
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.PDF_PROCESSOR_TOKEN) {
      headers["Authorization"] = `Bearer ${process.env.PDF_PROCESSOR_TOKEN}`;
    }

    let processResponse: Response;
    try {
      processResponse = await fetch(`${PDF_PROCESSOR_URL}/process`, {
        method: "POST",
        headers,
        body: JSON.stringify({ pdf_path: tmpPath, user_id: userId, textbook_id: textbookId }),
        signal: AbortSignal.timeout(600_000),
      });
    } catch (err) {
      throw new TransientJobError(`PDF processor unreachable: ${(err as Error).message}`);
    }

    if (!processResponse.ok) {
      const errText = (await processResponse.text()).substring(0, 300);
      if (processResponse.status >= 400 && processResponse.status < 500) {
        // Python validated the request and rejected it: bad PDF, page limit,
        // path policy — retrying cannot change the outcome
        throw new PermanentJobError(
          `PDF processor rejected the file (${processResponse.status}): ${errText}`,
          "This PDF could not be processed. It may be corrupt, encrypted, or exceed the 2000-page limit."
        );
      }
      throw new TransientJobError(`PDF processor error (${processResponse.status}): ${errText}`);
    }

    const result = (await processResponse.json()) as {
  page_models: Array<{ page_number: number; width: number; height: number; background_color: string; page_role: string; page_type: string; dominant_script: string; approximate_columns: number; thumbnail_key?: string }>;
  questions?: Array<{ question_type?: string; number?: number; text: string; page_number?: number; section_path?: string }>;
  glossary?: Array<{ term: string; definition: string }>;
  structure?: unknown;
};

    // Write figures to storage (images may already be uploaded by Python)
    const figureUrls: Array<{
      figure_id: string;
      page_number: number;
      caption: string;
      image_url: string;
      bounding_box: Record<string, number>;
      dominant_colors: string[] | null;
      is_colored: boolean | null;
    }> = [];

    // color metadata for figures lives in the page models (image summaries)
    const imageMetaByFig = new Map<string, { colors: string[]; colored: boolean }>();
    for (const pm of result.page_models || []) {
      for (const img of pm.images || []) {
        imageMetaByFig.set(`fig_${pm.page_number}_${img.index}`, {
          colors: img.dominant_colors || [],
          colored: img.is_colored,
        });
      }
    }

    if (result.figures && Array.isArray(result.figures)) {
      for (const fig of result.figures) {
        let imageUrl = fig.image_url || "";

        // If Python didn't upload, upload from base64 to R2
        if (!imageUrl && fig.image_base64) {
          const imgBuffer = Buffer.from(fig.image_base64, "base64");
          const r2Key = `textbooks/${userId}/${textbookId}/${fig.figure_id}.png`;

          const uploadedUrl = await uploadR2Object(r2Key, imgBuffer, "image/png");
          if (!uploadedUrl) {
            log.warn("Failed to upload figure to R2", { figureId: fig.figure_id });
            continue;
          }
          imageUrl = uploadedUrl;
        }

          const meta = imageMetaByFig.get(fig.figure_id);
          figureUrls.push({
            figure_id: fig.figure_id,
            page_number: fig.page_number,
            caption: fig.caption,
            image_url: imageUrl,
            bounding_box: fig.bounding_box,
            dominant_colors: meta?.colors?.length ? meta.colors : null,
            is_colored: meta ? meta.colored : null,
          });
      }
    }

    // ── DB writes (delete → insert per table, idempotent on retry) ───────
    // Each table is cleared before re-inserting so retries are safe.
    // Errors are tracked and the worst one is thrown so the worker requeues.
    let firstCriticalError: string | null = null;

    // 1. Figures
    if (figureUrls.length > 0) {
      const figureRows = figureUrls.map((f) => ({
        textbook_id: textbookId,
        figure_id: f.figure_id,
        page_number: f.page_number,
        caption: f.caption,
        image_url: f.image_url,
        bounding_box: f.bounding_box,
        dominant_colors: f.dominant_colors,
        is_colored: f.is_colored,
      }));
      await supabase.from("textbook_figures").delete().eq("textbook_id", textbookId);
      const { error: figError } = await supabase.from("textbook_figures").insert(figureRows);
      if (figError) {
        log.warn("Failed to insert figure records", { error: figError.message });
        firstCriticalError ??= `figures: ${figError.message}`;
      }
    }

    // 2. Structure tree + book language (UPDATE, not replace)
    const { error: treeError } = await supabase
      .from("textbooks")
      .update({
        structure_tree: result.structure_tree,
        total_pages: result.total_pages,
        book_language: result.book_language || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", textbookId);
    if (treeError) {
      log.error("Failed to update textbook structure_tree", { error: treeError.message });
      firstCriticalError ??= `structure: ${treeError.message}`;
    }

    // 3. Pages (layout digital twin)
    if (Array.isArray(result.page_models) && result.page_models.length > 0) {
      const pageRows = result.page_models.map((pm) => ({
        textbook_id: textbookId,
        page_number: pm.page_number,
        width: pm.width,
        height: pm.height,
        background_color: pm.background_color,
        page_role: pm.page_role,
        page_type: pm.page_type,
        dominant_script: pm.dominant_script,
        approximate_columns: pm.approximate_columns,
        thumbnail_key: pm.thumbnail_key || null,
        layout: pm,
      }));

      await supabase.from("textbook_pages").delete().eq("textbook_id", textbookId);
      // Batch insert in groups of 50 (Supabase single-request body limit)
      for (let i = 0; i < pageRows.length; i += 50) {
        const { error: pagesError } = await supabase
          .from("textbook_pages")
          .insert(pageRows.slice(i, i + 50));
        if (pagesError) {
          log.warn("Failed to insert page models batch", { batch: i, error: pagesError.message });
          firstCriticalError ??= `pages: ${pagesError.message}`;
        }
      }
    }

    // 4. Chunks — link figures from the same page into figure_refs
    const figuresByPage = new Map<number, string[]>();
    for (const f of figureUrls) {
      const list = figuresByPage.get(f.page_number) || [];
      list.push(f.figure_id);
      figuresByPage.set(f.page_number, list);
    }

    const chunkData = (result.chunks || []).map(
      (c: {
        page_number: number;
        structure_path: string;
        content: string;
        block_role?: string;
        text_color?: string;
        bbox?: Record<string, number>;
      }) => ({
        textbook_id: textbookId,
        page_number: c.page_number,
        structure_path: c.structure_path,
        content: c.content,
        block_role: c.block_role || null,
        text_color: c.text_color || null,
        chunk_bbox: c.bbox || null,
        figure_refs: figuresByPage.get(c.page_number) || [],
      })
    );

    let insertedChunks = 0;
    if (chunkData.length > 0) {
      await supabase.from("textbook_chunks").delete().eq("textbook_id", textbookId);
      for (let i = 0; i < chunkData.length; i += 100) {
        const batch = chunkData.slice(i, i + 100);
        const { error: chunkError } = await supabase.from("textbook_chunks").insert(batch);
        if (chunkError) {
          log.warn("Failed to insert chunk batch", { batch: i, error: chunkError.message });
          firstCriticalError ??= `chunks: ${chunkError.message}`;
        } else {
          insertedChunks += batch.length;
        }
      }
    }

    if (chunkData.length > 0 && insertedChunks === 0) {
      throw new TransientJobError("All chunk inserts failed — database write error");
    }

    // 5. Curriculum map (units → lessons → topics, questions, glossary)
    const curriculum = result.curriculum;
    if (curriculum) {
      await supabase.from("textbook_sections").delete().eq("textbook_id", textbookId);
      await supabase.from("textbook_questions").delete().eq("textbook_id", textbookId);
      await supabase.from("textbook_glossary").delete().eq("textbook_id", textbookId);

      await insertSectionTree(textbookId, curriculum.root?.children || [], null);

      if (curriculum.questions?.length) {
        const qRows = curriculum.questions.slice(0, 1000).map((q) => ({
          textbook_id: textbookId,
          question_type: q.question_type || "lesson_questions",
          number: q.number || null,
          text: q.text,
          page_number: q.page_number ?? null,
          section_path: q.section_path || null,
        }));
        for (let i = 0; i < qRows.length; i += 100) {
          const { error: qErr } = await supabase
            .from("textbook_questions")
            .insert(qRows.slice(i, i + 100));
          if (qErr) log.warn("Failed to insert questions batch", { error: qErr.message });
        }
      }

      if (curriculum.glossary?.length) {
        const gRows = curriculum.glossary.slice(0, 2000).map((g) => ({
          textbook_id: textbookId,
          term: g.term,
          definition: g.definition || null,
          page_number: g.page_number ?? null,
        }));
        for (let i = 0; i < gRows.length; i += 100) {
          const { error: gErr } = await supabase
            .from("textbook_glossary")
            .insert(gRows.slice(i, i + 100));
          if (gErr) log.warn("Failed to insert glossary batch", { error: gErr.message });
        }
      }
      log.info("Curriculum saved", {
        textbookId,
        units: (curriculum.root?.children || []).length,
        questions: curriculum.questions?.length || 0,
        glossary: curriculum.glossary?.length || 0,
      });
    }

    // Abort on critical write failure so the worker retries the whole job
    if (firstCriticalError) {
      throw new TransientJobError(`Database write failed: ${firstCriticalError}`);
    }

    // Don't mark as completed here — worker will do it after embedding
    return {
      textbookId,
      status: "completed",
      structureTree: result.structure_tree,
      figures: figureUrls,
      chunks: result.chunks || [],
      totalPages: result.total_pages,
    };
  } finally {
    if (needsCleanup) {
      // Only clean up files we created (downloads). The multer upload for the
      // local:// dev flow is intentionally preserved for reprocessing.
      await fs.unlink(tmpPath).catch((err) => {
        log.warn("Failed to delete temp file", { path: tmpPath, error: err.message });
      });
    }
  }
}
