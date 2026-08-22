import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../config/redis/client.js', () => ({
  default: {
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    sadd: vi.fn().mockResolvedValue(1),
    srem: vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
    rpush: vi.fn().mockResolvedValue(1),
    lrange: vi.fn().mockResolvedValue([]),
    expire: vi.fn().mockResolvedValue(1),
    pipeline: vi.fn().mockReturnValue({
      exists: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }),
  },
}));

vi.mock('../services/supabase.service.js', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  },
}));

import {
  reserveDistributedAgent,
  syncDistributedAgent,
  releaseDistributedAgent,
  getDistributedAgent,
  countDistributedAgents,
  appendConversationEvent,
  getConversationHistory,
} from '../services/agent-runtime.service.js';
import redis from '../config/redis/client.js';
import { supabase } from '../services/supabase.service.js';

const mockRedis = vi.mocked(redis);

beforeEach(() => {
  vi.clearAllMocks();
});

const sampleRecord = {
  agentKey: 'room1_agent1',
  roomName: 'room1',
  identity: 'agent1',
  instanceId: 'inst-1',
  pid: 1234,
  status: 'running' as const,
  startedAt: Date.now(),
};

describe('reserveDistributedAgent', () => {
  it('reserves agent when Redis returns OK', async () => {
    mockRedis.set.mockResolvedValue('OK');
    const result = await reserveDistributedAgent(sampleRecord);
    expect(result).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'agent:registry:room1_agent1',
      expect.any(String),
      'EX',
      expect.any(Number),
      'NX',
    );
    expect(mockRedis.sadd).toHaveBeenCalledWith('agents:active', 'room1_agent1');
  });

  it('returns false when Redis does not return OK (already reserved)', async () => {
    mockRedis.set.mockResolvedValue(null);
    const result = await reserveDistributedAgent(sampleRecord);
    expect(result).toBe(false);
  });
});

describe('syncDistributedAgent', () => {
  it('updates agent record with setex', async () => {
    await syncDistributedAgent({ ...sampleRecord, updatedAt: 0 });
    expect(mockRedis.setex).toHaveBeenCalledWith(
      'agent:registry:room1_agent1',
      expect.any(Number),
      expect.any(String),
    );
    expect(mockRedis.sadd).toHaveBeenCalledWith('agents:active', 'room1_agent1');
  });
});

describe('releaseDistributedAgent', () => {
  it('deletes registry key and removes from active set', async () => {
    await releaseDistributedAgent('room1_agent1');
    expect(mockRedis.del).toHaveBeenCalledWith('agent:registry:room1_agent1');
    expect(mockRedis.srem).toHaveBeenCalledWith('agents:active', 'room1_agent1');
  });
});

describe('getDistributedAgent', () => {
  it('returns null when agent not found', async () => {
    mockRedis.get.mockResolvedValue(null);
    const result = await getDistributedAgent('room1', 'agent1');
    expect(result).toBeNull();
  });

  it('returns parsed agent record when found', async () => {
    const record = { ...sampleRecord, updatedAt: Date.now() };
    mockRedis.get.mockResolvedValue(JSON.stringify(record));

    const result = await getDistributedAgent('room1', 'agent1');
    expect(result).toEqual(record);
    expect(mockRedis.get).toHaveBeenCalledWith('agent:registry:room1_agent1');
  });

  it('returns null when stored JSON is corrupted', async () => {
    mockRedis.get.mockResolvedValue('not-json');
    const result = await getDistributedAgent('room1', 'agent1');
    expect(result).toBeNull();
  });

  it('builds key without identity', async () => {
    mockRedis.get.mockResolvedValue(null);
    await getDistributedAgent('room1');
    expect(mockRedis.get).toHaveBeenCalledWith('agent:registry:room1');
  });
});

describe('countDistributedAgents', () => {
  it('returns 0 when no active agents', async () => {
    mockRedis.smembers.mockResolvedValue([]);
    const count = await countDistributedAgents();
    expect(count).toBe(0);
  });

  it('counts existing agents and cleans stale keys', async () => {
    mockRedis.smembers.mockResolvedValue(['agent1', 'agent2']);
    mockRedis.pipeline.mockReturnValue({
      exists: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, 1],
        [null, 0],
      ]),
    });

    const count = await countDistributedAgents();
    expect(count).toBe(1);
    expect(mockRedis.srem).toHaveBeenCalledWith('agents:active', 'agent2');
  });
});

describe('appendConversationEvent', () => {
  it('appends event to Redis list', async () => {
    await appendConversationEvent('room1', 'user1', {
      role: 'user',
      text: 'Hello',
      createdAt: Date.now(),
    });

    expect(mockRedis.rpush).toHaveBeenCalledWith(
      'agent:conversation:room1:user1',
      expect.any(String),
    );
    expect(mockRedis.expire).toHaveBeenCalled();
  });

  it('flushes batch when batch size is reached', async () => {
    const batchFlushEvents = Array.from({ length: 10 }, (_, i) => ({
      role: 'user' as const,
      text: `Message ${i}`,
      createdAt: Date.now(),
    }));

    for (const event of batchFlushEvents) {
      await appendConversationEvent('room1', 'user1', event);
    }

    expect(supabase.from).toHaveBeenCalledWith('agent_conversation_events');
  });
});

describe('getConversationHistory', () => {
  it('returns empty array when no history exists', async () => {
    mockRedis.lrange.mockResolvedValue([]);
    const history = await getConversationHistory('room1', 'user1');
    expect(history).toEqual([]);
  });

  it('parses and returns Redis-stored events', async () => {
    const events = [
      JSON.stringify({ role: 'user', text: 'Hello', createdAt: Date.now() }),
      JSON.stringify({ role: 'assistant', text: 'Hi there', createdAt: Date.now() }),
    ];
    mockRedis.lrange.mockResolvedValue(events);

    const history = await getConversationHistory('room1', 'user1');
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('assistant');
  });

  it('skips corrupted JSON entries gracefully', async () => {
    mockRedis.lrange.mockResolvedValue([
      JSON.stringify({ role: 'user', text: 'Hello', createdAt: Date.now() }),
      'corrupted-json',
      JSON.stringify({ role: 'assistant', text: 'Hi', createdAt: Date.now() }),
    ]);

    const history = await getConversationHistory('room1', 'user1');
    expect(history).toHaveLength(2);
  });

  it('applies limit to Redis query', async () => {
    mockRedis.lrange.mockResolvedValue([]);
    await getConversationHistory('room1', 'user1', 25);
    expect(mockRedis.lrange).toHaveBeenCalledWith(
      'agent:conversation:room1:user1',
      expect.any(Number),
      -1,
    );
  });
});
