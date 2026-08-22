import { generateText } from "ai";
import { createLogger } from "../../utils/logger.js";

const log = createLogger('memory-extractor');

interface ExtractedFact {
  key: string;
  value: unknown;
  category: "preference" | "fact" | "academic" | "behavior";
}

const EXTRACTION_PROMPT = `You are a memory extraction AI. Given a conversation between a user and an assistant, extract important facts about the user that should be remembered across sessions.

Focus on:
1. **Academic**: courses they're taking, majors, study habits, academic goals
2. **Preferences**: how they like responses (detailed/short), language preference, formatting preferences
3. **Personal facts**: their name, interests, location (only if explicitly shared)
4. **Behavior**: common questions they ask, their expertise level in different topics

Return a JSON array of objects with:
- key: a snake_case identifier (e.g. "user_major", "preferred_language", "courses_taken")
- value: the fact value (can be string, number, array, or object)
- category: one of "academic", "preference", "fact", "behavior"

Only extract facts that:
- Are explicitly stated or very clearly implied
- Would be useful for personalizing future responses
- Are NOT obvious one-time queries ("user asked about math homework today")
- Are NOT sensitive personal information (passwords, contact details, etc.)

If nothing worth remembering, return an empty array [].

Conversation:
`;
const MAX_EXTRACTIONS = 6;

export async function extractFacts(
  messages: { role: string; content: string }[],
  existingKeys: Set<string>
): Promise<ExtractedFact[]> {
  if (messages.length < 6) return [];

  const recentMessages = messages.slice(-10);
  const conversationText = recentMessages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  try {
    const { text } = await generateText({
      model: await getExtractionModel(),
      prompt: EXTRACTION_PROMPT + conversationText,
      temperature: 0.3,
    });

    const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/\s*```/g, "").trim();
    const facts: ExtractedFact[] = JSON.parse(cleaned);

    if (!Array.isArray(facts)) return [];

    return facts
      .filter((f) => f.key && f.value && !existingKeys.has(f.key))
      .slice(0, MAX_EXTRACTIONS);
  } catch (err) {
    log.warn("Extraction failed", { err });
    return [];
  }
}

async function getExtractionModel() {
  try {
    const { google } = await import("@ai-sdk/google");
    return google("gemini-2.0-flash-lite");
  } catch (googleErr) {
    log.warn('Google AI SDK unavailable, trying OpenAI', { error: (googleErr as Error)?.message });
    try {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI().chat("gpt-4o-mini");
    } catch (openaiErr) {
      log.warn('OpenAI SDK unavailable, falling back to GitHub models', { error: (openaiErr as Error)?.message });
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({
        baseURL: "https://models.inference.ai.azure.com",
        apiKey: process.env.GITHUB_TOKEN || "",
      }).chat("gpt-4o-mini");
    }
  }
}
