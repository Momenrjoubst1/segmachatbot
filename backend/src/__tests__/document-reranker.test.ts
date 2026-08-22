import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('../../config/constants.js', () => ({
  RERANKER_CONFIG: {
    COHERE_API_KEY: '',
    COHERE_RERANK_MODEL: 'rerank-multilingual-v3.0',
    RAG_RERANKER_PROVIDER: 'token-overlap',
    ENABLE_TEXTBOOK_RERANK: true,
  },
}));

import { warmUpReranker, rerankDocuments, rerankWithCohere } from '../services/rag/document-reranker.js';

beforeEach(() => {
  vi.clearAllMocks();
});

function makeDoc(id: string | number, content: string, similarity = 0.5) {
  return {
    id,
    content,
    metadata: { source: 'test' },
    similarity,
    rerankScore: 0,
  };
}

describe('warmUpReranker', () => {
  it('completes without error', async () => {
    await expect(warmUpReranker()).resolves.toBeUndefined();
  });
});

describe('rerankDocuments', () => {
  it('returns empty array for empty input', async () => {
    const result = await rerankDocuments('test', []);
    expect(result).toEqual([]);
  });

  it('returns the single document without reranking', async () => {
    const doc = makeDoc(1, 'Machine learning basics');
    const result = await rerankDocuments('machine learning', [doc]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('reranks by token overlap and sorts by score', async () => {
    const docs = [
      makeDoc(1, 'The quick brown fox jumps over the lazy dog'),
      makeDoc(2, 'Machine learning is a subset of artificial intelligence'),
      makeDoc(3, 'Natural language processing uses machine learning algorithms'),
    ];

    const result = await rerankDocuments('machine learning', docs);

    expect(result).toHaveLength(3);
    expect(result[0].rerankScore).toBeGreaterThanOrEqual(result[1].rerankScore);
    expect(result[1].rerankScore).toBeGreaterThanOrEqual(result[2].rerankScore);
  });

  it('limits results to topK', async () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      makeDoc(i, `Document number ${i} about topic ${i}`),
    );

    const result = await rerankDocuments('topic', docs, 3);
    expect(result).toHaveLength(3);
  });

  it('preserves document metadata through reranking', async () => {
    const doc = makeDoc(1, 'Test document content about search');
    doc.metadata = { source: 'wikipedia', file_name: 'test.pdf' };

    const result = await rerankDocuments('search', [doc]);
    expect(result[0].metadata.source).toBe('wikipedia');
    expect(result[0].metadata.file_name).toBe('test.pdf');
  });

  it('gives higher score to more relevant documents', async () => {
    const docs = [
      makeDoc(1, 'Cooking recipes for dinner'),
      makeDoc(2, 'Deep learning neural network architectures'),
      makeDoc(3, 'Supervised learning classification algorithms'),
    ];

    const result = await rerankDocuments('deep learning neural network', docs);

    expect(result[0].content).toContain('Deep learning');
  });
});

describe('rerankWithCohere', () => {
  it('returns ranked results with text and score', async () => {
    const texts = [
      'Introduction to machine learning',
      'How to cook pasta',
      'Deep learning fundamentals',
    ];

    const result = await rerankWithCohere('machine learning', texts);

    expect(result).toHaveLength(3);
    for (const item of result) {
      expect(item).toHaveProperty('text');
      expect(item).toHaveProperty('score');
      expect(typeof item.score).toBe('number');
    }
  });

  it('respects topK parameter', async () => {
    const texts = ['A', 'B', 'C', 'D', 'E'];
    const result = await rerankWithCohere('test', texts, 2);
    expect(result).toHaveLength(2);
  });
});
