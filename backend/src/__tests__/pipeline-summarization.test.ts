import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('../routes/chat/chat-shared.js', () => ({
  memLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/memory/summarizer.service.js', () => ({
  summarizer: {
    summarizeMessages: vi.fn().mockResolvedValue({
      summary: 'Test summary',
      tokensEstimate: 50,
      cacheHash: 'abc123',
    }),
  },
}));

vi.mock('../services/memory/streaming-summarizer.js', () => ({
  shouldTriggerStreamingSummary: vi.fn().mockResolvedValue({ shouldTrigger: false }),
  streamingSummarizer: {
    updateStreamingSummary: vi.fn().mockResolvedValue({
      summary: 'Streaming summary',
      tokensEstimate: 30,
      isIncremental: true,
      newMessagesProcessed: 5,
      totalMessages: 10,
    }),
    generateInitialStreamingSummary: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../services/memory/context-cache.service.js', () => ({
  contextCache: {
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../config/memory.config.js', () => ({
  MemoryConfig: {
    contextWindow: {
      maxMessages: 50,
      keepFirstMessages: 5,
      keepLastMessages: 40,
      minMessagesForSummary: 12,
    },
    summarization: {
      enabled: true,
      model: 'gpt-4o-mini',
      maxSummaryTokens: 500,
      messagesPerSummary: 10,
      minMessageLength: 10,
    },
    caching: { enabled: true },
    debug: { enabled: false },
  },
}));

vi.mock('../services/memory/token-estimator.js', () => ({
  estimateTokens: vi.fn(() => 10),
  getContextWindowStatus: vi.fn(),
  calculateTrimPlan: vi.fn(),
}));

vi.mock('../utils/message-utils/extract-text.js', () => ({
  extractText: vi.fn((c: any) => (typeof c === 'string' ? c : '')),
}));

import { manageContextWindow } from '../services/chat/pipeline/summarization.js';
import { getContextWindowStatus, calculateTrimPlan } from '../services/memory/token-estimator.js';
import { shouldTriggerStreamingSummary, streamingSummarizer } from '../services/memory/streaming-summarizer.js';
import { summarizer } from '../services/memory/summarizer.service.js';

const mockGetContextWindowStatus = vi.mocked(getContextWindowStatus);
const mockCalculateTrimPlan = vi.mocked(calculateTrimPlan);
const mockShouldTriggerStreamingSummary = vi.mocked(shouldTriggerStreamingSummary);
const mockStreamingSummarizer = vi.mocked(streamingSummarizer);
const mockSummarizer = vi.mocked(summarizer);

function msgs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `Message ${i}`,
  }));
}

beforeEach(() => {
  mockGetContextWindowStatus.mockReturnValue({
    totalTokens: 1000,
    maxTokens: 128000,
    usagePercent: 1,
    shouldSummarize: false,
    urgency: 'ok' as const,
    recommendation: 'keep_all' as const,
    modelId: 'gpt-4o-mini',
    modelName: 'gpt-4o-mini',
  });
  mockCalculateTrimPlan.mockReturnValue({
    keepFirst: 5,
    keepLast: 5,
    summarizeMiddle: 0,
    estimatedTokensAfter: 100,
    summarizeIndices: [],
    keepIndices: [0, 1, 2, 3, 4],
  });
  mockShouldTriggerStreamingSummary.mockResolvedValue({ shouldTrigger: false });
  mockStreamingSummarizer.updateStreamingSummary.mockResolvedValue({
    summary: 'Streaming summary',
    tokensEstimate: 30,
    isIncremental: true,
    newMessagesProcessed: 5,
    totalMessages: 10,
  });
  mockStreamingSummarizer.generateInitialStreamingSummary.mockResolvedValue(undefined);
  mockSummarizer.summarizeMessages.mockResolvedValue({
    summary: 'Test summary',
    tokensEstimate: 50,
    cacheHash: 'abc123',
  });
});

