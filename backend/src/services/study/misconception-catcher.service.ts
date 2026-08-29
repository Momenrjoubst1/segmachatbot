// Weak-point capture from ordinary chat.
//
// study_progress only used to advance through the explicit quiz flow. This
// catcher adds a second, conservative signal: a light judge inspects the
// student's message (plus the tutor's previous reply) and, when it clearly
// reveals a misconception about a specific topic, records a single negative
// outcome. Asking questions is never treated as mastery — no positive records
// come from ordinary chat. A per-user hourly Redis quota bounds the cost.

import redis from "../../config/redis/client.js";
import { createLogger } from "../../utils/logger.js";
import { generateText } from "ai";
import { getSmallChatModel } from "../ai/small-model.js";
import { z } from "zod";
import { recordQuizResult } from "./progress.service.js";

const log = createLogger("study:misconception-catcher");

const JUDGE_QUOTA_PER_HOUR = 20;
const MIN_MESSAGE_CHARS = 15;

const judgeSchema = z.object({
  misunderstood: z.boolean(),
  topic: z.string().max(200).default(""),
});

/** Parse and validate the judge's JSON reply. Exported for the eval suite. */
export function parseJudgeResponse(text: string): z.infer<typeof judgeSchema> {
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/\s*```/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Judge returned no JSON");
  return judgeSchema.parse(JSON.parse(jsonMatch[0]));
}

const JUDGE_PROMPT = `أنت محلل تعليمي. قرر هل تكشف رسالة الطالب عن سوء فهم واضح لموضوع دراسي محدد (مثلاً: "يعني الجذور دايماً تكون موجبة؟"، "يعني نيوتن اكتشف الجاذبية في الفضاء؟").

- رسالة عادية تطلب شرحاً أو معلومة (مثلاً: "اشرح لي قانون نيوتن الأول") ليست سوء فهم.
- اعتبرها سوء فهم فقط إذا كان الطالب يتبنّى فكرة خاطئة أو يستنتج خطأً من كلامك السابق.
- topic: اسم الموضوع الدراسي باختصار بنفس لغة الطالب.

أعد JSON فقط:
{"misunderstood": false, "topic": ""}`;

/** Run the misconception judge on a single message (exported for the eval suite). */
export async function judgeMisconception(studentMessage: string, tutorAnswer: string): Promise<z.infer<typeof judgeSchema>> {
  const model = await getSmallChatModel();
  const { text } = await generateText({
    model,
    temperature: 0,
    maxOutputTokens: 120,
    prompt: `${JUDGE_PROMPT}

## كلام السابق من المساعد (قد يكون فارغاً)
${(tutorAnswer || "").slice(0, 1500)}

## رسالة الطالب الآن
${studentMessage.slice(0, 1500)}`,
  });
  return parseJudgeResponse(text);
}

export interface MisconceptionInput {
  userId: string;
  studentMessage: string;
  tutorAnswer: string;
}

async function checkQuota(userId: string): Promise<boolean> {
  try {
    const bucket = Math.floor(Date.now() / 3_600_000);
    const key = `study:misjudge:${userId}:${bucket}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3599);
    return count <= JUDGE_QUOTA_PER_HOUR;
  } catch (err) {
    log.warn("Quota check failed; skipping capture", { error: (err as Error).message });
    return false;
  }
}

/**
 * Judge the student's message for a revealed misconception and record it.
 * Fire-and-forget safe: never throws, never blocks the caller.
 */
export async function maybeCaptureMisconception(input: MisconceptionInput): Promise<void> {
  const { userId, studentMessage, tutorAnswer } = input;

  if (!userId || !studentMessage || studentMessage.trim().length < MIN_MESSAGE_CHARS) return;
  if (!(await checkQuota(userId))) return;

  try {
    const parsed = await judgeMisconception(studentMessage, tutorAnswer);

    if (!parsed.misunderstood || !parsed.topic.trim()) return;

    await recordQuizResult({ userId, topic: parsed.topic.trim(), correct: false });
    log.info("Misconception captured from ordinary chat", { userId, topic: parsed.topic.trim() });
  } catch (err) {
    log.warn("Misconception capture failed (non-fatal)", { error: (err as Error).message });
  }
}
