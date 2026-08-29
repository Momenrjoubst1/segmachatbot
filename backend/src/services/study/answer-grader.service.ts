// Answer grader — closes the quiz loop for the Study Map panel.
//
// The textbook's extracted questions (textbook_questions) ship without stored
// answers, so grading compares the student's answer against their own book via
// RAG retrieval, then a strict LLM grader. Pipeline:
//   1. Retrieve reference excerpts from the student's textbook (best-effort).
//   2. Objective fast-path: a bare numeric answer that appears in the reference
//      is accepted without an LLM call (can only ever output "correct").
//   3. Strict LLM grader (small model, JSON verdict).
//   4. Lexical overlap fallback so the student always gets a verdict.
// The outcome is recorded into study_progress (EMA mastery) exactly like the
// in-chat quiz flow.

import { z } from "zod";
import { generateText } from "ai";
import { createLogger } from "../../utils/logger.js";
import { generateEmbedding } from "../rag/embedding-service.js";
import { searchTextbookChunks } from "../textbook/textbook-search.js";
import { recordQuizResult } from "./progress.service.js";
import { getSmallChatModel } from "../ai/small-model.js";

const log = createLogger("study:answer-grader");

export const GRADER_VERDICTS = ["correct", "partial", "incorrect"] as const;
export type GraderVerdict = (typeof GRADER_VERDICTS)[number];

const graderResponseSchema = z.object({
  verdict: z.enum(GRADER_VERDICTS),
  score: z.number().min(0).max(1),
  feedback: z.string().min(1).max(2000),
  model_answer: z.string().min(1).max(4000),
  missed_points: z.array(z.string().max(500)).max(10).default([]),
});

export type ParsedGraderResponse = z.infer<typeof graderResponseSchema>;

export interface GradeAnswerInput {
  userId: string;
  question: string;
  studentAnswer: string;
  topic: string;
  courseId?: string;
  textbookId?: string;
  sectionPath?: string;
}

export interface GradeAnswerResult {
  verdict: GraderVerdict;
  score: number;
  feedback: string;
  modelAnswer: string;
  missedPoints: string[];
  gradedBy: "objective" | "llm" | "lexical-fallback";
  correct: boolean;
  masteryLevel: number | null;
  recorded: boolean;
}

// ─── Reference retrieval ─────────────────────────────────────────────────────────

const MAX_REFERENCE_CHARS = 4000;

async function fetchReferenceContext(
  userId: string,
  textbookId: string | undefined,
  question: string
): Promise<string> {
  if (!textbookId) return "";
  try {
    const queryEmbedding = await generateEmbedding(question);
    if (!queryEmbedding) return "";

    const docs = await searchTextbookChunks({
      userId,
      textbookId,
      query: question,
      queryEmbedding,
      matchCount: 4,
    });
    if (!docs || docs.length === 0) return "";

    return docs
      .map((d) => `[صفحة ${d.page_number}]\n${d.content}`)
      .join("\n\n")
      .slice(0, MAX_REFERENCE_CHARS);
  } catch (err) {
    log.warn("Reference retrieval failed; grading without book context", {
      error: (err as Error).message,
      userId,
      textbookId,
    });
    return "";
  }
}

// ─── Objective numeric fast-path ────────────────────────────────────────────────

