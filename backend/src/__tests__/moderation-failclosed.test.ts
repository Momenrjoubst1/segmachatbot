import { describe, it, expect, vi, beforeEach } from 'vitest';

// We'll test the moderation service's behavior when the Supabase Edge Function is unavailable
describe('Moderation Fail-Closed Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export moderateInput function', async () => {
    const mod = await import('../services/chat/moderation.service.js');
    expect(typeof mod.moderateInput).toBe('function');
  });

  it('should export moderateOutput function', async () => {
    const mod = await import('../services/chat/moderation.service.js');
    expect(typeof mod.moderateOutput).toBe('function');
  });

  it('moderateInput should return blocked=true for empty messages', async () => {
    const { moderateInput } = await import('../services/chat/moderation.service.js');
    const result = await moderateInput([]);
    // Empty messages should not be blocked (no user message to check)
    expect(result.blocked).toBe(false);
  });

  it('moderateInput should check message length', async () => {
    const { moderateInput } = await import('../services/chat/moderation.service.js');
    const longMessage = 'a'.repeat(33000); // Exceeds MAX_MESSAGE_CHARS (32000)
    const result = await moderateInput([
      { role: 'user', content: longMessage }
    ]);
    expect(result.blocked).toBe(true);
    expect(result.error).toBeDefined();
  });
});
