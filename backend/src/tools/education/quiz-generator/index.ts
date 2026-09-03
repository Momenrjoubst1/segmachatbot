import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { generateQuizQuestions, DIFFICULTIES } from "../../../services/study/quiz-generator.service.js";

createToolMetadata("generate_quiz", "Generate quiz questions from the student's textbook at a difficulty level suited to their progress", {
  requiresUserId: true,
  category: "education",
  enabledByDefault: true,
});

registerTool("generate_quiz", {
  description: "Generate quiz questions on a specific topic from the student's own textbook. Difficulty adapts automatically to the student's mastery level (or set it yourself). Use the tool, then quiz the student one question at a time and grade their answers.",
  inputSchema: z.object({
    topic: z.string().describe("The topic to be tested on (e.g. 'Newton's laws')"),
    count: z.number().int().min(1).max(10).optional().describe("Number of questions (default 5)"),
    difficulty: z.enum(["auto", "easy", "medium", "hard"]).optional().describe("Difficulty — auto picks based on the student's progress (default auto)"),
    textbookId: z.string().uuid().optional().describe("Textbook ID (optional)"),
    courseId: z.string().uuid().optional().describe("Course ID (optional)"),
    __userId: z.string().optional().describe("User ID (passed automatically)"),
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
      return JSON.stringify({ status: "error", message: "Login required" });
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
          "Quiz the student with one question at a time and wait for their answer before the next question. " +
          "Grade each answer against the model answer, and immediately after each grading call record_quiz_result " +
          `with topic="${quiz.topic}" and correct=<true/false>. Do not reveal the model answer before the student attempts.`,
      });
    } catch (err: unknown) {
      return JSON.stringify({
        status: "error",
        message: "Question generation failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});

export { DIFFICULTIES };
