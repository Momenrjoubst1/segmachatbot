import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import type { LanguageModel } from "ai";
import { createFlashcards } from "../../../services/study/flashcards.service.js";

createToolMetadata("generate_flashcards", "توليد وحفظ بطاقات تعليمية (Flashcards) من موضوع معين", {
  requiresUserId: true,
  category: "education",
  enabledByDefault: true,
});

registerTool("generate_flashcards", {
  description: "توليد وحفظ بطاقات تعليمية (Flashcards) من موضوع معين. البطاقات تُحفظ تلقائياً للمراجعة اللاحقة بنظام التكرار المتباعد (SRS).",
  inputSchema: z.object({
    topic: z.string().describe("الموضوع المراد توليد بطاقات له"),
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
    topic: string;
    count?: number;
    courseId?: string;
    textbookId?: string;
    sectionPath?: string;
    __userId?: string;
  }) => {
    try {
      const numCards = Math.min(count || 5, 15);
      const { generateText } = await import("ai");
      let model: LanguageModel;
      try {
        const { google } = await import("@ai-sdk/google");
        model = google("gemini-2.0-flash-lite");
      } catch {
        const { createOpenAI } = await import("@ai-sdk/openai");
        model = createOpenAI({
          baseURL: "https://models.inference.ai.azure.com",
          apiKey: process.env.GITHUB_TOKEN || "",
        }).chat("gpt-4o-mini");
      }
      const { text } = await generateText({
        model,
        prompt: `أنشئ ${numCards} بطاقة تعليمية (Flashcard) عن موضوع: "${topic}".
كل بطاقة تحتوي:
- السؤال (question)
- الجواب (answer)

ارجع JSON array فقط بالشكل:
[{"question": "...", "answer": "..."}]

اجعل البطاقات مناسبة للطلاب الجامعيين.`,
        temperature: 0.7,
      });
      const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/\s*```/g, "").trim();
      const cards = JSON.parse(cleaned);
      const validCards = Array.isArray(cards) ? cards.slice(0, 15) : [];

      // Persist if userId is available
      let saved = 0;
      if (__userId && validCards.length > 0) {
        try {
          const created = await createFlashcards({
            userId: __userId,
            cards: validCards.map((c: { question: string; answer: string }) => ({
              textbookId,
              courseId,
              topic,
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
        topic,
        cards: validCards,
        saved,
        message: saved > 0 ? `تم حفظ ${saved} بطاقة للمراجعة اللاحقة (SRS).` : "لم يتم الحفظ (يتطلب تسجيل الدخول).",
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "فشل في توليد البطاقات", error: err instanceof Error ? err.message : String(err) });
    }
  },
});