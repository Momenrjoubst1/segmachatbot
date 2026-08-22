/**
 * Shared text extraction utilities
 * استخراج النص المشترك - يزيل التكرار عبر الملفات
 */

import type { CoreMessage } from '../../services/chat/moderation.service.js';

/**
 * Extracts plain text from a CoreMessage's content (string | parts[])
 */
export function extractText(content: CoreMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: string; text?: string } => p?.type === 'text')
      .map((p) => p.text ?? '')
      .join(' ');
  }
  return '';
}

/**
 * Extracts plain text from a message object (used in token estimation)
 */
export function extractTextFromMessage(msg: { role: string; content: string | Array<{ type: string; text?: string }> }): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p): p is { type: string; text?: string } => p?.type === 'text')
      .map((p) => p.text ?? '')
      .join(' ');
  }
  return '';
}

/**
 * Extracts text from file parts (for token estimation)
 */
export function extractTextFromFilePart(part: { type: string; data?: string }): string {
  if (part.type === 'file' && typeof part.data === 'string') {
    return part.data;
  }
  return '';
}