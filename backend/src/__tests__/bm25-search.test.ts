import { describe, it, expect } from 'vitest';
import { BM25Search } from '../services/rag/bm25-search.js';

describe('BM25 Search', () => {
  const docs = [
    { id: 1, content: 'Machine learning is a subset of artificial intelligence', metadata: { source: 'doc1' } },
    { id: 2, content: 'Deep learning uses neural networks with many layers', metadata: { source: 'doc2' } },
    { id: 3, content: 'Natural language processing deals with text and speech', metadata: { source: 'doc3' } },
    { id: 4, content: 'Computer vision processes images and videos', metadata: { source: 'doc4' } },
    { id: 5, content: 'Reinforcement learning trains agents through rewards', metadata: { source: 'doc5' } },
  ];

  describe('Build', () => {
    it('should build index from documents', () => {
      const search = new BM25Search(docs);
      expect(search).toBeDefined();
    });

    it('should handle empty document list', () => {
      const search = new BM25Search([]);
      const results = search.search('test');
      expect(results).toEqual([]);
    });
  });

  describe('Search', () => {
    it('should return relevant documents', () => {
      const search = new BM25Search(docs);
      const results = search.search('machine learning');
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].doc.content).toContain('Machine learning');
    });

    it('should rank more relevant documents higher', () => {
      const search = new BM25Search(docs);
      const results = search.search('neural networks');
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].doc.content).toContain('neural networks');
    });

    it('should respect topK parameter', () => {
      const search = new BM25Search(docs);
      const results = search.search('learning', 2);
      
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should return empty for no matches', () => {
      const search = new BM25Search(docs);
      const results = search.search('xyz123nonexistent');
      
      expect(results).toEqual([]);
    });

    it('should handle Arabic text', () => {
      const arabicDocs = [
        { id: 1, content: 'الذكاء الاصطناعي هو مجال في علوم الحاسوب', metadata: {} },
        { id: 2, content: 'تعلم الآلة هو فرع من الذكاء الاصطناعي', metadata: {} },
      ];
      
      const search = new BM25Search(arabicDocs);
      const results = search.search('الذكاء الاصطناعي');
      
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle mixed language queries', () => {
      const search = new BM25Search(docs);
      const results = search.search('machine تعلم');
      
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Tokenization', () => {
    it('should filter stop words', () => {
      const search = new BM25Search(docs);
      // "the" and "is" are stop words
      const results = search.search('the is');
      
      expect(results).toEqual([]);
    });

    it('should normalize text', () => {
      const search = new BM25Search(docs);
      const results = search.search('MACHINE LEARNING');
      
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
