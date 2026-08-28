/**
 * RAG Utility Functions
 * دوال الأدوات المساعدة لـ RAG
 *
 * Shared helper functions used across RAG pipeline steps.
 */

import type { RankedDoc } from "../types.js";

/**
 * Clean a source name for display in RAG sources.
 */
export function cleanSourceName(source?: string): string {
  if (!source) return "Knowledge Base";
  return source
    .replace(/^Textbook:\s*/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/[_-]/g, " ")
    .trim() || "Knowledge Base";
}

/**
 * Extract unique source names from ranked documents.
 */
export function uniqueSourceNames(docs: RankedDoc[]): string[] {
  return [...new Set(
    docs.map((d) => cleanSourceName(
      typeof d.metadata?.source === 'string' ? d.metadata.source :
      typeof d.metadata?.source_url === 'string' ? d.metadata.source_url :
      typeof d.metadata?.file_name === 'string' ? d.metadata.file_name : undefined
    )),
  )];
}
