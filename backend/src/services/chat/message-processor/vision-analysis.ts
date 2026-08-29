/**
 * Vision Analysis — handles image analysis for non-vision-capable models.
 * تحليل الرؤية — يتعامل مع تحليل الصور للموديلات غير القادرة على الرؤية
 */

import { generateText } from "ai";
import { log, createProviderClient } from "../../../routes/chat/chat-shared.js";
import type { CoreMessage } from "../moderation.service.js";
import { visionReplyLanguage } from "./image-helpers.js";

// Model-family patterns that accept image parts natively.
const DEFAULT_VISION_MODEL_PATTERNS = [
  "gpt-4o",
  "gpt-5",
  "chatgpt-4o",
  "gemini",
  "claude-3",
  "claude-4",
  "grok-2-vision",
  "pixtral",
];

/**
 * Check if a model can receive image parts directly (native vision).
 */
export function isVisionCapableModel(modelName: string): boolean {
  const configured = (process.env.VISION_NATIVE_MODELS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const haystack = modelName.toLowerCase();
  if (configured.length > 0) {
    return configured.includes(haystack) || configured.some((n) => haystack.includes(n));
  }
  return DEFAULT_VISION_MODEL_PATTERNS.some((p) => haystack.includes(p));
}

/**
 * Perform vision analysis on messages with images.
 * Replaces image parts with text analysis for non-vision models.
 */
export async function performVisionAnalysis(
  coreMessages: CoreMessage[],
  selectedModel: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Gemini 2.5 Flash — free, vision-native, verified live. Resolved through
    // the normal provider map so the id and client always agree.
    const visionModelId =
      process.env.VISION_MODEL_ID?.trim() || "gemini-2.5-flash";

    // Resolve the vision client's provider directly via getProviderAndModel.
    const { getProviderAndModel: gpm } = await import(
      "../../../routes/chat/chat-shared.js"
    );
    const { provider: vp, modelName: vn } = gpm(selectedModel);
    const client = createProviderClient(vp);

    for (const msg of coreMessages) {
      if (Array.isArray(msg.content)) {
        const imageParts = msg.content.filter((p: Record<string, unknown>) => p.type === "image");
        if (imageParts.length === 0) continue;
        const textParts = msg.content.filter((p: Record<string, unknown>) => p.type === "text");
        const userText = textParts.map((p: Record<string, unknown>) => p.text).join("\n");

        const { provider: visionProvider, modelName: visionName } = gpm(visionModelId);
        let visionModel: ReturnType<ReturnType<typeof createProviderClient>["chat"]>;
        try {
          visionModel = createProviderClient(visionProvider).chat(visionName);
        } catch (visionErr) {
          log.warn('Vision model client unavailable, using selected-model provider', { error: (visionErr as Error)?.message });
          visionModel = client.chat(vn);
        }

        const textPrompt = userText
          ? `\n\nUser question: ${userText}\nDescribe all visible details in the image(s) and answer the question if possible. ${visionReplyLanguage(userText)}`
          : `\n\nDescribe all visible details in the image(s). ${visionReplyLanguage("")}`;
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
    log.info("Image analysis completed and replaced with text");
    return { success: true };
  } catch (imgErr: unknown) {
    const reason = imgErr instanceof Error ? imgErr.message : String(imgErr);
    log.warn("Image analysis failed, falling back to text-only", {
      error: reason,
    });

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
    return { success: false, error: reason };
  }
}
