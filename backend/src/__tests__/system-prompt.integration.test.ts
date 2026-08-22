import { describe, it, expect } from 'vitest';
import { assembleSystemPrompt } from '../services/chat/pipeline/system-prompt.js';

describe('assembleSystemPrompt — Integration (A/B + metrics)', () => {
  it('should return default variant when no userId', () => {
    const res = assembleSystemPrompt({
      ragContext: undefined,
      userCoursesContext: '',
      memoryPrompt: '',
    });
    expect(res.promptVariant).toBe('default');
    expect(res.systemPrompt).toContain('Sigma');
    expect(res.promptLength).toBeGreaterThan(500);
    expect(res.promptTokensEstimate).toBeGreaterThan(100);
    expect(res.buildTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should respect forceVariant', () => {
    const res = assembleSystemPrompt({
      ragContext: undefined,
      userCoursesContext: '',
      memoryPrompt: '',
      forceVariant: 'concise',
    });
    expect(res.promptVariant).toBe('concise');
    expect(res.systemPrompt).toContain('Keep responses under 200 words');
    expect(res.basePersona).toContain('Keep responses under 200 words');
  });

  it('should include RAG and memory in metrics', () => {
    const res = assembleSystemPrompt({
      ragContext: { hasContext: true, contextText: '[Source: Test.pdf] hello', sourceNames: ['Test.pdf'], retrievalMethod: 'hybrid' },
      userCoursesContext: 'Courses: CS101',
      memoryPrompt: 'Memory: user likes concise answers',
      userId: 'user-123',
    });
    expect(res.systemPrompt).toContain('Test.pdf');
    expect(res.systemPrompt).toContain('Courses: CS101');
    expect(res.promptLength).toBe(res.systemPrompt.length);
  });

  it('should assign variant deterministically via env auto when AB_ENABLED', () => {
    const original = process.env.PROMPT_AB_ENABLED;
    process.env.PROMPT_AB_ENABLED = 'true';
    const a = assembleSystemPrompt({ ragContext: undefined, userCoursesContext: '', memoryPrompt: '', userId: 'u1' });
    const b = assembleSystemPrompt({ ragContext: undefined, userCoursesContext: '', memoryPrompt: '', userId: 'u1' });
    expect(a.promptVariant).toBe(b.promptVariant);
    process.env.PROMPT_AB_ENABLED = original;
  });
});
