import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RankedDoc } from '../services/chat/pipeline/types.js';

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('../services/memory/token-estimator.js', () => ({
  estimateTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
  getModelContextWindow: vi.fn((modelId: string) => {
    const map: Record<string, number> = {
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'gpt-4': 8192,
    };
    return map[modelId] || 8192;
  }),
}));

import {
  truncateRAGSources,
  calculateRAGBudget,
  estimateRAGTokens,
  truncateWithBoundaries,
} from '../services/rag/rag-context-truncator.js';
import { estimateTokens, getModelContextWindow } from '../services/memory/token-estimator.js';

const mockEstimateTokens = vi.mocked(estimateTokens);

function makeDoc(overrides: Partial<RankedDoc> = {}): RankedDoc {
  return {
    id: 'doc-1',
    content: 'This is sample document content for testing RAG truncation.',
    metadata: { source: 'test.pdf' },
    similarity: 0.85,
    rerankScore: 0.9,
    ...overrides,
  };
}

describe('truncateRAGSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEstimateTokens.mockImplementation((text: string) => Math.ceil(text.length / 4));
  });

  it('returns empty result for empty input', () => {
    const result = truncateRAGSources([]);
    expect(result.sources).toEqual([]);
    expect(result.totalOriginalTokens).toBe(0);
    expect(result.totalTruncatedTokens).toBe(0);
    expect(result.utilizationPercent).toBe(0);
    expect(result.contextText).toBe('');
    expect(result.sourceNames).toEqual([]);
  });

  it('returns single source unchanged when within budget', () => {
    const shortContent = 'Hello world';
    mockEstimateTokens.mockReturnValue(3);
    const doc = makeDoc({ content: shortContent });

    const result = truncateRAGSources([doc], {
      totalBudgetTokens: 1000,
      minTokensPerSource: 10,
      maxTokensPerSource: 500,
      headerOverheadTokens: 5,
      strategy: 'proportional',
      preserveBoundaries: true,
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].wasTruncated).toBe(false);
    expect(result.sources[0].truncatedContent).toBe(shortContent);
  });

  it('truncates source when content exceeds budget', () => {
    const longContent = 'Word '.repeat(2000);
    mockEstimateTokens.mockImplementation((text: string) => Math.ceil(text.length / 4));

    const doc = makeDoc({ content: longContent });
    const result = truncateRAGSources([doc], {
      totalBudgetTokens: 200,
      minTokensPerSource: 10,
      maxTokensPerSource: 100,
      headerOverheadTokens: 5,
      strategy: 'proportional',
      preserveBoundaries: false,
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].wasTruncated).toBe(true);
    expect(result.sources[0].truncatedTokens).toBeLessThan(result.sources[0].originalTokens);
  });

  it('distributes budget proportionally between sources', () => {
    const doc1 = makeDoc({ id: 'doc-1', content: 'High similarity doc', similarity: 0.95, rerankScore: 0.95 });
    const doc2 = makeDoc({ id: 'doc-2', content: 'Low similarity doc', similarity: 0.3, rerankScore: 0.3 });

    mockEstimateTokens.mockReturnValue(5);

    const result = truncateRAGSources([doc1, doc2], {
      totalBudgetTokens: 1000,
      minTokensPerSource: 50,
      maxTokensPerSource: 800,
      headerOverheadTokens: 10,
      strategy: 'proportional',
      preserveBoundaries: false,
    });

    expect(result.sources).toHaveLength(2);
    const alloc1 = result.sources[0].truncatedTokens;
    const alloc2 = result.sources[1].truncatedTokens;
    expect(alloc1).toBeGreaterThanOrEqual(alloc2);
  });

  it('uses equal strategy to distribute evenly', () => {
    const doc1 = makeDoc({ id: 'doc-1', content: 'Content A', similarity: 0.9, rerankScore: 0.9 });
    const doc2 = makeDoc({ id: 'doc-2', content: 'Content B', similarity: 0.1, rerankScore: 0.1 });

    mockEstimateTokens.mockReturnValue(5);

    const result = truncateRAGSources([doc1, doc2], {
      totalBudgetTokens: 1000,
      minTokensPerSource: 50,
      maxTokensPerSource: 800,
      headerOverheadTokens: 10,
      strategy: 'equal',
      preserveBoundaries: false,
    });

    expect(result.sources).toHaveLength(2);
  });

  it('uses priority strategy giving most budget to top source', () => {
    const doc1 = makeDoc({ id: 'doc-1', content: 'Top doc', similarity: 0.9, rerankScore: 0.9 });
    const doc2 = makeDoc({ id: 'doc-2', content: 'Other doc', similarity: 0.5, rerankScore: 0.5 });

    mockEstimateTokens.mockReturnValue(5);

    const result = truncateRAGSources([doc1, doc2], {
      totalBudgetTokens: 1000,
      minTokensPerSource: 50,
      maxTokensPerSource: 900,
      headerOverheadTokens: 10,
      strategy: 'priority',
      preserveBoundaries: false,
    });

    expect(result.sources).toHaveLength(2);
    const topAlloc = result.sources.find(s => s.original.id === 'doc-1')!;
    const otherAlloc = result.sources.find(s => s.original.id === 'doc-2')!;
    expect(topAlloc.truncatedTokens).toBeGreaterThanOrEqual(otherAlloc.truncatedTokens);
  });

  it('builds context text with source headers', () => {
    mockEstimateTokens.mockReturnValue(5);
    const doc = makeDoc({ content: 'Test content' });

    const result = truncateRAGSources([doc], {
      totalBudgetTokens: 1000,
      minTokensPerSource: 50,
      maxTokensPerSource: 500,
      headerOverheadTokens: 10,
      strategy: 'proportional',
      preserveBoundaries: false,
    });

    expect(result.contextText).toContain('[Source:');
    expect(result.sourceNames.length).toBe(1);
    expect(result.sourceNames[0]).toContain('test');
  });

  it('extracts source name from source_url metadata', () => {
    mockEstimateTokens.mockReturnValue(5);
    const doc = makeDoc({
      content: 'Content',
      metadata: { source_url: 'https://example.com/article.pdf' },
    });

    const result = truncateRAGSources([doc], {
      totalBudgetTokens: 1000,
      minTokensPerSource: 50,
      maxTokensPerSource: 500,
      headerOverheadTokens: 10,
      strategy: 'proportional',
      preserveBoundaries: false,
    });

    expect(result.sourceNames[0]).toContain('article');
  });

  it('extracts source name from file_name metadata', () => {
    mockEstimateTokens.mockReturnValue(5);
    const doc = makeDoc({
      content: 'Content',
      metadata: { file_name: 'my-document.pdf' },
    });

    const result = truncateRAGSources([doc], {
      totalBudgetTokens: 1000,
      minTokensPerSource: 50,
      maxTokensPerSource: 500,
      headerOverheadTokens: 10,
      strategy: 'proportional',
      preserveBoundaries: false,
    });

    expect(result.sourceNames[0]).toContain('my document');
  });

  it('defaults source name to Knowledge Base when no metadata', () => {
    mockEstimateTokens.mockReturnValue(5);
    const doc = makeDoc({
      content: 'Content',
      metadata: {},
    });

    const result = truncateRAGSources([doc], {
      totalBudgetTokens: 1000,
      minTokensPerSource: 50,
      maxTokensPerSource: 500,
      headerOverheadTokens: 10,
      strategy: 'proportional',
      preserveBoundaries: false,
    });

    expect(result.sourceNames[0]).toBe('Knowledge Base');
  });

  it('strips Textbook: prefix from source name', () => {
    mockEstimateTokens.mockReturnValue(5);
    const doc = makeDoc({
      content: 'Content',
      metadata: { source: 'Textbook: Biology 101.pdf' },
    });

    const result = truncateRAGSources([doc], {
      totalBudgetTokens: 1000,
      minTokensPerSource: 50,
      maxTokensPerSource: 500,
      headerOverheadTokens: 10,
      strategy: 'proportional',
      preserveBoundaries: false,
    });

    expect(result.sourceNames[0]).toBe('Biology 101');
  });

  it('includes page number hint in source name', () => {
    mockEstimateTokens.mockReturnValue(5);
    const doc = makeDoc({
      content: 'Content',
      metadata: { source: 'report.pdf', page_number: 42 },
    });

    const result = truncateRAGSources([doc], {
      totalBudgetTokens: 1000,
      minTokensPerSource: 50,
      maxTokensPerSource: 500,
      headerOverheadTokens: 10,
      strategy: 'proportional',
      preserveBoundaries: false,
    });

    expect(result.sourceNames[0]).toContain('page 42');
  });

  it('calculates utilization percent', () => {
    mockEstimateTokens.mockReturnValue(5);
    const doc = makeDoc({ content: 'Some content' });

    const result = truncateRAGSources([doc], {
      totalBudgetTokens: 1000,
      minTokensPerSource: 50,
      maxTokensPerSource: 500,
      headerOverheadTokens: 10,
      strategy: 'proportional',
      preserveBoundaries: false,
    });

    expect(result.utilizationPercent).toBeGreaterThanOrEqual(0);
    expect(result.utilizationPercent).toBeLessThanOrEqual(100);
  });
});

