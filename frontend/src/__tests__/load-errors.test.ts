import { describe, it, expect } from 'vitest';
import { LOAD_ERROR_I18N, type LoadErrorCode } from '../lib/load-errors';

describe('load-errors', () => {
  it('should have i18n keys for all error codes', () => {
    const codes: LoadErrorCode[] = [
      'messages_load_failed',
      'threads_load_failed',
      'courses_load_failed',
      'courses_unexpected',
      'network_unreachable',
    ];

    for (const code of codes) {
      expect(LOAD_ERROR_I18N[code]).toBeDefined();
      expect(LOAD_ERROR_I18N[code]).toContain('errors:');
    }
  });

  it('should map messages_load_failed to correct key', () => {
    expect(LOAD_ERROR_I18N.messages_load_failed).toBe('errors:messages_load_failed');
  });

  it('should map network_unreachable to correct key', () => {
    expect(LOAD_ERROR_I18N.network_unreachable).toBe('errors:network_unreachable');
  });

  it('should have all required error codes', () => {
    const keys = Object.keys(LOAD_ERROR_I18N);
    expect(keys).toHaveLength(5);
    expect(keys).toContain('messages_load_failed');
    expect(keys).toContain('threads_load_failed');
    expect(keys).toContain('courses_load_failed');
    expect(keys).toContain('courses_unexpected');
    expect(keys).toContain('network_unreachable');
  });
});
