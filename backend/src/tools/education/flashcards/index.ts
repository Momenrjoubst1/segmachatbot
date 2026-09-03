import { z } from "zod";
import redis from "../../../config/redis/client.js";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { createFlashcards } from "../../../services/study/flashcards.service.js";
import { getStudyProgress } from "../../../services/study/progress.service.js";
import { fetchTopicContext } from "../../../services/study/quiz-generator.service.js";

createToolMetadata("generate_flashcards", "Generate and save study flashcards from a given topic", {
  requiresUserId: true,
  category: "education",
  enabledByDefault: true,
});

const DAILY_GENERATION_QUOTA = 10;

registerTool("generate_flashcards", {
  description: "Generate and save study flashcards from a given topic. Cards are saved automatically for later review using spaced repetition (SRS). If the student does not specify a topic, their weakest topics are targeted automatically.",
  inputSchema: z.object({
    topic: z.string().optional().describe("Topic to generate cards for. Leave empty to automatically target the student's weakest topic"),
    count: z.number().optional().describe("Number of cards requested (default 5, max 15)"),
    courseId: z.string().uuid().optional().describe("Course ID (optional)"),
    textbookId: z.string().uuid().optional().describe("Textbook ID (optional)"),
    sectionPath: z.string().optional().describe("Section/lesson path in the book (optional)"),
    __userId: z.string().optional().describe("User ID (passed automatically)"),
  }),
  execute: async ({
    topic,
    count,
    courseId,
    textbookId,
    sectionPath,
    __userId,
  }: {
    topic?: string;
    count?: number;
    courseId?: string;
    textbookId?: string;
    sectionPath?: string;
    __userId?: string;
  }) => {
    try {
      // Daily per-user quota — each call is an extra LLM generation.
      if (__userId) {
        try {
          const day = new Date().toISOString().slice(0, 10);
          const quotaKey = `study:flashgen:${__userId}:${day}`;
          const used = await redis.incr(quotaKey);
          if (used === 1) await redis.expire(quotaKey, 86_400);
          if (used > DAILY_GENERATION_QUOTA) {
            return JSON.stringify({
              status: "error",
              message: `You have reached the daily card generation limit (${DAILY_GENERATION_QUOTA} times). Review your current cards and try again tomorrow.`,
            });
          }
        } catch { /* quota store down — fail open */ }
      }

      // Weak-topic targeting: no topic given → pick the student's weakest.
      let effectiveTopic = (topic || "").trim();
      if (!effectiveTopic && __userId) {
        try {
          const progress = await getStudyProgress(__userId, { limit: 20 });
          const weakest =
            progress.filter((p) => p.mastery_level < 0.5)[0] ?? progress[0];
          if (weakest) effectiveTopic = weakest.topic;
        } catch { /* non-fatal */ }
      }
      if (!effectiveTopic) {
        return JSON.stringify({
          status: "error",
          message: "Please specify a topic to generate cards, or record some quiz results so I can identify your weak topics.",
        });
      }

      // Ground the cards in the student's own book when available.
      let bookContext = "";
      if (__userId && textbookId) {
        bookContext = await fetchTopicContext(__userId, textbookId, effectiveTopic);
      }

      const numCards = Math.min(count || 5, 15);
      const { generateText } = await import("ai");
      const { getSmallChatModel } = await import("../../../services/ai/small-model.js");
      const model = await getSmallChatModel();
      const { text } = await generateText({
        model,
        prompt: `Create ${numCards} flashcards about the topic: "${effectiveTopic}".
Each card must contain:
- question
- answer

${bookContext
  ? `Focus on these excerpts from the student's own book — the questions and answers must genuinely reflect its content:\n${bookContext}`
  : "Write scientifically accurate cards covering the most important points of the topic."}

Write the cards in the same language as the topic above (Arabic for an Arabic topic, English for an English topic).

Return only a JSON array in this format:
[{"question": "...", "answer": "..."}]`,
        temperature: 0.7,
      });
      const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/\s*```/g, "").trim();
      const cards = JSON.parse(cleaned);
      const validCards = (Array.isArray(cards) ? cards : [])
        .filter(
          (c: unknown): c is { question: string; answer: string } =>
            !!c &&
            typeof c === "object" &&
            typeof (c as { question?: unknown }).question === "string" &&
            (c as { question: string }).question.trim().length > 0 &&
            typeof (c as { answer?: unknown }).answer === "string" &&
            (c as { answer: string }).answer.trim().length > 0
        )
        .slice(0, 15);

      // Persist if userId is available
      let saved = 0;
      if (__userId && validCards.length > 0) {
        try {
          const created = await createFlashcards({
            userId: __userId,
            cards: validCards.map((c: { question: string; answer: string }) => ({
              textbookId,
              courseId,
              topic: effectiveTopic,
              sectionPath,
              question: c.question,
              answer: c.answer,
              source: "ai",
            })),
          });
          saved = created.length;
        } catch (persistErr) {
          // Log but don't fail — cards still returned to user
          console.warn("[flashcards] Persist failed:", (persistErr as Error).message);
        }
      }

      return JSON.stringify({
        status: "success",
        topic: effectiveTopic,
        cards: validCards,
        saved,
        message: saved > 0 ? `${saved} cards saved for later review (SRS).` : "Not saved (login required).",
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "Card generation failed", error: err instanceof Error ? err.message : String(err) });
    }
  },
});