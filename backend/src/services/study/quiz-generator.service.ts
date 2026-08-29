// Adaptive quiz generator — writes questions from the student's own textbook
// chunks at a difficulty matched to their mastery, instead of only serving the
// book's static question list. The book's own questions stay available via the
// chat quiz flow; this service powers the generate_quiz tool.

import { z } from "zod";
import { generateText } from "ai";
import { createLogger } from "../../utils/logger.js";
import { generateEmbedding } from "../rag/embedding-service.js";
import { searchTextbookChunks } from "../textbook/textbook-search.js";
import { getTopicMastery } from "./progress.service.js";
import { getSmallChatModel } from "../ai/small-model.js";

const log = createLogger("study:quiz-generator");

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

/** Map mastery (0..1) to a recommended difficulty. No data → medium. */
export function difficultyFromMastery(mastery: number | null): Difficulty {
  if (mastery === null) return "medium";
  if (mastery < 0.35) return "easy";
  if (mastery < 0.7) return "medium";
  return "hard";
}

const questionSchema = z.object({
  question: z.string().min(3).max(1500),
  model_answer: z.string().min(1).max(3000),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  page_number: z.number().int().positive().nullable().default(null),
});
export type GeneratedQuestion = z.infer<typeof questionSchema>;

const batchSchema = z.object({
  questions: z.array(questionSchema).min(1).max(10),
});

const MAX_CONTEXT_CHARS = 3500;

const GENERATION_PROMPT = `أنت معلم خبير. اكتب {{COUNT}} سؤالاً عن موضوع: "{{TOPIC}}".

مستوى الصعوبة المطلوب: {{DIFFICULTY}}.
- easy: أسئلة مباشرة قصيرة تختبر الفهم الأساسي.
- medium: أسئلة تطبيقية تربط مفهومين.
- hard: أسئلة تحليلية/متعددة الخطوات أو مسائل حل.

{{CONTEXT_INSTRUCTION}}

لكل سؤال: السؤال (question)، الإجابة النموذجية الكاملة (model_answer)، الصعوبة (difficulty)، رقم الصفحة من المقاطع إن وُجد (page_number أو null).

اكتب باللغة نفسها التي كُتب بها الموضوع. أعد JSON فقط بالشكل:
{"questions":[{"question":"...","model_answer":"...","difficulty":"easy","page_number":12}]}`;

async function fetchBookContext(
  userId: string,
  textbookId: string | undefined,
  topic: string
): Promise<string> {
  if (!textbookId) return "";
  try {
    const queryEmbedding = await generateEmbedding(topic);
    if (!queryEmbedding) return "";
    const docs = await searchTextbookChunks({
      userId,
      textbookId,
      query: topic,
      queryEmbedding,
      matchCount: 6,
    });
    if (!docs || docs.length === 0) return "";
    return docs
      .map((d) => `[صفحة ${d.page_number}]\n${d.content}`)
      .join("\n\n")
      .slice(0, MAX_CONTEXT_CHARS);
  } catch (err) {
    log.warn("Quiz generation book context failed", {
      error: (err as Error).message,
      userId,
      textbookId,
    });
    return "";
  }
}

export interface GenerateQuizInput {
  userId: string;
  topic: string;
  textbookId?: string;
  courseId?: string;
  count?: number;
  /** "auto" resolves from the student's mastery for the topic. */
  difficulty?: Difficulty | "auto";
}

export interface GeneratedQuiz {
  topic: string;
  difficulty: Difficulty;
  masteryLevel: number | null;
  fromBook: boolean;
  questions: GeneratedQuestion[];
}

export async function generateQuizQuestions(input: GenerateQuizInput): Promise<GeneratedQuiz> {
  const { userId, topic, textbookId, courseId: _courseId } = input;
  const count = Math.min(Math.max(input.count ?? 5, 1), 10);

  const masteryLevel = await getTopicMastery(userId, topic);
  const difficulty: Difficulty =
    !input.difficulty || input.difficulty === "auto"
      ? difficultyFromMastery(masteryLevel)
      : input.difficulty;

  const context = await fetchBookContext(userId, textbookId, topic);

  const prompt = GENERATION_PROMPT.replace("{{COUNT}}", String(count))
    .replace(/\{\{TOPIC\}\}/g, topic)
    .replace("{{DIFFICULTY}}", difficulty)
    .replace(
      "{{CONTEXT_INSTRUCTION}}",
      context
        ? `اركز على هذه المقاطع من كتاب الطالب نفسه، ويمكن أن تسأل عن تفاصيل وردت فيها فقط:\n${context}`
        : "لا توجد مقاطع من الكتاب — اكتب أسئلة قياسية للموضوع من معرفتك العلمية."
    );

  const model = await getSmallChatModel();
  const { text } = await generateText({
    model,
    prompt,
    temperature: 0.4,
    maxOutputTokens: 1400,
  });

  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/\s*```/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Quiz generator returned no JSON");
  const parsed = batchSchema.parse(JSON.parse(jsonMatch[0]));

  log.info("Quiz questions generated", {
    userId,
    topic,
    difficulty,
    count: parsed.questions.length,
    fromBook: !!context,
  });

  return {
    topic,
    difficulty,
    masteryLevel,
    fromBook: !!context,
    questions: parsed.questions.slice(0, count),
  };
}
