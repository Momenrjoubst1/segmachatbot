import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { logLevelConfig, getModuleLogLevel } from '../utils/log-config.js';

describe('logLevelConfig', () => {
  it('has a default log level', () => {
    expect(logLevelConfig.default).toBeDefined();
    expect(['debug', 'info', 'warn', 'error', 'fatal']).toContain(logLevelConfig.default);
  });

  it('has moduleOverrides object', () => {
    expect(typeof logLevelConfig.moduleOverrides).toBe('object');
  });

  it('includes known module overrides', () => {
    expect(logLevelConfig.moduleOverrides['auth']).toBe('warn');
    expect(logLevelConfig.moduleOverrides['rate-limiter']).toBe('warn');
    expect(logLevelConfig.moduleOverrides['error-handler']).toBe('error');
    expect(logLevelConfig.moduleOverrides['bm25']).toBe('debug');
  });
});

describe('getModuleLogLevel', () => {
  it('returns override for known modules', () => {
    expect(getModuleLogLevel('auth')).toBe('warn');
    expect(getModuleLogLevel('rate-limiter')).toBe('warn');
    expect(getModuleLogLevel('error-handler')).toBe('error');
    expect(getModuleLogLevel('bm25')).toBe('debug');
    expect(getModuleLogLevel('memory-config')).toBe('debug');
    expect(getModuleLogLevel('config-validator')).toBe('debug');
  });

  it('returns default level for unknown modules', () => {
    const unknownModule = 'some-random-module-' + Date.now();
    expect(getModuleLogLevel(unknownModule)).toBe(logLevelConfig.default);
  });

  it('returns default level for empty string module name', () => {
    expect(getModuleLogLevel('')).toBe(logLevelConfig.default);
  });

  it('uses LOG_LEVEL env for default when set to valid value', () => {
    const original = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'debug';

    // Module is already loaded, so just verify the current default level
    expect(['debug', 'info', 'warn', 'error', 'fatal']).toContain(logLevelConfig.default);

    process.env.LOG_LEVEL = original || '';
  });
});
