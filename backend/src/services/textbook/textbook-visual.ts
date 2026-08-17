/**
 * Selective visual understanding (VLM pass).
 *
 * For pages that carry figures/tables/diagrams (thumbnail already rendered
 * and uploaded by the Python processor), send the page image + its compact
 * extracted layout to a vision model and store:
 *  - a page summary (in the book's language)
 *  - per-figure descriptions (zipped top-to-bottom with DB figure rows)
 *
 * Design constraints:
 *  - cost-capped (VLM_MAX_PAGES, default 60) and rate-limited
 *  - best-effort: any page failure is logged and skipped — a VLM outage
 *    must never fail or block the book
 */
import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";
import { downloadR2ObjectToBuffer } from "./r2-client.js";

const log = createLogger("textbook-visual");

// Alias GOOGLE_API_KEY → GOOGLE_GENERATIVE_AI_API_KEY for @ai-sdk/google
// (same convention as the embedding service).
if (process.env.GOOGLE_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_API_KEY;
}

// gemini-flash-latest tracks the current Flash generation (older pinned
// names like gemini-2.0-flash have been retired by the API).
const VLM_MODEL = process.env.VLM_MODEL || "gemini-flash-latest";
const MAX_VLM_PAGES = parseInt(process.env.VLM_MAX_PAGES || "60", 10);
const VLM_DELAY_MS = parseInt(process.env.VLM_DELAY_MS || "400", 10);
const VLM_TIMEOUT_MS = 45_000;

interface VisualPageRow {
  page_number: number;
  thumbnail_key: string | null;
  layout: {
    page_type?: string;
    blocks?: Array<{ role?: string; text?: string }>;
  };
}

interface FigureRow {
  id: string;
  figure_id: string;
  page_number: number;
  caption: string;
  bounding_box: Record<string, number> | null;
}

function parseJsonLoose(raw: string): any | null {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildPrompt(
  page: VisualPageRow,
  language: string,
  figureCaptions: string[]
): string {
  const langName = language === "ar" ? "Arabic" : language === "mixed" ? "the book's dominant language" : "English";
  const blocks = (page.layout?.blocks || [])
    .slice(0, 25)
    .map((b) => `- [${b.role || "body"}] ${(b.text || "").substring(0, 60)}`)
    .join("\n");
  const figs = figureCaptions.length
    ? figureCaptions.map((c, i) => `${i + 1}. ${c.substring(0, 80)}`).join("\n")
    : "(none registered)";

  return `You are analyzing page ${page.page_number} of a textbook (type: ${page.layout?.page_type || "unknown"}).

Extracted structure of this page (deterministic, for grounding):
${blocks || "(no text blocks)"}

Registered figures on this page:
${figs}

Describe what THIS page actually shows visually. Respond with STRICT JSON only:
{
  "summary": "2-4 sentence summary of the page content in ${langName}",
  "figures": [
    { "description": "what this figure depicts, its colors, and its relation to the text, in ${langName}" }
  ]
}
The "figures" array must list the page's figures in TOP-TO-BOTTOM visual order, one entry per figure. If the page has no figures, return an empty array.`;
}

async function describePage(
  imageBase64: string,
  prompt: string
): Promise<{ summary?: string; figures?: Array<{ description?: string }> } | null> {
  const { generateText } = await import("ai");
  const { google } = await import("@ai-sdk/google");

  const { text } = await generateText({
    model: google(VLM_MODEL),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "file", data: imageBase64, mediaType: "image/png" },
        ],
      },
    ],
    maxOutputTokens: 900,
    abortSignal: AbortSignal.timeout(VLM_TIMEOUT_MS),
  });

  return parseJsonLoose(text);
}

