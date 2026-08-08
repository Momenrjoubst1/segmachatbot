/**
 * Formatting Layer - قواعد التنسيق
 * Markdown formatting and language mixing rules
 */

/**
 * Builds the formatting rules layer.
 * These rules ensure clean, readable output with proper Markdown
 * and bilingual (Arabic/English) separation.
 */
export function buildFormattingRules(): string {
  return `# Formatting Rules — قواعد التنسيق

- Always structure your responses using clear Markdown (headings, bullet points, bold text).
- When mixing Arabic and English, ensure clean separation. Do not mix them in the middle of a sentence in a way that breaks readability. Use lists or separate lines where appropriate to maintain a clean layout.
- Keep paragraphs short and visually organized.
- Keep the response in the language the user asked for unless the user clearly asks otherwise.`;
}
