import { z } from "zod";
import redis from "../../../config/redis/client.js";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { createFlashcards } from "../../../services/study/flashcards.service.js";
import { getStudyProgress } from "../../../services/study/progress.service.js";
import { fetchTopicContext } from "../../../services/study/quiz-generator.service.js";

createToolMetadata("generate_flashcards", "توليد وحفظ بطاقات تعليمية (Flashcards) من موضوع معين", {
  requiresUserId: true,
  category: "education",
  enabledByDefault: true,
});

const DAILY_GENERATION_QUOTA = 10;

registerTool("generate_flashcards", {
  description: "توليد وحفظ بطاقات تعليمية (Flashcards) من موضوع معين. البطاقات تُحفظ تلقائياً للمراجعة اللاحقة بنظام التكرار المتباعد (SRS). إن لم يحدد الطالب موضوعاً فسيتم استهداف أضعف مواضيعه تلقائياً.",
  inputSchema: z.object({
    topic: z.string().optional().describe("الموضوع المراد توليد بطاقات له. اتركه فارغاً لاستهداف أضعف موضوع عند الطالب تلقائياً"),
    count: z.number().optional().describe("عدد البطاقات المطلوبة (افتراضياً 5، حد أقصى 15)"),
    courseId: z.string().uuid().optional().describe("معرف المادة الدراسية (اختياري)"),
    textbookId: z.string().uuid().optional().describe("معرف الكتاب المدرسي (اختياري)"),
    sectionPath: z.string().optional().describe("مسار القسم/الدرس في الكتاب (اختياري)"),
    __userId: z.string().optional().describe("معرّف المستخدم (يُمرر تلقائياً)"),
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
              message: `وصلت الحد اليومي لتوليد البطاقات (${DAILY_GENERATION_QUOTA} مرات). راجع بطاقاتك الحالية وجرّب غداً.`,
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
          message: "حدد موضوعاً لتوليد البطاقات، أو سجل بعض نتائج الاختبارات حتى أعرف مواضيعك الضعيفة.",
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
        prompt: `أنشئ ${numCards} بطاقة تعليمية (Flashcard) عن موضوع: "${effectiveTopic}".
كل بطاقة تحتوي:
- السؤال (question)
- الجواب (answer)

${bookContext
  ? `اركز على هذه المقاطع من كتاب الطالب نفسه — الأسئلة والأجوبة يجب أن تعكس محتواها فعلياً:\n${bookContext}`
  : "اكتب بطاقات دقيقة علمياً تغطي أهم نقاط الموضوع."}

اكتب البطاقات بنفس لغة الموضوع أعلاه (عربي لموضوع عربي، إنجليزي لموضوع إنجليزي).

ارجع JSON array فقط بالشكل:
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
        message: saved > 0 ? `تم حفظ ${saved} بطاقة للمراجعة اللاحقة (SRS).` : "لم يتم الحفظ (يتطلب تسجيل الدخول).",
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "فشل في توليد البطاقات", error: err instanceof Error ? err.message : String(err) });
    }
  },
});