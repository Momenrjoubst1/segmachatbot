/**
 * RAG Context Layer - تعليمات السياق المسترجع
 *
 * Builds RAG instructions and injects retrieved context into the system prompt.
 * Handles the case where no context is found gracefully.
 */

export interface RAGOptions {
  /** Whether RAG context was retrieved */
  hasContext: boolean;
  /** The actual context text from retrieved documents */
  contextText: string;
  /** Cleaned source document names */
  sourceNames: string[];
  /** Which retrieval method was used */
  retrievalMethod: 'vector' | 'bm25' | 'hybrid' | 'structure_scope' | 'curriculum';
}

/**
 * Builds the RAG instructions layer.
 * When no context is found, returns a brief note so the model
 * falls back to its general persona without wasting tokens.
 */
export function buildRAGInstructions(options: RAGOptions): string {
  if (!options.hasContext) {
    return '(Note: No specific knowledge base context was found. Answer based on your general persona.)';
  }

  const methodLabel =
    options.retrievalMethod === 'hybrid'
      ? 'hybrid (semantic + keyword)'
      : options.retrievalMethod === 'bm25'
        ? 'keyword search'
        : 'semantic search';

  return `# RAG Rules — تعليمات السياق المسترجع

You have access to a private knowledge base (retrieved via ${methodLabel}). You MUST use the provided context below to answer the user's queries.
If the answer is NOT found in the context below, you must politely inform the user that you don't have that specific information in your current documents, but you can still help them generally based on your roles above.

## Citation Format (MANDATORY) — تنسيق الاستشهاد الإلزامي

Every factual claim derived from the provided context MUST include an inline citation using this exact format:
\`[Source: DocumentName]\`

Place the citation immediately after the sentence or claim it supports. Example:
"The Sigma platform launched in 2024 [Source: PlatformHistory.pdf] and serves 50,000+ students [Source: UserStats.docx]."

## Sources Formatting (STRICTLY REQUIRED) — تنسيق المصادر

At the very end of your response, you MUST always append a beautifully formatted, professional "Sources" section exactly matching this Markdown template:

---
### 📚 المصادر المعتمدة (Sources):
- 📄 **[Cleaned Document Name 1]**
- 📄 **[Cleaned Document Name 2]**

*Rules for Sources:*
1. Extract the document names exactly from the \`[Source: ...]\` tags in the context.
2. Only list sources that you ACTUALLY used to formulate the answer.
3. Remove duplicates from the sources list.

## Provided Context — السياق المقدم

${options.contextText}`;
}