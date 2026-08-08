/**
 * Message Processor Service
 *
 * Extracted from chat.routes.ts — handles all image/file processing logic:
 * - Base64 image detection & formatting
 * - CoreMessages mapping from raw request messages
 * - File pre-processing (extract text from attachments)
 * - Image pre-processing (vision analysis or fallback)
 * - Message flattening after processing
 */

import { generateText } from "ai";
import {
  log,
  createProviderClient,
} from "../../routes/chat/chat-shared.js";
import type { CoreMessage } from "./moderation.service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isBase64Image = (data: string): boolean => {
  if (!data) return false;
  const base64 = data.includes(",") ? data.split(",")[1]! : data;
  const clean = base64.trim().substring(0, 15);
  return (
    clean.startsWith("iVBORw") ||
    clean.startsWith("/9j/") ||
    clean.startsWith("UklGR") ||
    clean.startsWith("R0lGOD")
  );
};

const isImagePart = (p: Record<string, unknown>): boolean => {
  if (p.type === "image") return true;
  const file = p.file as Record<string, unknown> | undefined;
  const mime = (p.mimeType as string) || (file?.type as string) || "";
  if (mime.startsWith("image/")) return true;
  const filename = (p.filename as string) || (file?.name as string) || "";
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"].includes(ext))
    return true;

  const rawData =
    (p.image as string) ||
    (p.url as string) ||
    (p.data as string) ||
    (p.base64 as string) ||
    (file?.url as string) ||
    (file?.data as string) ||
    (file?.base64 as string) ||
    "";
  return isBase64Image(rawData);
};

const formatImageAsDataUrl = (
  data: string,
  ext: string,
  mimeType?: string,
): string => {
  if (!data) return "";
  if (data.startsWith("data:image/")) return data;

  let mime = mimeType;
  if (!mime || !mime.startsWith("image/")) {
    const clean = data.includes(",")
      ? data.split(",")[1]!.trim()
      : data.trim();
    if (clean.startsWith("iVBORw")) mime = "image/png";
    else if (clean.startsWith("/9j/")) mime = "image/jpeg";
    else if (clean.startsWith("UklGR")) mime = "image/webp";
    else if (clean.startsWith("R0lGOD")) mime = "image/gif";
    else {
      mime =
        ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : ext === "gif"
              ? "image/gif"
              : ext === "svg"
                ? "image/svg+xml"
                : "image/jpeg";
    }
  }

  const base64Data = data.includes(",") ? data.split(",")[1] : data;
  return `data:${mime};base64,${base64Data}`;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ProcessedMessages {
  coreMessages: CoreMessage[];
  hasImages: boolean;
  imageAnalysisFailed?: boolean;
  imageAnalysisError?: string;
}

/**
 * Process raw request messages into clean coreMessages ready for the LLM.
 *
 * Steps:
 *  1. Filter & map to coreMessages shape
 *  2. Extract text from file attachments
 *  3. Flatten non-image messages
 *  4. Run vision analysis for non-native-vision models (or fallback to text)
 */
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
): Promise<ProcessedMessages> {
  const metrics: ProcessedMessages = {
    coreMessages: [],
    hasImages: false,
  };

  // ---- Step 1: Map raw messages to coreMessages ----
  let hasImages = false;

  const coreMessages = messages
    .filter((m): m is RawMessage & { role: string } =>
      ["system", "user", "assistant", "tool"].includes(m.role ?? ""),
    )
    .map((m) => {
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

  // ---- Step 2: File pre-processing — extract text from attachments ----
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

  // ---- Step 3: Flatten non-image messages after file processing ----
  for (const msg of coreMessages) {
    if (!Array.isArray(msg.content)) continue;
    const imageParts = msg.content.filter((p: Record<string, unknown>) => p.type === "image");
    if (imageParts.length === 0) {
      const textParts = msg.content.filter((p: Record<string, unknown>) => p.type === "text");
      msg.content =
        textParts.map((p: Record<string, unknown>) => (p.text as string) || "").join("\n") || " ";
    }
  }

  // ---- Step 4: Image pre-processing (vision analysis or fallback) ----
  const nativeVisionModels = [
    "gpt-5.4",
    "gpt-4o",
    "gpt-4o-mini",
    "google/gemini-2.0-flash-exp:free",
  ];
  const supportsNativeVision = nativeVisionModels.includes(selectedModel);

  if (hasImages && !supportsNativeVision) {
    try {
      const visionModelId =
        process.env.VISION_MODEL_ID?.trim() || "openai/gpt-4o";

      // BUG-8 FIX: removed dead IIFE that always returned empty strings.
      // Use gpm directly to resolve provider for the vision client.
      const { getProviderAndModel: gpm } = await import(
        "../../routes/chat/chat-shared.js"
      );
      const { provider: vp, modelName: vn } = gpm(selectedModel);
      const client = createProviderClient(vp);

      for (const msg of coreMessages) {
        if (Array.isArray(msg.content)) {
          const imageParts = msg.content.filter((p: Record<string, unknown>) => p.type === "image");
          if (imageParts.length === 0) continue;
          const textParts = msg.content.filter((p: Record<string, unknown>) => p.type === "text");
          const userText = textParts.map((p: Record<string, unknown>) => p.text).join("\n");

          let visionModel: ReturnType<ReturnType<typeof createProviderClient>["chat"]>;
          try {
            if (process.env.OPENROUTER_API_KEY) {
              const openRouterClient = createProviderClient("openrouter");
              visionModel = openRouterClient.chat(visionModelId);
            } else {
              visionModel = client.chat(vn);
            }
          } catch (visionErr) {
            log.warn('OpenRouter vision model unavailable, using default', { error: (visionErr as Error)?.message });
            visionModel = client.chat(vn);
          }

          const textPrompt = userText
            ? `\n\nUser question: ${userText}\nDescribe all visible details in the image(s) and answer the question if possible. Reply in English.`
            : "\n\nDescribe all visible details in the image(s). Reply in English.";
          const { text: analysis } = await generateText({
            model: visionModel,
            messages: [
              {
                role: "user",
                content: [
                  ...(Array.isArray(msg.content) ? msg.content : []),
                  { type: "text", text: textPrompt },
                ],
              },
            ],
            maxRetries: 2,
          } as Parameters<typeof generateText>[0]);
          msg.content = `[Attached Image Analysis: ${analysis}]\n\n${userText || "The user attached an image. See analysis above."}`;
        }
      }
      hasImages = false;
      log.info("Image analysis completed and replaced with text");
    } catch (imgErr: unknown) {
      const reason = imgErr instanceof Error ? imgErr.message : String(imgErr);
      log.warn("Image analysis failed, falling back to text-only", {
        error: reason,
      });
      metrics.imageAnalysisFailed = true;
      metrics.imageAnalysisError = reason;

      for (const msg of coreMessages) {
        if (Array.isArray(msg.content)) {
          const textParts = msg.content.filter((p: Record<string, unknown>) => p.type === "text");
          const userText = textParts
            .map((p: Record<string, unknown>) => (p.text as string) || "")
            .join("\n")
            .trim();
          if (userText) {
            msg.content = `${userText}\n\n[Note: an attached image was dropped because the vision analysis service failed. Please acknowledge this to the user and offer to help based on the text alone.]`;
          } else {
            msg.content =
              "[The user attached an image but the vision analysis service is currently unavailable. Please ask the user to describe the image in text so you can help.]";
          }
        }
      }
    }
  }

  metrics.coreMessages = coreMessages;
  metrics.hasImages = hasImages;
  return metrics;
}
