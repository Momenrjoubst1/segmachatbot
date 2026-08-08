import { z } from "zod";
import { registerTool } from "../../tool-registry.js";

registerTool("generate_flashcards", {
  description: "توليد بطاقات تعليمية (Flashcards) من موضوع معين. استخدم لمساعدة المستخدم في الدراسة والمراجعة.",
  inputSchema: z.object({
    topic: z.string().describe("الموضوع المراد توليد بطاقات له"),
    count: z.number().optional().describe("عدد البطاقات المطلوبة (افتراضياً 5، حد أقصى 15)"),
  }),
  execute: async ({ topic, count }: { topic: string; count?: number }) => {
    try {
      const numCards = Math.min(count || 5, 15);
      const { generateText } = await import("ai");
      let model: any;
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
      return JSON.stringify({ status: "success", topic, cards: Array.isArray(cards) ? cards.slice(0, 15) : [] });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "فشل في توليد البطاقات", error: err instanceof Error ? err.message : String(err) });
    }
  },
});
