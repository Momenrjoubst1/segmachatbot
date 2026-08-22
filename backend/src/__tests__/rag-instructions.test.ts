import { describe, it, expect } from 'vitest';
import { buildRAGInstructions, type RAGOptions } from '../prompts/rag-instructions.js';

describe('RAG Instructions', () => {
  const baseOptions: RAGOptions = {
    hasContext: true,
    contextText: '[Source: Doc1.pdf] This is test content from document 1.\n[Source: Doc2.pdf] This is test content from document 2.',
    sourceNames: ['Doc1.pdf', 'Doc2.pdf'],
    retrievalMethod: 'hybrid',
  };

  it('should return fallback note when no context', () => {
    const result = buildRAGInstructions({ ...baseOptions, hasContext: false, contextText: '' });
    
    expect(result).toContain('No specific knowledge base context was found');
    expect(result).toContain('general persona');
  });

  it('should include retrieval method label for hybrid', () => {
    const result = buildRAGInstructions(baseOptions);
    
    expect(result).toContain('hybrid (semantic + keyword)');
  });

  it('should include retrieval method label for bm25', () => {
    const result = buildRAGInstructions({ ...baseOptions, retrievalMethod: 'bm25' });
    
    expect(result).toContain('keyword search');
  });

  it('should include retrieval method label for vector', () => {
    const result = buildRAGInstructions({ ...baseOptions, retrievalMethod: 'vector' });
    
    expect(result).toContain('semantic search');
  });

  it('should include mandatory citation format', () => {
    const result = buildRAGInstructions(baseOptions);
    
    expect(result).toContain('Citation Format (MANDATORY)');
    expect(result).toContain('[Source: DocumentName]');
    expect(result).toContain('inline citation');
  });

  it('should include sources formatting section', () => {
    const result = buildRAGInstructions(baseOptions);
    
    expect(result).toContain('Sources Formatting (STRICTLY REQUIRED)');
    expect(result).toContain('المصادر المعتمدة');
    expect(result).toContain('Cleaned Document Name');
  });

  it('should include provided context', () => {
    const result = buildRAGInstructions(baseOptions);
    
    expect(result).toContain('Provided Context');
    expect(result).toContain(' السياق المقدم');
    expect(result).toContain('Doc1.pdf');
    expect(result).toContain('Doc2.pdf');
  });

  it('should include all retrieval method types', () => {
    const methods: RAGOptions['retrievalMethod'][] = ['vector', 'bm25', 'hybrid', 'structure_scope', 'curriculum'];
    
    for (const method of methods) {
      const result = buildRAGInstructions({ ...baseOptions, retrievalMethod: method });
      expect(result).toContain('RAG Rules');
    }
  });

  it('should not be empty when context exists', () => {
    const result = buildRAGInstructions(baseOptions);
    expect(result.length).toBeGreaterThan(500);
  });
});