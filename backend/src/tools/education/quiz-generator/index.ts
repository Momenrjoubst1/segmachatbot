import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { generateQuizQuestions, DIFFICULTIES } from "../../../services/study/quiz-generator.service.js";

createToolMetadata("generate_quiz", "توليد أسئلة اختبار من كتاب الطالب بمستوى صعوبة مناسب لتقدمه", {
  requiresUserId: true,
  category: "education",
  enabledByDefault: true,
});

registerTool("generate_quiz", {
  description: "ولّد أسئلة اختبار عن موضوع محدد من كتاب الطالب نفسه. الصعوبة تتكيف تلقائياً مع مستوى تمكن الطالب (أو حددها بنفسك). استخدم الأداة ثم اختبر الطالب سؤالاً بسؤال وصحح إجاباته.",
  inputSchema: z.object({
    topic: z.string().describe("الموضوع المطلوب الاختبار فيه (مثال: 'قوانين نيوتن')"),
    count: z.number().int().min(1).max(10).optional().describe("عدد الأسئلة (افتراضياً 5)"),
    difficulty: z.enum(["auto", "easy", "medium", "hard"]).optional().describe("الصعوبة — auto يختار حسب تقدم الطالب (افتراضياً auto)"),
    textbookId: z.string().uuid().optional().describe("معرف الكتاب المدرسي (اختياري)"),
    courseId: z.string().uuid().optional().describe("معرف المادة الدراسية (اختياري)"),
    __userId: z.string().optional().describe("معرّف المستخدم (يُمرر تلقائياً)"),
  }),
  execute: async ({
    topic,
    count,
    difficulty,
    textbookId,
    courseId,
    __userId,
  }: {
    topic: string;
    count?: number;
    difficulty?: "auto" | "easy" | "medium" | "hard";
    textbookId?: string;
    courseId?: string;
    __userId?: string;
  }) => {
    if (!__userId) {
      return JSON.stringify({ status: "error", message: "يتطلب تسجيل الدخول" });
    }
    try {
      const quiz = await generateQuizQuestions({
        userId: __userId,
        topic,
        count,
        difficulty,
        textbookId,
        courseId,
      });
      return JSON.stringify({
        status: "success",
        topic: quiz.topic,
        difficulty: quiz.difficulty,
        mastery_level: quiz.masteryLevel,
        from_book: quiz.fromBook,
        questions: quiz.questions,
        tutor_instruction:
          "اختبر الطالب سؤالاً واحداً في كل مرة، وانتظر إجابته قبل السؤال التالي. " +
          "قيّم كل إجابة مقارنةً بالإجابة النموذجية، وبعد كل تقييم استدعِ record_quiz_result فوراً " +
          `مع topic="${quiz.topic}" و correct=<true/false>. لا تعرض الإجابة النموذجية قبل محاولة الطالب.`,
      });
    } catch (err: unknown) {
      return JSON.stringify({
        status: "error",
        message: "فشل في توليد الأسئلة",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});

export { DIFFICULTIES };
