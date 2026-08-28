import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Redis from 'ioredis';

// Real Redis integration tests for guest quota and transcript; skipped when Redis is unavailable.

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';
const WINDOW_SECONDS = 86400; // 24h
const GUEST_PREFIX = 'guest:test:';
const TRANSCRIPT_PREFIX = 'guest:transcript:test:';

let redis: Redis | null = null;
let redisAvailable = false;

// Lua scripts mirroring the production quota and transcript logic

const FIXED_WINDOW_LUA = `
  local key = KEYS[1]
  local window_seconds = tonumber(ARGV[1])

  local count = redis.call('INCR', key)

  if count == 1 then
    redis.call('EXPIRE', key, window_seconds)
  end

  local ttl = redis.call('TTL', key)
  if ttl < 0 then
    ttl = window_seconds
  end

  return { count, ttl }
`;

const TRANSCRIPT_APPEND_LUA = `
  local key = KEYS[1]
  local new_entries_json = ARGV[1]
  local max_messages = tonumber(ARGV[2])
  local max_chars = tonumber(ARGV[3])
  local window_seconds = tonumber(ARGV[4])

  local raw = redis.call('GET', key)
  local existing = {}
  if raw then
    existing = cjson.decode(raw)
  end

  local new_entries = cjson.decode(new_entries_json)
  for _, entry in ipairs(new_entries) do
    table.insert(existing, entry)
  end

  while #existing > max_messages do
    table.remove(existing, 1)
  end

  local total_chars = 0
  local bounded = {}
  for i = #existing, 1, -1 do
    total_chars = total_chars + #existing[i].content
    if total_chars > max_chars and #bounded > 0 then
      break
    end
    table.insert(bounded, 1, existing[i])
  end

  local serialized = cjson.encode(bounded)
  if redis.call('EXISTS', key) == 0 then
    redis.call('SETEX', key, window_seconds, serialized)
  else
    redis.call('SET', key, serialized)
  end

  return #bounded
`;

// Connect to Redis, register the Lua commands, and reset state between tests

beforeAll(async () => {
  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
      // One attempt is enough to detect availability; ioredis's default
      // endless retry strategy keeps emitting 'error' events (with no
      // listener) long after this guard gave up — that unhandled event
      // intermittently killed whatever test was running at the time.
      retryStrategy: () => null,
    });
    redis.on('error', () => { /* handled by the availability guard */ });
    await redis.connect();
    await redis.ping();

    (redis as any).defineCommand('guestFixedWindowIncr', {
      numberOfKeys: 1,
      lua: FIXED_WINDOW_LUA,
    });
    (redis as any).defineCommand('guestAppendTranscript', {
      numberOfKeys: 1,
      lua: TRANSCRIPT_APPEND_LUA,
    });
    await new Promise((r) => setTimeout(r, 100));

    redisAvailable = true;
  } catch {
    redisAvailable = false;
    redis = null;
  }
});

afterAll(async () => {
  if (redis) {
    const keys = await redis.keys(`${GUEST_PREFIX}*`);
    const transcriptKeys = await redis.keys(`${TRANSCRIPT_PREFIX}*`);
    const allKeys = [...keys, ...transcriptKeys];
    if (allKeys.length > 0) await redis.del(...allKeys);
    await redis.quit();
  }
});

beforeEach(async () => {
  if (!redis) return;
  const keys = await redis.keys(`${GUEST_PREFIX}*`);
  const transcriptKeys = await redis.keys(`${TRANSCRIPT_PREFIX}*`);
  const allKeys = [...keys, ...transcriptKeys];
  if (allKeys.length > 0) await redis.del(...allKeys);
});

// Guest quota behavior of the Lua fixed-window script

