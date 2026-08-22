import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('../../routes/chat/chat-shared.js', () => ({
  ragLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/chat/intent-detector.js', () => ({
  detectIntent: vi.fn(),
  UserIntent: {
    KNOWLEDGE_QUERY: 'knowledge_query',
    TOOL_REQUEST: 'tool_request',
    SMALL_TALK: 'small_talk',
    FOLLOW_UP: 'follow_up',
    PERSONAL_QUERY: 'personal_query',
  },
}));

import { detectUserIntent } from '../services/chat/pipeline/intent.js';
import { detectIntent, UserIntent } from '../services/chat/intent-detector.js';

const mockDetectIntent = vi.mocked(detectIntent);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeUserMsg(text: string) {
  return { role: 'user' as const, content: text };
}

function makeAssistantMsg(text: string) {
  return { role: 'assistant' as const, content: text };
}

describe('detectUserIntent', () => {
  it('returns default when no user messages exist', async () => {
    const result = await detectUserIntent(
      [{ role: 'assistant', content: 'Hello' }],
      'user-1',
    );
    expect(result.intent).toBe(UserIntent.KNOWLEDGE_QUERY);
    expect(result.needsRAG).toBe(true);
    expect(mockDetectIntent).not.toHaveBeenCalled();
  });

  it('returns default when messages array is empty', async () => {
    const result = await detectUserIntent([], 'user-1');
    expect(result.intent).toBe(UserIntent.KNOWLEDGE_QUERY);
    expect(mockDetectIntent).not.toHaveBeenCalled();
  });

  it('extracts text from last user message and calls detectIntent', async () => {
    mockDetectIntent.mockResolvedValue({
      intent: UserIntent.SMALL_TALK,
      confidence: 0.92,
      needsRAG: false,
      needsTools: false,
    });

    const messages = [
      makeAssistantMsg('Hi there'),
      makeUserMsg('Hello!'),
    ];

    const result = await detectUserIntent(messages, 'user-1');

    expect(mockDetectIntent).toHaveBeenCalledWith('Hello!', expect.any(Array), { userId: 'user-1' });
    expect(result.intent).toBe(UserIntent.SMALL_TALK);
    expect(result.needsRAG).toBe(false);
  });

  it('extracts text from content parts array', async () => {
    mockDetectIntent.mockResolvedValue({
      intent: UserIntent.KNOWLEDGE_QUERY,
      confidence: 0.78,
      needsRAG: true,
      needsTools: false,
    });

    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text', text: 'What is calculus?' },
          { type: 'image', image: 'data:...' },
        ],
      },
    ];

    const result = await detectUserIntent(messages, 'user-1');

    expect(mockDetectIntent).toHaveBeenCalledWith(
      'What is calculus?',
      expect.any(Array),
      { userId: 'user-1' },
    );
    expect(result.needsRAG).toBe(true);
  });

  it('finds the last user message among mixed roles', async () => {
    mockDetectIntent.mockResolvedValue({
      intent: UserIntent.TOOL_REQUEST,
      confidence: 0.88,
      needsRAG: false,
      needsTools: true,
    });

    const messages = [
      makeUserMsg('First question'),
      makeAssistantMsg('Answer 1'),
      makeUserMsg('Send an email'),
    ];

    await detectUserIntent(messages, 'user-1');

    expect(mockDetectIntent).toHaveBeenCalledWith(
      'Send an email',
      expect.any(Array),
      { userId: 'user-1' },
    );
  });

  it('returns default when user message has empty text content', async () => {
    const messages = [
      { role: 'user' as const, content: '' },
    ];

    const result = await detectUserIntent(messages, 'user-1');
    expect(result.intent).toBe(UserIntent.KNOWLEDGE_QUERY);
    expect(mockDetectIntent).not.toHaveBeenCalled();
  });

  it('returns default when detectIntent throws', async () => {
    mockDetectIntent.mockRejectedValue(new Error('boom'));

    const result = await detectUserIntent([makeUserMsg('Hello')], 'user-1');
    expect(result.intent).toBe(UserIntent.KNOWLEDGE_QUERY);
    expect(result.needsRAG).toBe(true);
  });

  it('passes recent messages history to detectIntent', async () => {
    mockDetectIntent.mockResolvedValue({
      intent: UserIntent.FOLLOW_UP,
      confidence: 0.82,
      needsRAG: true,
      needsTools: false,
    });

    const messages = [
      makeAssistantMsg('Previous answer'),
      makeUserMsg('What about the other one?'),
    ];

    await detectUserIntent(messages, 'user-1');

    const [, recentMessages] = mockDetectIntent.mock.calls[0];
    expect(recentMessages).toHaveLength(2);
    expect(recentMessages[0].role).toBe('assistant');
    expect(recentMessages[1].role).toBe('user');
  });
});