export async function enrichTextbookVisually(
  textbookId: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ pages: number; figures: number }> {
  if (!process.env.GOOGLE_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    log.info("No Google API key — skipping visual enrichment", { textbookId });
    return { pages: 0, figures: 0 };
  }

  const { data: textbook } = await supabase
    .from("textbooks")
    .select("id, book_language")
    .eq("id", textbookId)
    .single();
  if (!textbook) return { pages: 0, figures: 0 };
  const language = textbook.book_language || "en";

  // Select visual pages with thumbnails (only the JSONB keys we need).
  // PostgREST returns raw arrow names, so alias them explicitly.
  const { data: rawPages } = await supabase
    .from("textbook_pages")
    .select(
      "page_number, thumbnail_key, vlm_enriched, " +
        "page_type:layout->page_type, blocks:layout->blocks, " +
        "images:layout->images, vector_clusters:layout->vector_clusters"
    )
    .eq("textbook_id", textbookId)
    .order("page_number");

  const candidates = ((rawPages || []) as any[]).filter(
    (p) =>
      !p.vlm_enriched &&
      p.thumbnail_key &&
      ((Array.isArray(p.images) && p.images.length > 0) ||
        (Array.isArray(p.vector_clusters) && p.vector_clusters.length > 0))
  ).slice(0, MAX_VLM_PAGES);

  if (candidates.length === 0) {
    log.info("No pages need visual enrichment", { textbookId });
    return { pages: 0, figures: 0 };
  }

  log.info("Starting visual enrichment", {
    textbookId,
    pages: candidates.length,
    model: VLM_MODEL,
  });

  let enrichedPages = 0;
  let enrichedFigures = 0;

  for (let i = 0; i < candidates.length; i++) {
    const page = candidates[i] as any;
    try {
      // figures on this page (for captions + later zip)
      const { data: figRows } = await supabase
        .from("textbook_figures")
        .select("id, figure_id, page_number, caption, bounding_box")
        .eq("textbook_id", textbookId)
        .eq("page_number", page.page_number);
      const figures: FigureRow[] = (figRows || []).slice().sort((a: any, b: any) => {
        const ya = a.bounding_box?.y0 ?? 0;
        const yb = b.bounding_box?.y0 ?? 0;
        return ya - yb;
      });

      const thumbBase64 = await downloadR2ObjectToBuffer(page.thumbnail_key);
      if (!thumbBase64 || thumbBase64.length === 0) continue;

      const result = await describePage(
        thumbBase64.toString("base64"),
        buildPrompt(page, language, figures.map((f) => f.caption))
      );
      if (!result) continue;

      const summary = typeof result.summary === "string" ? result.summary.trim() : "";
      await supabase
        .from("textbook_pages")
        .update({
          vlm_summary: summary || null,
          vlm_enriched: true,
        })
        .eq("textbook_id", textbookId)
        .eq("page_number", page.page_number);
      enrichedPages++;

      // zip VLM figure descriptions (top-to-bottom) with y-sorted DB rows
      const vlmFigures = Array.isArray(result.figures) ? result.figures : [];
      for (let f = 0; f < figures.length && f < vlmFigures.length; f++) {
        const desc = typeof vlmFigures[f]?.description === "string"
          ? (vlmFigures[f] as { description: string }).description.trim()
          : "";
        if (!desc) continue;
        await supabase
          .from("textbook_figures")
          .update({ vlm_description: desc })
          .eq("id", figures[f].id);
        enrichedFigures++;
      }
    } catch (err) {
      log.warn("Visual enrichment failed for page (skipped)", {
        textbookId,
        page: page.page_number,
        error: (err as Error).message,
      });
    } finally {
      onProgress?.(i + 1, candidates.length);
      if (i + 1 < candidates.length && VLM_DELAY_MS > 0) {
        await new Promise((r) => setTimeout(r, VLM_DELAY_MS));
      }
    }
  }

  log.info("Visual enrichment complete", {
    textbookId,
    enrichedPages,
    enrichedFigures,
  });
  return { pages: enrichedPages, figures: enrichedFigures };
}
