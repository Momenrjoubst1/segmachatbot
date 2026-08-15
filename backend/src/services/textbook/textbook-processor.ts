import crypto from "crypto";
import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";
import type { TextbookJobResult } from "./textbook-queue.js";

const log = createLogger("textbook-processor");

const PDF_PROCESSOR_URL = process.env.PDF_PROCESSOR_URL || "http://localhost:8000";
const ALLOWED_URL_HOSTS = new Set([
  "supabase.co",
]);
const ALLOWED_URL_PORTS = new Set([443, 80]);

function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid file URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only HTTP(S) URLs are allowed");
  }
  const host = parsed.hostname;
  const isAllowed = [...ALLOWED_URL_HOSTS].some(
    (h) => host === h || host.endsWith("." + h)
  );
  if (!isAllowed) {
    throw new Error(`URL host not allowed: ${host}`);
  }
  const port = parsed.port ? parseInt(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
  if (!ALLOWED_URL_PORTS.has(port)) {
    throw new Error(`URL port not allowed: ${port}`);
  }
  if (parsed.pathname.includes("..") || parsed.pathname.includes("~")) {
    throw new Error("URL path contains invalid characters");
  }
}

export async function processTextbookJob(jobData: {
  textbookId: string;
  fileUrl: string;
  userId: string;
}): Promise<TextbookJobResult> {
  const { textbookId, fileUrl, userId } = jobData;

  try {
    validateUrl(fileUrl);

    // Update status to processing
    await supabase
      .from("textbooks")
      .update({
        status: "processing",
        processing_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", textbookId);

    // Download PDF to temp file with timeout (60s)
    const downloadController = new AbortController();
    const downloadTimeout = setTimeout(() => downloadController.abort(), 60_000);
    let pdfResponse: Response;
    try {
      pdfResponse = await fetch(fileUrl, { signal: downloadController.signal });
    } finally {
      clearTimeout(downloadTimeout);
    }
    if (!pdfResponse.ok) {
      throw new Error(`Failed to download PDF: ${pdfResponse.status}`);
    }
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

    const fs = await import("fs/promises");
    const path = await import("path");
    const os = await import("os");
    const tmpDir = os.tmpdir();
    const randomName = crypto.randomBytes(16).toString("hex");
    const tmpPath = path.join(tmpDir, `textbook_${randomName}.pdf`);
    await fs.writeFile(tmpPath, pdfBuffer);

    try {
      // Call Python microservice
      const processResponse = await fetch(`${PDF_PROCESSOR_URL}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf_path: tmpPath, user_id: userId, textbook_id: textbookId }),
        signal: AbortSignal.timeout(300_000),
      });

      if (!processResponse.ok) {
        const errText = await processResponse.text();
        throw new Error(`Python processor error: ${processResponse.status} - ${errText}`);
      }

      const result = await processResponse.json();

      // Write figures to storage (images may already be uploaded by Python)
      const figureUrls: Array<{
        figure_id: string;
        page_number: number;
        caption: string;
        image_url: string;
        bounding_box: Record<string, number>;
      }> = [];

      if (result.figures && Array.isArray(result.figures)) {
        for (const fig of result.figures) {
          let imageUrl = fig.image_url || "";

          // If Python didn't upload, upload from base64
          if (!imageUrl && fig.image_base64) {
            const imgBuffer = Buffer.from(fig.image_base64, "base64");
            const imgPath = `textbooks/${userId}/${textbookId}/${fig.figure_id}.png`;

            const { error: uploadError } = await supabase.storage
              .from("textbook-images")
              .upload(imgPath, imgBuffer, {
                contentType: "image/png",
                upsert: true,
              });

            if (uploadError) {
              log.warn("Failed to upload figure image", { figureId: fig.figure_id, error: uploadError.message });
              continue;
            }

            const { data: urlData } = supabase.storage
              .from("textbook-images")
              .getPublicUrl(imgPath);

            imageUrl = urlData.publicUrl;
          }

          figureUrls.push({
            figure_id: fig.figure_id,
            page_number: fig.page_number,
            caption: fig.caption,
            image_url: imageUrl,
            bounding_box: fig.bounding_box,
          });
        }
      }

      // Insert figures into DB with error handling
      if (figureUrls.length > 0) {
        const figureRows = figureUrls.map((f) => ({
          textbook_id: textbookId,
          figure_id: f.figure_id,
          page_number: f.page_number,
          caption: f.caption,
          image_url: f.image_url,
          bounding_box: f.bounding_box,
        }));
        const { error: figError } = await supabase.from("textbook_figures").insert(figureRows);
        if (figError) {
          log.warn("Failed to insert figure records", { error: figError.message });
        }
      }

      // Write structure_tree
      const { error: treeError } = await supabase
        .from("textbooks")
        .update({
          structure_tree: result.structure_tree,
          total_pages: result.total_pages,
          updated_at: new Date().toISOString(),
        })
        .eq("id", textbookId);

      if (treeError) {
        log.error("Failed to update textbook structure_tree", { error: treeError.message });
      }

      // Write raw chunks (embeddings added in next step by worker)
      // Delete existing chunks first to prevent duplicates on retry
      await supabase
        .from("textbook_chunks")
        .delete()
        .eq("textbook_id", textbookId);

      const chunkData = (result.chunks || []).map((c: { page_number: number; structure_path: string; content: string }) => ({
        textbook_id: textbookId,
        page_number: c.page_number,
        structure_path: c.structure_path,
        content: c.content,
      }));

      if (chunkData.length > 0) {
        for (let i = 0; i < chunkData.length; i += 100) {
          const batch = chunkData.slice(i, i + 100);
          const { error: chunkError } = await supabase.from("textbook_chunks").insert(
            batch.map((c) => ({
              textbook_id: c.textbook_id,
              page_number: c.page_number,
              structure_path: c.structure_path,
              content: c.content,
            }))
          );
          if (chunkError) {
            log.warn("Failed to insert chunk batch", { batch: i, error: chunkError.message });
          }
        }
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
      await fs.unlink(tmpPath).catch((err) => {
        log.warn("Failed to delete temp file", { path: tmpPath, error: err.message });
      });
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error("Textbook processing failed", { textbookId, error: errMsg });

    await supabase
      .from("textbooks")
      .update({
        status: "failed",
        error: errMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", textbookId);

    return { textbookId, status: "failed", error: errMsg };
  }
}