describe('Real Redis — Guest Quota (Lua fixed-window)', () => {
  it('should anchor TTL on first request', async () => {
    if (!redisAvailable || !redis) return;

    const key = `${GUEST_PREFIX}anchor-ttl`;
    const [count, ttl] = await (redis as any).guestFixedWindowIncr(key, WINDOW_SECONDS);

    expect(count).toBe(1);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WINDOW_SECONDS);

    const realTtl = await redis.ttl(key);
    expect(realTtl).toBeGreaterThan(0);
  });

  it('should NOT extend TTL on subsequent requests', async () => {
    if (!redisAvailable || !redis) return;

    const key = `${GUEST_PREFIX}no-extend`;
    await (redis as any).guestFixedWindowIncr(key, WINDOW_SECONDS);
    const ttlBefore = await redis.ttl(key);

    await (redis as any).guestFixedWindowIncr(key, WINDOW_SECONDS);
    const ttlAfter = await redis.ttl(key);

    expect(ttlAfter).toBeLessThanOrEqual(ttlBefore);
  });

  it('should increment count correctly up to limit', async () => {
    if (!redisAvailable || !redis) return;

    const key = `${GUEST_PREFIX}count-up`;
    for (let i = 0; i < 4; i++) {
      const [count] = await (redis as any).guestFixedWindowIncr(key, WINDOW_SECONDS);
      expect(count).toBe(i + 1);
    }

    const [count5] = await (redis as any).guestFixedWindowIncr(key, WINDOW_SECONDS);
    expect(count5).toBe(5);
  });

  it('should start new window after TTL expires', async () => {
    if (!redisAvailable || !redis) return;

    const key = `${GUEST_PREFIX}new-window`;
    await (redis as any).guestFixedWindowIncr(key, WINDOW_SECONDS);
    await (redis as any).guestFixedWindowIncr(key, WINDOW_SECONDS);

    await redis.expire(key, 1);
    await new Promise((r) => setTimeout(r, 1500));

    const [count, ttl] = await (redis as any).guestFixedWindowIncr(key, WINDOW_SECONDS);
    expect(count).toBe(1);
    expect(ttl).toBe(WINDOW_SECONDS);
  });

  it('should track different guest IDs independently', async () => {
    if (!redisAvailable || !redis) return;

    const key1 = `${GUEST_PREFIX}guest-a`;
    const key2 = `${GUEST_PREFIX}guest-b`;

    await (redis as any).guestFixedWindowIncr(key1, WINDOW_SECONDS);
    await (redis as any).guestFixedWindowIncr(key1, WINDOW_SECONDS);
    await (redis as any).guestFixedWindowIncr(key2, WINDOW_SECONDS);

    const [count1] = await (redis as any).guestFixedWindowIncr(key1, WINDOW_SECONDS);
    const [count2] = await (redis as any).guestFixedWindowIncr(key2, WINDOW_SECONDS);

    expect(count1).toBe(3);
    expect(count2).toBe(2);
  });

  it('should handle concurrent INCR atomically', async () => {
    if (!redisAvailable || !redis) return;

    const key = `${GUEST_PREFIX}concurrent`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        (redis as any).guestFixedWindowIncr(key, WINDOW_SECONDS)
      )
    );

    const counts = results.map(([count]: [number, number]) => count).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

// Transcript writes keep a fixed-window TTL

describe('Real Redis — Guest Transcript (fixed-window TTL)', () => {
  it('should anchor TTL on first write, not slide on append', async () => {
    if (!redisAvailable || !redis) return;

    const key = `${TRANSCRIPT_PREFIX}ttl-test`;
    const windowSeconds = 300;

    await (redis as any).guestAppendTranscript(
      key,
      JSON.stringify([{ role: 'user', content: 'msg1' }]),
      20, 40000, windowSeconds,
    );

    const ttl1 = await redis.ttl(key);
    expect(ttl1).toBeGreaterThan(0);
    expect(ttl1).toBeLessThanOrEqual(windowSeconds);

    await new Promise((r) => setTimeout(r, 2000));

    await (redis as any).guestAppendTranscript(
      key,
      JSON.stringify([{ role: 'assistant', content: 'reply1' }]),
      20, 40000, windowSeconds,
    );

    const ttl2 = await redis.ttl(key);
    expect(ttl2).toBeLessThanOrEqual(ttl1);

    const raw = await redis.get(key);
    const transcript = JSON.parse(raw!);
    expect(transcript).toHaveLength(2);
    expect(transcript[0]).toEqual({ role: 'user', content: 'msg1' });
    expect(transcript[1]).toEqual({ role: 'assistant', content: 'reply1' });
  });

  it('should persist and read transcript data correctly', async () => {
    if (!redisAvailable || !redis) return;

    const key = `${TRANSCRIPT_PREFIX}data-test`;
    const transcript = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    await (redis as any).guestAppendTranscript(
      key, JSON.stringify(transcript), 20, 40000, WINDOW_SECONDS,
    );

    const raw = await redis.get(key);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('should trim to max messages (keep most recent)', async () => {
    if (!redisAvailable || !redis) return;

    const key = `${TRANSCRIPT_PREFIX}trim-test`;
    const maxMessages = 3;

    // Add 5 messages one by one
    for (let i = 0; i < 5; i++) {
      await (redis as any).guestAppendTranscript(
        key,
        JSON.stringify([{ role: 'user', content: `msg${i}` }]),
        maxMessages, 40000, WINDOW_SECONDS,
      );
    }

    const raw = await redis.get(key);
    const transcript = JSON.parse(raw!);
    expect(transcript).toHaveLength(maxMessages);
    // Should keep the last 3: msg2, msg3, msg4
    expect(transcript[0].content).toBe('msg2');
    expect(transcript[2].content).toBe('msg4');
  });

  it('should delete transcript on DEL', async () => {
    if (!redisAvailable || !redis) return;

    const key = `${TRANSCRIPT_PREFIX}delete-test`;
    await (redis as any).guestAppendTranscript(
      key,
      JSON.stringify([{ role: 'user', content: 'test' }]),
      20, 40000, WINDOW_SECONDS,
    );
    expect(await redis.get(key)).not.toBeNull();

    await redis.del(key);
    expect(await redis.get(key)).toBeNull();
  });
});

// readGuestCount pattern: GET the counter plus its remaining TTL

describe('Real Redis — readGuestCount (GET + TTL)', () => {
  it('should return count=0 for new guest', async () => {
    if (!redisAvailable || !redis) return;

    const key = `${GUEST_PREFIX}read-new`;
    const raw = await redis.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    expect(count).toBe(0);
  });

  it('should return correct count and remaining TTL', async () => {
    if (!redisAvailable || !redis) return;

    const key = `${GUEST_PREFIX}read-count`;
    await (redis as any).guestFixedWindowIncr(key, WINDOW_SECONDS);
    await (redis as any).guestFixedWindowIncr(key, WINDOW_SECONDS);

    const raw = await redis.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    const ttl = await redis.ttl(key);

    expect(count).toBe(2);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WINDOW_SECONDS);
  });
});

// decrementGuestCount pattern: DECR rolls the count back without extending TTL

describe('Real Redis — decrementGuestCount (DECR rollback)', () => {
  it('should decrement count without extending TTL', async () => {
    if (!redisAvailable || !redis) return;

    const key = `${GUEST_PREFIX}decrement`;
    await (redis as any).guestFixedWindowIncr(key, WINDOW_SECONDS);
    await (redis as any).guestFixedWindowIncr(key, WINDOW_SECONDS);

    const ttlBefore = await redis.ttl(key);
    await redis.decr(key);

    const raw = await redis.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    expect(count).toBe(1);

    const ttlAfter = await redis.ttl(key);
    expect(ttlAfter).toBeLessThanOrEqual(ttlBefore);
  });

  it('should handle DECR on non-existent key', async () => {
    if (!redisAvailable || !redis) return;

    const key = `${GUEST_PREFIX}decrement-new`;
    await redis.decr(key);
    const raw = await redis.get(key);
    expect(parseInt(raw!, 10)).toBe(-1);

    await redis.del(key);
  });
});
