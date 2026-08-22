import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('../routes/chat/chat-shared.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createProviderClient: vi.fn(() => ({
    chat: vi.fn(() => vi.fn()),
  })),
  getProviderAndModel: vi.fn(() => ({ provider: 'openai', modelName: 'gpt-4o' })),
}));

vi.mock('../services/security/file-text-extractor.js', () => ({
  extractTextFromFilePart: vi.fn(),
}));

import { processMessages } from '../services/chat/message-processor.service.js';
import { generateText } from 'ai';
import { extractTextFromFilePart } from '../services/security/file-text-extractor.js';

const mockGenerateText = vi.mocked(generateText);
const mockExtractText = vi.mocked(extractTextFromFilePart);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processMessages', () => {
  describe('basic message mapping', () => {
    it('filters out messages without valid roles', async () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { content: 'No role' },
        { role: undefined, content: 'Undefined role' },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      expect(result.coreMessages).toHaveLength(1);
      expect(result.coreMessages[0].role).toBe('user');
    });

    it('maps string content correctly', async () => {
      const messages = [{ role: 'user', content: 'What is AI?' }];
      const result = await processMessages(messages, 'gpt-4o');
      expect(result.coreMessages[0].content).toBe('What is AI?');
    });

    it('maps object content to string', async () => {
      const messages = [{ role: 'user', content: { text: 'Hello from object' } }];
      const result = await processMessages(messages, 'gpt-4o');
      expect(result.coreMessages[0].content).toBe('Hello from object');
    });

    it('maps object content with content field', async () => {
      const messages = [{ role: 'user', content: { content: 'Nested content' } }];
      const result = await processMessages(messages, 'gpt-4o');
      expect(result.coreMessages[0].content).toBe('Nested content');
    });

    it('serializes unknown object content as JSON', async () => {
      const messages = [{ role: 'user', content: { unknown: 'field' } }];
      const result = await processMessages(messages, 'gpt-4o');
      expect(typeof result.coreMessages[0].content).toBe('string');
    });

    it('uses text field when content is not string or object', async () => {
      const messages = [{ role: 'user', text: 'Fallback text' }];
      const result = await processMessages(messages, 'gpt-4o');
      expect(result.coreMessages[0].content).toBe('Fallback text');
    });

    it('defaults to empty string for missing content', async () => {
      const messages = [{ role: 'user' }];
      const result = await processMessages(messages, 'gpt-4o');
      expect(result.coreMessages[0].content).toBe(' ');
    });
  });

  describe('image detection', () => {
    it('detects image parts with type=image', async () => {
      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'What is this?' },
            { type: 'image', image: 'data:image/png;base64,iVBORw0KGgoAAAANS' },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      expect(result.hasImages).toBe(true);
    });

    it('detects images by mime type', async () => {
      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'Look at this' },
            { mimeType: 'image/jpeg', data: '/9j/4AAQSkZJRg' },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      expect(result.hasImages).toBe(true);
    });

    it('detects images by filename extension', async () => {
      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'Look at this' },
            { filename: 'photo.png', data: 'somebase64data' },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      expect(result.hasImages).toBe(true);
    });

    it('detects PNG base64 images by header', async () => {
      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'Describe' },
            { data: 'iVBORw0KGgoAAAANSUhEUg==' },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      expect(result.hasImages).toBe(true);
    });

    it('detects JPEG base64 images by header', async () => {
      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'Describe' },
            { data: '/9j/4AAQSkZJRg==' },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      expect(result.hasImages).toBe(true);
    });

    it('formats image as data URL with correct mime type', async () => {
      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'Look' },
            { image: 'iVBORw0KGgoAAAANS' },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      const content = result.coreMessages[0].content as Array<any>;
      const imagePart = content.find((p: any) => p.type === 'image');
      expect(imagePart).toBeDefined();
      expect(imagePart.image).toMatch(/^data:image\/.*;base64,/);
    });

    it('returns hasImages false for text-only messages', async () => {
      const messages = [{ role: 'user', content: 'Just text' }];
      const result = await processMessages(messages, 'gpt-4o');
      expect(result.hasImages).toBe(false);
    });
  });

  describe('tool invocations', () => {
    it('maps assistant toolInvocations to toolCalls', async () => {
      const messages = [
        {
          role: 'assistant',
          content: 'Let me search',
          toolInvocations: [
            { toolCallId: 'call-1', toolName: 'web_search', args: { query: 'AI news' }, result: null },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      const msg = result.coreMessages[0] as any;
      expect(msg.toolCalls).toBeDefined();
      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls[0].id).toBe('call-1');
      expect(msg.toolCalls[0].function.name).toBe('web_search');
    });

    it('maps tool role messages to tool-result content then flattens', async () => {
      const messages = [
        {
          role: 'tool',
          content: '',
          toolInvocations: [
            { toolCallId: 'call-1', toolName: 'web_search', result: { results: [] } },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      const msg = result.coreMessages[0];
      expect(msg.role).toBe('tool');
      expect(msg.content).toBeDefined();
    });

    it('defaults toolCallId to call_default when missing', async () => {
      const messages = [
        {
          role: 'assistant',
          content: 'Searching...',
          toolInvocations: [{ toolName: 'search', args: {} }],
        },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      const msg = result.coreMessages[0] as any;
      expect(msg.toolCalls[0].id).toBe('call_default');
    });
  });

  describe('vision analysis fallback', () => {
    it('runs vision analysis for non-vision models', async () => {
      mockGenerateText.mockResolvedValue({ text: 'A cat sitting on a couch' } as any);

      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image', image: 'data:image/png;base64,iVBORw0KGgoAAAANS' },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-3.5-turbo');
      expect(mockGenerateText).toHaveBeenCalled();
      expect(result.hasImages).toBe(false);
      expect(typeof result.coreMessages[0].content).toBe('string');
    });

    it('skips vision analysis for native vision models', async () => {
      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'What is this?' },
            { type: 'image', image: 'data:image/png;base64,iVBORw0KGgoAAAANS' },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      expect(mockGenerateText).not.toHaveBeenCalled();
      expect(result.hasImages).toBe(true);
    });

    it('handles vision analysis failure gracefully', async () => {
      mockGenerateText.mockRejectedValue(new Error('Vision API down'));

      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'What is this?' },
            { type: 'image', image: 'data:image/png;base64,iVBORw0KGgoAAAANS' },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-3.5-turbo');
      expect(result.imageAnalysisFailed).toBe(true);
      expect(result.imageAnalysisError).toBe('Vision API down');
    });

    it('adds fallback text when vision fails with user text', async () => {
      mockGenerateText.mockRejectedValue(new Error('fail'));

      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'Describe this' },
            { type: 'image', image: 'data:image/png;base64,iVBORw0KGgoAAAANS' },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-3.5-turbo');
      expect(typeof result.coreMessages[0].content).toBe('string');
    });
  });

  describe('file extraction', () => {
    it('extracts text from file parts', async () => {
      mockExtractText.mockResolvedValue({ text: 'Extracted file content', truncated: false });

      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'Read this' },
            { type: 'file', data: 'filedata', mimeType: 'text/plain', filename: 'doc.txt' },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      expect(mockExtractText).toHaveBeenCalled();
    });

    it('handles extraction failure gracefully', async () => {
      mockExtractText.mockRejectedValue(new Error('Cannot read file'));

      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'Read this' },
            { type: 'file', data: 'filedata', mimeType: 'text/plain', filename: 'doc.txt' },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      expect(result.coreMessages).toHaveLength(1);
    });
  });

  describe('message flattening', () => {
    it('flattens text-only parts into a single string', async () => {
      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'World' },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      expect(typeof result.coreMessages[0].content).toBe('string');
    });

    it('preserves array content when images are present', async () => {
      const messages = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'Look' },
            { type: 'image', image: 'data:image/png;base64,iVBORw0KGgoAAAANS' },
          ],
        },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      expect(Array.isArray(result.coreMessages[0].content)).toBe(true);
    });
  });

  describe('multiple messages', () => {
    it('processes a conversation with multiple messages', async () => {
      const messages = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'How are you?' },
      ];

      const result = await processMessages(messages, 'gpt-4o');
      expect(result.coreMessages).toHaveLength(4);
      expect(result.coreMessages[0].role).toBe('system');
      expect(result.coreMessages[3].role).toBe('user');
    });

    it('returns empty result for empty messages', async () => {
      const result = await processMessages([], 'gpt-4o');
      expect(result.coreMessages).toHaveLength(0);
      expect(result.hasImages).toBe(false);
    });
  });
});
