// Shared resolver for the cheap auxiliary chat model used by education tasks
// (answer grading, memory extraction, flashcard generation). These calls are
// frequent and per-user, so they must never default to a premium model.

import type { LanguageModel } from "ai";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("ai:small-model");

let cachedModel: LanguageModel | null = null;

/**
 * Small chat model chain: Google gemini-2.0-flash-lite → GitHub Models gpt-4o-mini.
 * The resolved model is cached for the process lifetime.
 */
export async function getSmallChatModel(): Promise<LanguageModel> {
  if (cachedModel) return cachedModel;

  try {
    const { google } = await import("@ai-sdk/google");
    cachedModel = google("gemini-2.0-flash-lite");
  } catch (googleErr) {
    log.warn("Google small model unavailable, falling back to GitHub Models", {
      error: (googleErr as Error).message,
    });
    const { createOpenAI } = await import("@ai-sdk/openai");
    cachedModel = createOpenAI({
      baseURL: "https://models.inference.ai.azure.com",
      apiKey: process.env.GITHUB_TOKEN || "",
    }).chat("gpt-4o-mini");
  }

  return cachedModel;
}
