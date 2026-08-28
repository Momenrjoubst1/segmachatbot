// Image/file pre-processing that turns raw request messages into LLM-ready coreMessages.

import {
  log,
  createProviderClient,
} from "../../routes/chat/chat-shared.js";
import type { CoreMessage } from "./moderation.service.js";
import { resolveMediaPart, ownedR2Key } from "./media-router.js";
import { downloadR2ObjectToBuffer } from "../textbook/r2-client.js";

// Extracted helper functions
import { isImagePart, formatImageAsDataUrl } from "./message-processor/image-helpers.js";
import { isVisionCapableModel, performVisionAnalysis } from "./message-processor/vision-analysis.js";

// Re-export for backward compatibility
export { isVisionCapableModel } from "./message-processor/vision-analysis.js";

// Public API.

export interface ProcessedMessages {
  coreMessages: CoreMessage[];
  hasImages: boolean;
  /** Video/audio attachments resolved during processing. */
  mediaCount: number;
  imageAnalysisFailed?: boolean;
  imageAnalysisError?: string;
}

// Process raw request messages into clean coreMessages ready for the LLM.
interface RawMessage {
  role?: string;
  content?: unknown;
  parts?: unknown;
  text?: string;
  toolInvocations?: Array<{
    toolCallId?: string;
    toolName?: string;
    args?: Record<string, unknown>;
    result?: unknown;
  }>;
}

