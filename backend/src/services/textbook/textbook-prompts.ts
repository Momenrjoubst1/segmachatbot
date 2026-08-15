export const TEXTBOOK_SYSTEM_PROMPT_ADDITION = `
## Textbook Grounding Rules (when answering from a student's uploaded textbook)

You are answering from the student's own uploaded textbook. Follow these rules strictly:

1. **ANSWER ONLY FROM RETRIEVED EXCERPTS.** Never use your general knowledge to answer.
   If the retrieved excerpts don't contain the answer, say:
   "This information was not found in this section of your textbook."

2. **CITE YOUR SOURCES.** For every factual claim, cite the page number:
   - "According to page 142..." or "(page 142)"

3. **CITE FIGURES.** When referencing a figure, use the exact caption:
   - "As shown in Figure 6.1: The Glycolysis Pathway (page 98)..."

4. **STAY WITHIN SCOPE.** If the question is about a specific chapter/section,
   only use content from that section unless the question explicitly asks for
   connections to other parts of the book.

5. **DO NOT HALLUCINATE.** If you're unsure, say so. Never fabricate page numbers,
   figure numbers, or content that isn't in the retrieved excerpts.

6. **USE THE STUDENT'S LANGUAGE.** Answer in the same language as the question.
`;

const DEFAULT_MAX_CONTEXT_CHARS = 16000; // Allows 4-5 page chunks in context

export function buildTextbookContext(
  chunks: Array<{
    content: string;
    page_number: number;
    structure_path: string;
    figure_refs?: any[];
  }>,
  figures: Array<{
    figure_id: string;
    page_number: number;
    caption: string;
    image_url: string;
  }>,
  sectionTitle?: string,
  maxContextChars: number = DEFAULT_MAX_CONTEXT_CHARS
): string {
  const parts: string[] = [];

  if (sectionTitle) {
    parts.push(`[Searching in section: ${sectionTitle}]\n`);
  }

  parts.push("--- Retrieved Textbook Content ---\n");

  let totalChars = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (totalChars + chunk.content.length > maxContextChars) {
      break;
    }
    const pathInfo = chunk.structure_path ? ` [${chunk.structure_path}]` : "";
    parts.push(`[Excerpt ${i + 1}: page ${chunk.page_number}${pathInfo}]`);
    parts.push(chunk.content);
    parts.push("");
    totalChars += chunk.content.length;
  }

  if (figures.length > 0) {
    parts.push("--- Available Figures ---\n");
    for (const fig of figures) {
      parts.push(`[Figure: ${fig.figure_id} on page ${fig.page_number}]`);
      parts.push(`Caption: ${fig.caption}`);
      parts.push(`Image URL: ${fig.image_url}`);
      parts.push("");
    }
  }

  return parts.join("\n");
}
