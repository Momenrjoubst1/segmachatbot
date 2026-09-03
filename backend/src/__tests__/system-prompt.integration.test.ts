import { describe, it, expect, vi } from 'vitest';
import { assembleSystemPrompt } from '../services/chat/pipeline/system-prompt.js';

// initTools() never runs in the test env; provide a minimal registry so the
// tool-only system prompt contract is exercised.
vi.mock('../tools/tool-definitions-aggregator.js', () => ({
  getToolDefinitions: () => ({ calculator: {}, create_calendar_event: {} }),
}));

describe('assembleSystemPrompt — Integration (A/B + metrics)', () => {
  it('should return default variant when no userId', () => {
    const res = assembleSystemPrompt({
      ragContext: undefined,
      userCoursesContext: '',
      memoryPrompt: '',
    });
    expect(res.promptVariant).toBe('default');
    expect(res.systemPrompt).toBe('');
    expect(res.promptLength).toBe(0);
    expect(res.promptTokensEstimate).toBe(0);
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
    expect(res.systemPrompt).toBe('');
    expect(res.basePersona).toContain('Keep responses under 200 words');
  });

  it('should keep RAG and memory out of the prompt but report them in metrics', () => {
    const res = assembleSystemPrompt({
      ragContext: { hasContext: true, contextText: '[Source: Test.pdf] hello', sourceNames: ['Test.pdf'], retrievalMethod: 'hybrid' },
      userCoursesContext: 'Courses: CS101',
      memoryPrompt: 'Memory: user likes concise answers',
      userId: 'user-123',
    });
    expect(res.systemPrompt).toBe('');
    expect(res.promptLength).toBe(0);
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
