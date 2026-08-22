import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { recordQuizResult } from "../../../services/study/progress.service.js";

createToolMetadata("record_quiz_result", "تسجيل نتيجة سؤال اختبار/مراجعة لتتبع تقدم الطالب", {
  requiresUserId: true,
  category: "education",
  enabledByDefault: true,
});

registerTool("record_quiz_result", {
  description: "سجّل نتيجة إجابة الطالب على سؤال اختبار/مراجعة. استخدم هذا بعد تقييم إجابة الطالب لتحديد المواضيع الضعيفة وتحديث تقدمه الدراسي.",
  inputSchema: z.object({
    topic: z.string().describe("الموضوع/الدرس الذي سُئل عنه السؤال (مثال: 'الدوال في بايثون', 'التفاضل والتكامل')"),
    correct: z.boolean().describe("هل أجاب الطالب بشكل صحيح؟"),
    courseId: z.string().uuid().optional().describe("معرف المادة الدراسية (اختياري)"),
    textbookId: z.string().uuid().optional().describe("معرف الكتاب المدرسي (اختياري)"),
    __userId: z.string().optional().describe("معرّف المستخدم (يُمرر تلقائياً)"),
  }),
  execute: async ({
    topic,
    correct,
    courseId,
    textbookId,
    __userId,
  }: {
    topic: string;
    correct: boolean;
    courseId?: string;
    textbookId?: string;
    __userId?: string;
  }) => {
    if (!__userId) {
      return JSON.stringify({ status: "error", message: "يتطلب تسجيل الدخول" });
    }
    try {
      const result = await recordQuizResult({
        userId: __userId,
        topic,
        correct,
        courseId,
        textbookId,
      });
      return JSON.stringify({
        status: "success",
        topic,
        correct,
        masteryLevel: result.mastery_level,
        message: correct
          ? "تم تسجيل الإجابة الصحيحة. تقدم جيد!"
          : "تم تسجيل الإجابة الخاطئة. هذا الموضوع يحتاج مراجعة.",
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "فشل في تسجيل النتيجة", error: err instanceof Error ? err.message : String(err) });
    }
  },
});