/** Extract numbers from text, normalizing Arabic-Indic digits and decimal commas. */
export function extractNumbers(text: string): string[] {
  const normalized = text.replace(/[\u0660-\u0669]/g, (d) =>
    String(d.charCodeAt(0) - 0x0660)
  );
  return (normalized.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((m) => m.replace(",", "."));
}

/** True when the student answered with a single bare number (short free-form). */
export function isBareNumericAnswer(studentAnswer: string): boolean {
  const trimmed = studentAnswer.trim();
  if (trimmed.length === 0 || trimmed.length > 20) return false;
  const nums = extractNumbers(trimmed);
  if (nums.length !== 1) return false;
  // Reject answers that are a number plus extra words ("سنة 1967 تقريبا").
  const stripped = trimmed.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  return stripped.replace(/-?\d+(?:\.\d+)?/g, "").trim().length === 0;
}

/**
 * Accept a bare numeric answer only when the number appears in the retrieved
 * reference. Deliberately one-directional: it can confirm "correct" but never
 * "incorrect" — a non-matching number falls through to the LLM grader.
 */
export function attemptNumericGrade(
  studentAnswer: string,
  reference: string
): ParsedGraderResponse | null {
  if (!isBareNumericAnswer(studentAnswer) || !reference) return null;

  const answerNum = extractNumbers(studentAnswer)[0];
  const referenceNums = new Set(extractNumbers(reference));
  if (!referenceNums.has(answerNum)) return null;

  return {
    verdict: "correct",
    score: 1,
    feedback: "إجابة صحيحة — الرقم مطابق لما ورد في الكتاب.",
    model_answer: answerNum,
    missed_points: [],
  };
}

// ─── Lexical fallback ────────────────────────────────────────────────────────────

/** Normalize Arabic/English text for lexical comparison. */
export function normalizeForLexicalMatch(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, "") // diacritics + tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Jaccard token overlap in [0, 1]. */
export function lexicalOverlapScore(a: string, b: string): number {
  const ta = new Set(normalizeForLexicalMatch(a));
  const tb = new Set(normalizeForLexicalMatch(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const token of ta) if (tb.has(token)) intersection++;
  return intersection / (ta.size + tb.size - intersection);
}

function lexicalFallback(studentAnswer: string, reference: string): GradeAnswerResult {
  const score = reference
    ? lexicalOverlapScore(studentAnswer, reference)
    : 0;
  const verdict: GraderVerdict = score >= 0.5 ? "correct" : score >= 0.25 ? "partial" : "incorrect";
  return {
    verdict,
    score: Math.round(score * 100) / 100,
    feedback:
      verdict === "incorrect"
        ? "لم نتمكن من الوصول إلى المصحّح الذكي، فتم تقدير إجابتك مطابقتها اللفظية مع الكتاب. راجع الإجابة النموذجية أدناه."
        : "تم تقدير إجابتك مطابقتها اللفظية مع الكتاب (المصحّح الذكي غير متوفر حالياً).",
    modelAnswer: reference ? reference.slice(0, 600) : "",
    missedPoints: [],
    gradedBy: "lexical-fallback",
    correct: verdict === "correct",
    masteryLevel: null,
    recorded: false,
  };
}

// ─── LLM grader ──────────────────────────────────────────────────────────────────

/** Strip code fences and any prose around the grader's JSON, then validate. */
export function parseGraderResponse(text: string): ParsedGraderResponse {
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/\s*```/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const raw = jsonMatch ? jsonMatch[0] : cleaned;
  return graderResponseSchema.parse(JSON.parse(raw));
}

const GRADER_PROMPT = `أنت مصحّح إجابات محايد وصارم لطلاب. قيّم إجابة الطالب على السؤال التالي.

قواعد التصحيح:
- قارن إجابة الطالب بالنص المرجعي من كتابه إن وُجد. الإجابة الصحيحة المعنى ولو بصياغة مختلفة تُعد صحيحة.
- الإجابة التي تشمل بعض النقاط فقط أو فيها خطأ بسيط = partial مع score بين 0.3 و 0.7.
- الإجابة الخاطئة أو خارج الموضوع = incorrect مع score أقل من 0.3.
- اكتب feedback بلغة الطالب نفسها، بجملة أو جملتين: وضّح الخطأ بلطف وشجّعه.
- model_answer: الإجابة النموذجية الكاملة والصحيحة.
- missed_points: أهم النقاط التي فاتت إجابة الطالب (بحد أقصى 5، فارغة إن كانت الإجابة صحيحة).

أعد JSON فقط بهذا الشكل بدون أي نص إضافي:
{"verdict":"correct|partial|incorrect","score":0.0,"feedback":"...","model_answer":"...","missed_points":["..."]}

## السؤال
{{QUESTION}}

## إجابة الطالب
{{STUDENT_ANSWER}}

## النص المرجعي من الكتاب
{{REFERENCE}}`;

async function runLLMGrader(
  question: string,
  studentAnswer: string,
  reference: string
): Promise<ParsedGraderResponse> {
  const model = await getSmallChatModel();
  const prompt = GRADER_PROMPT.replace("{{QUESTION}}", question)
    .replace("{{STUDENT_ANSWER}}", studentAnswer)
    .replace("{{REFERENCE}}", reference || "(غير متوفر — صحّح اعتماداً على المعرفة العلمية للسؤال نفسه)");

  // Two parse attempts: the second reminds the model to emit JSON only.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text } = await generateText({
        model,
        prompt: attempt === 0 ? prompt : `${prompt}\n\nتذكير: أعد JSON فقط بدون أي نص حوله.`,
        temperature: 0.1,
        maxOutputTokens: 800,
      });
      return parseGraderResponse(text);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Grader LLM failed");
}

// ─── Main entry ──────────────────────────────────────────────────────────────────

async function recordOutcome(
  input: GradeAnswerInput,
  correct: boolean
): Promise<{ masteryLevel: number | null; recorded: boolean }> {
  try {
    const row = await recordQuizResult({
      userId: input.userId,
      topic: input.topic,
      correct,
      courseId: input.courseId,
      textbookId: input.textbookId,
    });
    return { masteryLevel: row.mastery_level, recorded: true };
  } catch (err) {
    log.error("Failed to record graded answer into study progress", {
      error: (err as Error).message,
      userId: input.userId,
      topic: input.topic,
    });
    return { masteryLevel: null, recorded: false };
  }
}

/**
 * Grade a student's free-form answer and record the outcome.
 * Never throws — always returns a verdict (LLM failures degrade to lexical).
 */
export async function gradeAnswer(input: GradeAnswerInput): Promise<GradeAnswerResult> {
  const { userId, question, studentAnswer, topic } = input;

  if (!studentAnswer.trim()) {
    return {
      verdict: "incorrect",
      score: 0,
      feedback: "الإجابة فارغة — جرّب مرة أخرى.",
      modelAnswer: "",
      missedPoints: [],
      gradedBy: "objective",
      correct: false,
      masteryLevel: null,
      recorded: false,
    };
  }

  const reference = await fetchReferenceContext(userId, input.textbookId, question);

  const numeric = attemptNumericGrade(studentAnswer, reference);
  if (numeric) {
    const outcome = await recordOutcome(input, true);
    return {
      verdict: numeric.verdict,
      score: numeric.score,
      feedback: numeric.feedback,
      modelAnswer: numeric.model_answer,
      missedPoints: numeric.missed_points,
      gradedBy: "objective",
      correct: true,
      masteryLevel: outcome.masteryLevel,
      recorded: outcome.recorded,
    };
  }

  try {
    const parsed = await runLLMGrader(question, studentAnswer, reference);
    const correct = parsed.verdict === "correct" || (parsed.verdict === "partial" && parsed.score >= 0.5);
    const outcome = await recordOutcome(input, correct);
    log.info("Answer graded by LLM", { userId, topic, verdict: parsed.verdict, score: parsed.score });
    return {
      verdict: parsed.verdict,
      score: parsed.score,
      feedback: parsed.feedback,
      modelAnswer: parsed.model_answer,
      missedPoints: parsed.missed_points,
      gradedBy: "llm",
      correct,
      masteryLevel: outcome.masteryLevel,
      recorded: outcome.recorded,
    };
  } catch (err) {
    log.warn("LLM grader failed; using lexical fallback", {
      error: (err as Error).message,
      userId,
      topic,
    });
    return lexicalFallback(studentAnswer, reference);
  }
}