describe('manageContextWindow', () => {
  it('returns messages unchanged when no summarization needed', async () => {
    const coreMessages = msgs(3);
    const result = await manageContextWindow({
      coreMessages,
      userId: 'user-1',
    });
    expect(result.finalMessages).toEqual(coreMessages);
    expect(result.conversationSummary).toBe('');
  });

  it('returns messages unchanged when tokens below 70%', async () => {
    mockGetContextWindowStatus.mockReturnValue({
      totalTokens: 50000,
      maxTokens: 128000,
      usagePercent: 39,
      shouldSummarize: false,
      urgency: 'ok',
      recommendation: 'keep_all',
      modelId: 'gpt-4o-mini',
      modelName: 'gpt-4o-mini',
    });

    const result = await manageContextWindow({
      coreMessages: msgs(10),
      userId: 'user-1',
    });
    expect(result.finalMessages).toHaveLength(10);
  });

  it('triggers streaming summary when shouldTrigger is true and usage is low', async () => {
    mockShouldTriggerStreamingSummary.mockResolvedValue({ shouldTrigger: true });

    const coreMessages = msgs(3);
    const result = await manageContextWindow({
      coreMessages,
      userId: 'user-1',
    });

    expect(mockStreamingSummarizer.updateStreamingSummary).toHaveBeenCalled();
    expect(result.conversationSummary).toBe('Streaming summary');
  });

  it('returns messages when streaming summary trigger is false', async () => {
    mockShouldTriggerStreamingSummary.mockResolvedValue({ shouldTrigger: false });

    const result = await manageContextWindow({
      coreMessages: msgs(3),
      userId: 'user-1',
    });
    expect(result.finalMessages).toHaveLength(3);
    expect(result.conversationSummary).toBe('');
  });

  it('uses streaming summary when token usage exceeds 70%', async () => {
    mockGetContextWindowStatus.mockReturnValue({
      totalTokens: 100000,
      maxTokens: 128000,
      usagePercent: 78,
      shouldSummarize: true,
      urgency: 'warning',
      recommendation: 'summarize_middle',
      modelId: 'gpt-4o-mini',
      modelName: 'gpt-4o-mini',
    });
    mockCalculateTrimPlan.mockReturnValue({
      keepFirst: 2,
      keepLast: 2,
      summarizeMiddle: 6,
      estimatedTokensAfter: 100,
      summarizeIndices: [2, 3, 4, 5, 6, 7],
      keepIndices: [0, 1, 8, 9],
    });
    mockStreamingSummarizer.updateStreamingSummary.mockResolvedValue({
      summary: 'Detailed streaming summary that is long enough to trigger the incremental path of 100 plus characters threshold',
      tokensEstimate: 80,
      isIncremental: true,
      newMessagesProcessed: 6,
      totalMessages: 10,
    });

    const coreMessages = msgs(10);
    const result = await manageContextWindow({
      coreMessages,
      userId: 'user-1',
    });

    expect(result.conversationSummary).toBe('Detailed streaming summary that is long enough to trigger the incremental path of 100 plus characters threshold');
  });

  it('falls back to batch summarization when streaming fails', async () => {
    mockGetContextWindowStatus.mockReturnValue({
      totalTokens: 100000,
      maxTokens: 128000,
      usagePercent: 78,
      shouldSummarize: true,
      urgency: 'warning',
      recommendation: 'summarize_middle',
      modelId: 'gpt-4o-mini',
      modelName: 'gpt-4o-mini',
    });
    mockCalculateTrimPlan.mockReturnValue({
      keepFirst: 2,
      keepLast: 2,
      summarizeMiddle: 6,
      estimatedTokensAfter: 100,
      summarizeIndices: [2, 3, 4, 5, 6, 7],
      keepIndices: [0, 1, 8, 9],
    });
    mockStreamingSummarizer.updateStreamingSummary.mockRejectedValue(new Error('stream failed'));

    const coreMessages = msgs(10);
    const result = await manageContextWindow({
      coreMessages,
      userId: 'user-1',
    });

    expect(result.conversationSummary).toBe('Test summary');
    expect(result.finalMessages.length).toBeLessThanOrEqual(10);
  });

  it('returns messages unchanged when summarizeMiddle is 0', async () => {
    mockGetContextWindowStatus.mockReturnValue({
      totalTokens: 100000,
      maxTokens: 128000,
      usagePercent: 78,
      shouldSummarize: true,
      urgency: 'warning',
      recommendation: 'summarize_middle',
      modelId: 'gpt-4o-mini',
      modelName: 'gpt-4o-mini',
    });
    mockCalculateTrimPlan.mockReturnValue({
      keepFirst: 10,
      keepLast: 0,
      summarizeMiddle: 0,
      estimatedTokensAfter: 100,
      summarizeIndices: [],
      keepIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    });

    const coreMessages = msgs(10);
    const result = await manageContextWindow({
      coreMessages,
      userId: 'user-1',
    });
    expect(result.finalMessages).toEqual(coreMessages);
  });

  it('passes selectedModel to getContextWindowStatus', async () => {
    await manageContextWindow({
      coreMessages: msgs(2),
      userId: 'user-1',
      selectedModel: 'gpt-4o',
    });

    expect(mockGetContextWindowStatus).toHaveBeenCalledWith(
      expect.any(Array),
      'gpt-4o',
    );
  });
});
