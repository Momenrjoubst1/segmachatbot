import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { recordQuizResult } from "../../../services/study/progress.service.js";

createToolMetadata("record_quiz_result", "Record quiz/review question results to track student progress", {
  requiresUserId: true,
  category: "education",
  enabledByDefault: true,
});

registerTool("record_quiz_result", {
  description: "Record the student's answer result for a quiz/review question. Use this after grading the student's answer to identify weak topics and update their study progress.",
  inputSchema: z.object({
    topic: z.string().describe("The topic/lesson the question was about (e.g. 'Functions in Python', 'Calculus')"),
    correct: z.boolean().describe("Did the student answer correctly?"),
    courseId: z.string().uuid().optional().describe("Course ID (optional)"),
    textbookId: z.string().uuid().optional().describe("Textbook ID (optional)"),
    __userId: z.string().optional().describe("User ID (passed automatically)"),
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
      return JSON.stringify({ status: "error", message: "Login required" });
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
          ? "Correct answer recorded. Good progress!"
          : "Incorrect answer recorded. This topic needs review.",
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "Result recording failed", error: err instanceof Error ? err.message : String(err) });
    }
  },
});