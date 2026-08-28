/**
 * Pipeline Utility Functions
 * دوال الأدوات المساعدة للخطوات
 *
 * Shared helper functions used across pipeline steps.
 */

import type { CoreMessage } from "../moderation.service.js";

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
 * Extract text content from a CoreMessage.
 */
export function extractText(content: CoreMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: string; text?: string } => p?.type === "text")
      .map((p) => p.text ?? "")
      .join(" ");
  }
  return "";
}
