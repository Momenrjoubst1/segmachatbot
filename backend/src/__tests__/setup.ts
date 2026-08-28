import { vi } from 'vitest';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://vitest.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'vitest-service-role-jwt-placeholder';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.GROQ_API_KEY = 'gsk_test_key';
process.env.OPENROUTER_API_KEY = 'sk-or-v1-test-key';
process.env.ASSISTANT_DEFAULT_MODEL = 'qwen/qwen3.6-27b';
process.env.ANALYTICS_ENABLED = 'false';

// Mock Redis client
vi.mock('../config/redis/client.js', () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(0),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(-1),
    incr: vi.fn().mockResolvedValue(1),
    decr: vi.fn().mockResolvedValue(0),
    ping: vi.fn().mockResolvedValue('PONG'),
    lrange: vi.fn().mockResolvedValue([]),
    rpush: vi.fn().mockResolvedValue(0),
    ltrim: vi.fn().mockResolvedValue('OK'),
    llen: vi.fn().mockResolvedValue(0),
    pipeline: vi.fn().mockReturnValue({
      incr: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }),
    defineCommand: vi.fn(),
  },
}));

// Mock Supabase client
vi.mock('../config/supabase.config.js', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
  supabaseConfig: {
    auth: {
      url: 'http://vitest.supabase.local',
      serviceRoleKey: 'vitest-service-role-jwt-placeholder',
    },
  },
}));

// Mock logger
vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