describe('calculateRAGBudget', () => {
  it('calculates budget for gpt-4o', () => {
    const budget = calculateRAGBudget('gpt-4o', 6000);
    expect(budget).toBeGreaterThanOrEqual(1000);
    expect(typeof budget).toBe('number');
  });

  it('returns minimum 1000 even for small context windows', () => {
    const budget = calculateRAGBudget('gpt-4', 8000);
    expect(budget).toBeGreaterThanOrEqual(1000);
  });
});

describe('estimateRAGTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEstimateTokens.mockImplementation((text: string) => Math.ceil(text.length / 4));
  });

  it('returns total and per-source token counts', () => {
    const docs = [
      makeDoc({ id: '1', content: 'First document', metadata: { source: 'a.pdf' } }),
      makeDoc({ id: '2', content: 'Second document', metadata: { source: 'b.pdf' } }),
    ];

    const result = estimateRAGTokens(docs);
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.perSource).toHaveLength(2);
    expect(result.perSource[0].tokens).toBeGreaterThan(0);
    expect(result.perSource[1].tokens).toBeGreaterThan(0);
  });

  it('returns zero for empty input', () => {
    const result = estimateRAGTokens([]);
    expect(result.totalTokens).toBe(0);
    expect(result.perSource).toEqual([]);
  });

  it('extracts source names correctly', () => {
    const docs = [
      makeDoc({ id: '1', content: 'Content', metadata: { source: 'lecture-notes.pdf' } }),
    ];

    const result = estimateRAGTokens(docs);
    expect(result.perSource[0].sourceName).toContain('lecture notes');
  });
});

describe('truncateWithBoundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEstimateTokens.mockImplementation((text: string) => Math.ceil(text.length / 4));
  });

  it('returns content unchanged when within token limit', () => {
    const text = 'Short text.';
    const result = truncateWithBoundaries(text, 100, true);
    expect(result).toBe(text);
  });

  it('truncates at paragraph boundary when preserveBoundaries is true', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n\nFourth paragraph.';
    const result = truncateWithBoundaries(text, 10, true);
    expect(result).toContain('[...truncated...]');
    expect(result.length).toBeLessThan(text.length);
  });

  it('hard truncates when preserveBoundaries is false', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n\nFourth paragraph.';
    const result = truncateWithBoundaries(text, 5, false);
    expect(result).toContain('[...truncated...]');
    expect(result.length).toBeLessThan(text.length);
  });
});
