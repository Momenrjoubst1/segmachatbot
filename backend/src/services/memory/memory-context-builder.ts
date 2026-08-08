import { getMemory, setMemory, getCustomInstructions } from "./memory-repository.js";
import { extractFacts } from "./memory-fact-extractor.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger('memory-manager');

export interface MemoryContext {
  facts: string;
  customInstructions: string;
}

let extractionCounter = new Map<string, number>();

export async function buildMemoryContext(userId: string): Promise<MemoryContext> {
  const [memoryEntries, customInstructions] = await Promise.all([
    getMemory(userId),
    getCustomInstructions(userId),
  ]);

  let facts = "";
  if (memoryEntries.length > 0) {
    const grouped = groupByCategory(memoryEntries);
    const parts: string[] = [];
    for (const [category, entries] of Object.entries(grouped)) {
      const labels: Record<string, string> = {
        academic: "📚 Academic Information",
        preference: "🎯 User Preferences",
        fact: "ℹ️ Personal Facts",
        behavior: "🧠 Behavioral Patterns",
      };
      parts.push(`**${labels[category] || category}:**`);
      for (const entry of entries) {
        const val = typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value);
        parts.push(`- ${entry.key.replace(/_/g, " ")}: ${val}`);
      }
    }
    facts = parts.join("\n");
  }

  return { facts, customInstructions };
}

export async function tryExtractAndStore(
  userId: string,
  messages: { role: string; content: string }[],
  threadId?: string
): Promise<void> {
  const count = extractionCounter.get(userId) || 0;
  if (messages.length < 6) return;
  if (count >= 3) return;

  const existing = await getMemory(userId);
  const existingKeys = new Set(existing.map((e) => e.key));

  const facts = await extractFacts(messages, existingKeys);
  if (facts.length === 0) return;

  extractionCounter.set(userId, count + 1);

  for (const fact of facts) {
    await setMemory(userId, fact.key, fact.value, fact.category, threadId);
  }

  log.info(`Extracted ${facts.length} new facts`, { userId });
}

export function resetExtractionCounter(userId: string): void {
  extractionCounter.set(userId, 0);
}

function groupByCategory(entries: any[]): Record<string, any[]> {
  const grouped: Record<string, any[]> = {};
  for (const entry of entries) {
    const cat = entry.category || "fact";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(entry);
  }
  return grouped;
}