export async function processMessages(
  messages: RawMessage[],
  selectedModel: string,
  userId?: string,
): Promise<ProcessedMessages> {
  const metrics: ProcessedMessages = {
    coreMessages: [],
    hasImages: false,
    mediaCount: 0,
  };

  // Step 1: map raw messages to coreMessages.
  let hasImages = false;

  const coreMessages = messages
    .filter((m): m is RawMessage & { role: string } =>
      ["system", "user", "assistant", "tool"].includes(m.role ?? ""),
    )
    .map((m) => {
      // Handle content as object (e.g., { type: "text", text: "..." })
      let contentStr = " ";
      if (typeof m.content === "string") {
        contentStr = m.content;
      } else if (typeof m.content === "object" && m.content !== null && !Array.isArray(m.content)) {
        const obj = m.content as Record<string, unknown>;
        contentStr = (obj.text as string) || (obj.content as string) || JSON.stringify(obj);
      }

      const partsArray = Array.isArray(m.content)
        ? m.content
        : Array.isArray(m.parts)
          ? m.parts
          : null;

      const msg: CoreMessage = {
        role: m.role as CoreMessage["role"],
        content: " ",
      };

      if (partsArray) {
        const imageParts = partsArray.filter((p: Record<string, unknown>) => isImagePart(p));
        const fileParts = partsArray.filter(
          (p: Record<string, unknown>) =>
            (p.type === "file" || p.type === "image") && !isImagePart(p),
        );
        const textParts = partsArray.filter(
          (p: Record<string, unknown>) => p.type === "text" || !p.type,
        );

        if (imageParts.length > 0 || fileParts.length > 0) {
          if (imageParts.length > 0) hasImages = true;
          const contentArray: Array<{ type: string; text?: string; image?: string; data?: string; mimeType?: string; filename?: string }> = [];
          for (const part of partsArray as Array<Record<string, unknown>>) {
            if (part.type === "text") {
              contentArray.push({ type: "text", text: (part.text as string) || " " });
            } else if (isImagePart(part)) {
              const ext =
                (
                  (part.filename as string) ||
                  ((part.file as Record<string, unknown>)?.name as string) ||
                  ""
                )
                  .split(".")
                  .pop()
                  ?.toLowerCase() || "jpeg";
              const mime = (part.mimeType as string) || ((part.file as Record<string, unknown>)?.type as string);
              const rawData =
                (part.image as string) ||
                (part.url as string) ||
                (part.data as string) ||
                (part.base64 as string) ||
                ((part.file as Record<string, unknown>)?.url as string) ||
                ((part.file as Record<string, unknown>)?.data as string) ||
                ((part.file as Record<string, unknown>)?.base64 as string) ||
                "";
              const imgData = formatImageAsDataUrl(rawData, ext, mime);
              contentArray.push({ type: "image", image: imgData });
            } else {
              contentArray.push({
                type: "file",
                data:
                  (part.data as string) ||
                  (part.url as string) ||
                  (part.base64 as string) ||
                  ((part.file as Record<string, unknown>)?.url as string) ||
                  ((part.file as Record<string, unknown>)?.data as string) ||
                  ((part.file as Record<string, unknown>)?.base64 as string) ||
                  "",
                mimeType:
                  (part.mimeType as string) || ((part.file as Record<string, unknown>)?.type as string) || "application/octet-stream",
                filename: (part.filename as string) || ((part.file as Record<string, unknown>)?.name as string) || "file",
              });
            }
          }
          msg.content = contentArray.length > 0 ? contentArray : " ";
        } else {
          msg.content =
            textParts.map((p: Record<string, unknown>) => (p.text as string) || "").join("") || " ";
        }
      } else if (typeof m.content === "string") {
        msg.content = m.content;
      } else if (typeof m.content === "object" && m.content !== null && !Array.isArray(m.content)) {
        // Handle content as object (e.g., { type: "text", text: "..." })
        const obj = m.content as Record<string, unknown>;
        msg.content = (obj.text as string) || (obj.content as string) || JSON.stringify(obj);
      } else if (typeof m.text === "string") {
        msg.content = m.text;
      } else {
        msg.content = " ";
      }

      if (
        m.role === "assistant" &&
        Array.isArray(m.toolInvocations) &&
        m.toolInvocations.length > 0
      ) {
        (msg as CoreMessage & { toolCalls: unknown[] }).toolCalls = m.toolInvocations.map((t) => ({
          id: t.toolCallId || "call_default",
          type: "function",
          function: {
            name: t.toolName || "unknown",
            arguments: JSON.stringify(t.args || {}),
          },
        }));
      }

      if (
        m.role === "tool" &&
        Array.isArray(m.toolInvocations) &&
        m.toolInvocations.length > 0
      ) {
        msg.content = m.toolInvocations.map((t) => ({
          type: "tool-result",
          toolCallId: t.toolCallId || "call_default",
          toolName: t.toolName || "unknown",
          result: t.result || {},
        }));
      }

      return msg;
    });

  // Step 1.5: resolve video/audio r2:// refs into native parts, sentinels, or transcripts.
  if (userId) {
    try {
      for (const msg of coreMessages) {
        if (!Array.isArray(msg.content)) continue;
        const parts = msg.content as Array<Record<string, unknown>>;
        const hasMediaPart = parts.some((p) => {
          const mime = String(p?.mimeType || "").toLowerCase();
          return p?.type === "file" && (mime.startsWith("video/") || mime.startsWith("audio/"));
        });
        if (!hasMediaPart) continue;

        type ContentItem = { type: string; text?: string; image?: string; data?: string | URL; mimeType?: string; filename?: string };
        const rebuilt: ContentItem[] = [];
        for (const part of parts) {
          const mime = String(part?.mimeType || "").toLowerCase();
          if (part?.type !== "file" || !(mime.startsWith("video/") || mime.startsWith("audio/"))) {
            rebuilt.push(part as ContentItem);
            continue;
          }
          const resolved = await resolveMediaPart({ part, userId, targetModel: selectedModel });
          if (!resolved) {
            rebuilt.push(part as ContentItem);
            continue;
          }
          metrics.mediaCount += 1;
          if (resolved.file) {
            // URL instance → @ai-sdk/google emits fileData.fileUri (not base64).
            const data = resolved.file.data;
            rebuilt.push({
              type: "file",
              mimeType: resolved.file.mimeType,
              data: /^https?:\/\//i.test(data) ? new URL(data) : data,
              filename: typeof part.filename === "string" ? part.filename : undefined,
            });
          } else if (resolved.sentinel) {
            rebuilt.push({ type: "text", text: resolved.sentinel });
          } else if (resolved.text) {
            rebuilt.push({ type: "text", text: resolved.text });
          }
        }
        msg.content = rebuilt;
      }
    } catch (mediaErr) {
      log.warn("Media resolution failed (non-fatal)", { error: (mediaErr as Error).message });
    }
  }

  // Step 1.7: stage r2:// document refs into extractable base64 data URLs.
  if (userId) {
    for (const msg of coreMessages) {
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content as Array<Record<string, unknown>>) {
        if (part?.type !== "file") continue;
        const data = String(part.data || "");
        const key = ownedR2Key(data, userId);
        if (!key) continue;
        try {
          const bytes = await downloadR2ObjectToBuffer(key);
          part.data = `data:${String(part.mimeType || "application/octet-stream")};base64,${bytes.toString("base64")}`;
        } catch (err) {
          log.warn("Document ref download failed", { key, error: (err as Error).message });
          part.data = "";
        }
      }
    }
  }

  // Step 2: file pre-processing — extract text from attachments.
  const hasFileParts = coreMessages.some(
    (msg) =>
      Array.isArray(msg.content) &&
      msg.content.some((p: Record<string, unknown>) => p.type === "file"),
  );

  if (hasFileParts) {
    try {
      const { extractTextFromFilePart } = await import(
        "../security/file-text-extractor.js"
      );

      for (const msg of coreMessages) {
        if (!Array.isArray(msg.content)) continue;

        const fileParts = msg.content.filter((p: Record<string, unknown>) => p.type === "file");
        if (fileParts.length === 0) continue;

        const textParts = msg.content.filter((p: Record<string, unknown>) => p.type === "text");
        const imageParts = msg.content.filter((p: Record<string, unknown>) => p.type === "image");
        const extraTexts: Array<{ type: string; text: string }> = [];

        for (const filePart of fileParts) {
          const fp = filePart as Record<string, unknown>;
          const filename = (fp.filename as string) || "attachment";
          const mimeType = (fp.mimeType as string) || "application/octet-stream";
          try {
            const result = await extractTextFromFilePart({
              data: fp.data as string,
              mimeType,
              filename,
            });
            const truncNote = result.truncated
              ? "\n[File text truncated]"
              : "";
            extraTexts.push({
              type: "text",
              text: `[File: ${filename} | ${mimeType}]\n${result.text}${truncNote}`,
            });
          } catch (extractErr) {
            log.warn('File text extraction failed', { error: (extractErr as Error)?.message, filename });
            extraTexts.push({
              type: "text",
              text: `[File: ${filename} | ${mimeType}] (تعذر قراءة الملف)`,
            });
          }
        }

        msg.content = [...textParts, ...extraTexts, ...imageParts];
      }
    } catch (fileErr: unknown) {
      log.warn("File extraction failed", {
        error: fileErr instanceof Error ? fileErr.message : String(fileErr),
      });
      for (const msg of coreMessages) {
        if (!Array.isArray(msg.content)) continue;
        const textParts = msg.content.filter((p: Record<string, unknown>) => p.type === "text");
        msg.content =
          textParts.map((p: Record<string, unknown>) => (p.text as string) || "").join("\n") || " ";
      }
    }
  }

  // Step 3: flatten messages that have neither image nor file parts to plain strings.
  for (const msg of coreMessages) {
    if (!Array.isArray(msg.content)) continue;
    const nonTextParts = (msg.content as Array<Record<string, unknown>>).filter(
      (p: Record<string, unknown>) => p.type === "image" || p.type === "file",
    );
    if (nonTextParts.length === 0) {
      const textParts = msg.content.filter((p: Record<string, unknown>) => p.type === "text");
      msg.content =
        textParts.map((p: Record<string, unknown>) => (p.text as string) || "").join("\n") || " ";
    }
  }

  // Step 4: vision analysis for non-native-vision models, else text fallback.
  if (hasImages && !isVisionCapableModel(selectedModel)) {
    const visionResult = await performVisionAnalysis(coreMessages, selectedModel);
    if (!visionResult.success) {
      metrics.imageAnalysisFailed = true;
      metrics.imageAnalysisError = visionResult.error;
    }
    hasImages = false;
  }

  metrics.coreMessages = coreMessages;
  metrics.hasImages = hasImages;
  return metrics;
}
