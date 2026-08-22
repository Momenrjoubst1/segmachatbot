import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Moderation Fail-Closed Behavior', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.MODERATION_FAIL_OPEN;
    delete process.env.MODERATION_FAIL_CLOSED;
    // vitest sets NODE_ENV=test, which forces fail-closed.
    // For FAIL_OPEN tests, we need to remove this.
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should export moderateInput and moderateOutput functions', async () => {
    const mod = await import('../services/chat/moderation.service.js');
    expect(typeof mod.moderateInput).toBe('function');
    expect(typeof mod.moderateOutput).toBe('function');
    expect(typeof mod.moderateFull).toBe('function');
  });

  it('moderateInput should not block empty messages', async () => {
    const { moderateInput } = await import('../services/chat/moderation.service.js');
    const result = await moderateInput([]);
    expect(result.blocked).toBe(false);
  });

  it('moderateInput should block messages exceeding MAX_MESSAGE_CHARS', async () => {
    const { moderateInput } = await import('../services/chat/moderation.service.js');
    const longMessage = 'a'.repeat(33000);
    const result = await moderateInput([
      { role: 'user', content: longMessage }
    ]);
    expect(result.blocked).toBe(true);
    expect(result.error).toBeDefined();
  });

  it('moderateInput should BLOCK when moderator is unavailable (fail-closed default)', async () => {
    vi.doMock('../rag/rag-supabase-client.js', () => ({
      supabase: {
        functions: {
          invoke: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Service unavailable' },
          }),
        },
      },
    }));

    const { moderateInput } = await import('../services/chat/moderation.service.js');
    const result = await moderateInput([
      { role: 'user', content: 'This is a test message that should be blocked when moderation is down.' }
    ]);

    expect(result.blocked).toBe(true);
    expect(result.error).toBe('Content moderation service unavailable');
  });

  it('moderateInput should ALLOW when MODERATION_FAIL_OPEN=true (non-test env)', async () => {
    process.env.MODERATION_FAIL_OPEN = 'true';
    // Remove NODE_ENV=test so the fail-open logic can run
    delete process.env.NODE_ENV;

    vi.doMock('../rag/rag-supabase-client.js', () => ({
      supabase: {
        functions: {
          invoke: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Service unavailable' },
          }),
        },
      },
    }));

    const { moderateInput } = await import('../services/chat/moderation.service.js');
    const result = await moderateInput([
      { role: 'user', content: 'This message should pass when fail-open is enabled.' }
    ]);

    expect(result.blocked).toBe(false);
  });

  it('moderateFull should BLOCK when moderator is unavailable (fail-closed default)', async () => {
    vi.doMock('../rag/rag-supabase-client.js', () => ({
      supabase: {
        functions: {
          invoke: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Service unavailable' },
          }),
        },
      },
    }));

    vi.doMock('../security/input-validator.js', () => ({
      inputValidator: {
        validate: vi.fn().mockResolvedValue({
          valid: true,
          issues: [],
          riskScore: 0,
        }),
      },
    }));

    const { moderateFull } = await import('../services/chat/moderation.service.js');
    const result = await moderateFull('This is a normal test message.');

    expect(result.blocked).toBe(true);
    expect(result.action).toBe('block');
    expect(result.reason).toBe('Content moderation service unavailable');
  });

  it('moderateFull should ALLOW with local validation only when MODERATION_FAIL_OPEN=true (non-test env)', async () => {
    process.env.MODERATION_FAIL_OPEN = 'true';
    // Remove NODE_ENV=test so the fail-open logic can run
    delete process.env.NODE_ENV;

    vi.doMock('../rag/rag-supabase-client.js', () => ({
      supabase: {
        functions: {
          invoke: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Service unavailable' },
          }),
        },
      },
    }));

    vi.doMock('../security/input-validator.js', () => ({
      inputValidator: {
        validate: vi.fn().mockResolvedValue({
          valid: true,
          issues: [],
          riskScore: 0,
        }),
      },
    }));

    const { moderateFull } = await import('../services/chat/moderation.service.js');
    const result = await moderateFull('This is a normal test message.');

    expect(result.blocked).toBe(false);
    expect(result.action).toBe('allow');
  });
});
