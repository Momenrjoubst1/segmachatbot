import { describe, it, expect } from 'vitest';
import {
  extractText,
  extractTextFromMessage,
  extractTextFromFilePart,
} from '../utils/message-utils/extract-text.js';

describe('extractText', () => {
  it('returns string content directly', () => {
    expect(extractText('hello')).toBe('hello');
  });

  it('joins text parts from an array', () => {
    const content = [
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ];
    expect(extractText(content)).toBe('hello world');
  });

  it('filters out non-text parts (e.g. images)', () => {
    const content = [
      { type: 'image', url: 'img.png' },
      { type: 'text', text: 'visible' },
      { type: 'image', url: 'img2.png' },
    ];
    expect(extractText(content)).toBe('visible');
  });

  it('handles text parts with missing text field', () => {
    const content = [
      { type: 'text' },
      { type: 'text', text: 'ok' },
    ];
    expect(extractText(content)).toBe(' ok');
  });

  it('returns empty string for empty array', () => {
    expect(extractText([])).toBe('');
  });

  it('returns empty string for non-string non-array content', () => {
    expect(extractText(undefined as unknown)).toBe('');
  });
});

describe('extractTextFromMessage', () => {
  it('extracts from string content', () => {
    expect(extractTextFromMessage({ role: 'user', content: 'hi' })).toBe('hi');
  });

  it('extracts from array of text parts', () => {
    const msg = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    };
    expect(extractTextFromMessage(msg)).toBe('a b');
  });

  it('filters non-text parts', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'file', data: 'blob' },
        { type: 'text', text: 'hello' },
      ],
    };
    expect(extractTextFromMessage(msg)).toBe('hello');
  });

  it('returns empty string for non-string non-array content', () => {
    expect(extractTextFromMessage({ role: 'user', content: null as unknown })).toBe('');
  });
});

describe('extractTextFromFilePart', () => {
  it('returns data from file type parts', () => {
    expect(extractTextFromFilePart({ type: 'file', data: 'some data' })).toBe('some data');
  });

  it('returns empty string for non-file type', () => {
    expect(extractTextFromFilePart({ type: 'image', data: 'blob' })).toBe('');
  });

  it('returns empty string when data is missing', () => {
    expect(extractTextFromFilePart({ type: 'file' })).toBe('');
  });
});
