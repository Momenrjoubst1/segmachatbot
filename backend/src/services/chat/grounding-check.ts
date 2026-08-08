/**
 * Grounding Check — Verify that the AI response is grounded in retrieved sources.
 *
 * Heuristic approach (no LLM calls):
 *  1. Extract key claims/facts from the response (sentences with specific
 *     numbers, dates, names, or factual statements)
 *  2. Check if those facts appear in the retrieved documents via fuzzy
 *     string matching
 *  3. Track which source documents were actually referenced
 *  4. If groundedPercentage < 30% and there ARE retrieved docs, flag as
 *     potentially hallucinated
 */

import { createLogger } from "../../utils/logger.js";

const log = createLogger("grounding-check");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GroundingResult {
  isGrounded: boolean;
  groundedPercentage: number; // 0-100
  ungroundedClaims: string[];
  usedSources: string[];
}

interface RetrievedDoc {
  id?: string | number;
  content: string;
  metadata?: {
    source?: string;
    source_url?: string;
    file_name?: string;
    [key: string]: unknown;
  };
  similarity?: number;
  rerankScore?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split text into sentences.  Handles Arabic (،。) and English punctuation.
 */
function splitSentences(text: string): string[] {
  return text
    .split(/[.!?؟。，\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10); // Ignore very short fragments
}

/**
 * Determine whether a sentence is a "claim" — i.e. contains specific
 * factual information (numbers, dates, names) that should be grounded.
 */
function isClaim(sentence: string): boolean {
  // Contains numbers (including Arabic-Indic digits)
  if (/\d|[٠-٩]/.test(sentence)) return true;
  // Contains date-like patterns
  if (/\d{1,4}[\/\-]\d{1,4}([\/\-]\d{1,4})?/.test(sentence)) return true;
  // Contains year references
  if (/(19|20)\d{2}/.test(sentence)) return true;
  // Contains proper-noun-like patterns (Arabic names with "ال" or English caps)
  if (/ال[\u0621-\u064A]{3,}/.test(sentence)) return true;
  // Contains percentages
  if (/\d+\s*%|\d+\s*٪/.test(sentence)) return true;
  // Contains monetary amounts
  if (/\d+\s*(دينار|دولار|JD|USD|JOD)/.test(sentence)) return true;
  // Contains academic terms that are factual
  if (
    /(?:معدل|GPA|ساعات|credit|درجة|grade|فصل|semester|جامعة|university|كلية|faculty|قسم|department)/i.test(
      sentence,
    )
  )
    return true;

  return false;
}

/**
 * Normalise text for fuzzy matching:
 *  - lowercase
 *  - remove diacritics (Arabic tashkeel)
 *  - collapse whitespace
 *  - normalise Arabic alef / ya
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    // Remove Arabic diacritics (tashkeel)
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "")
    // Normalise Arabic alef variants
    .replace(/[أإآ]/g, "ا")
    // Normalise Arabic ya / alef maqsura
    .replace(/ى/g, "ي")
    // Normalise taa marbuta
    .replace(/ة/g, "ه")
    // Remove tatweel
    .replace(/\u0640/g, "")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute the overlap ratio between a claim and a document using n-gram
 * matching.  Returns a value between 0 and 1.
 */
function ngramOverlap(claim: string, doc: string, n = 3): number {
  const normClaim = normalise(claim);
  const normDoc = normalise(doc);

  if (normClaim.length < n || normDoc.length < n) return 0;

  // Build unique ngram sets for both sides — using Sets ensures each distinct
  // ngram is counted only once, so the ratio stays in [0, 1].
  const claimNgrams = new Set<string>();
  for (let i = 0; i <= normClaim.length - n; i++) {
    claimNgrams.add(normClaim.substring(i, i + n));
  }

  const docNgrams = new Set<string>();
  for (let i = 0; i <= normDoc.length - n; i++) {
    docNgrams.add(normDoc.substring(i, i + n));
  }

  // Count ngrams that appear in BOTH sets (set intersection)
  let matches = 0;
  for (const ng of claimNgrams) {
    if (docNgrams.has(ng)) matches++;
  }

  // Denominator = claim side size → result is always in [0, 1]
  return claimNgrams.size > 0 ? matches / claimNgrams.size : 0;
}

/**
 * Extract a clean source name from a document's metadata.
 */
function getSourceName(doc: RetrievedDoc): string {
  const raw =
    doc.metadata?.source || doc.metadata?.source_url || doc.metadata?.file_name || "";
  if (!raw) return "Unknown Document";
  return raw
    .replace(/^[^a-zA-Z0-9\u0621-\u064A]+/, "")
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Main grounding check
// ---------------------------------------------------------------------------

export function checkGrounding(
  response: string,
  retrievedDocs: RetrievedDoc[],
  options?: { strictMode?: boolean },
): GroundingResult {
  const strictMode = options?.strictMode ?? false;
  const OVERLAP_THRESHOLD = strictMode ? 0.4 : 0.25;

  // Edge case: no docs retrieved → nothing to ground against
  if (!retrievedDocs || retrievedDocs.length === 0) {
    return {
      isGrounded: true, // No RAG → can't be ungrounded against RAG
      groundedPercentage: 100,
      ungroundedClaims: [],
      usedSources: [],
    };
  }

  // Edge case: empty response
  if (!response || response.trim().length === 0) {
    return {
      isGrounded: true,
      groundedPercentage: 100,
      ungroundedClaims: [],
      usedSources: [],
    };
  }

  // Strip the "Sources" section from the response before checking —
  // we only want to verify the body of the answer.
  const body = response.replace(
    /---\s*###?\s*📚?\s*المصادر.*$/s,
    "",
  ).replace(
    /---\s*###?\s*Sources?.*$/s,
    "",
  ).trim();

  const sentences = splitSentences(body);
  const claims = sentences.filter(isClaim);

  // If no identifiable claims, assume it's ok
  if (claims.length === 0) {
    log.info("No factual claims detected in response", {
      sentenceCount: sentences.length,
    });
    return {
      isGrounded: true,
      groundedPercentage: 100,
      ungroundedClaims: [],
      usedSources: [],
    };
  }

  const usedSourceSet = new Set<string>();
  const ungroundedClaims: string[] = [];
  let groundedCount = 0;

  for (const claim of claims) {
    let bestScore = 0;
    let bestSource = "";

    for (const doc of retrievedDocs) {
      const score = ngramOverlap(claim, doc.content);
      if (score > bestScore) {
        bestScore = score;
        bestSource = getSourceName(doc);
      }
    }

    if (bestScore >= OVERLAP_THRESHOLD) {
      groundedCount++;
      if (bestSource) usedSourceSet.add(bestSource);
    } else {
      ungroundedClaims.push(claim.substring(0, 120));
    }
  }

  const groundedPercentage = Math.round(
    (groundedCount / claims.length) * 100,
  );

  const GROUNDED_THRESHOLD = strictMode ? 60 : 30;
  const isGrounded = groundedPercentage >= GROUNDED_THRESHOLD;

  log.info("Grounding check result", {
    totalClaims: claims.length,
    groundedCount,
    groundedPercentage,
    isGrounded,
    ungroundedCount: ungroundedClaims.length,
    usedSources: [...usedSourceSet],
    strictMode,
  });

  return {
    isGrounded,
    groundedPercentage,
    ungroundedClaims,
    usedSources: [...usedSourceSet],
  };
}
