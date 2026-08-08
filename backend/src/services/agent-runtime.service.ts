import redis from '../config/redis/client.js';
import { supabase } from './supabase.service.js';
import { logger } from '../utils/logger.js';

const AGENT_TTL_SECONDS = 120; // 2 minutes - increased from 90s for stability
const CONVERSATION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ACTIVE_AGENTS_SET_KEY = 'agents:active';

// Batching for conversation events to avoid Supabase rate limits
const BATCH_SIZE = 10;
const BATCH_FLUSH_INTERVAL_MS = 5_000;

type BatchedRow = AgentConversationRow;

const conversationBatch: BatchedRow[] = [];
let batchFlushTimer: NodeJS.Timeout | null = null;

function scheduleBatchFlush() {
  if (batchFlushTimer) return;
  batchFlushTimer = setTimeout(() => {
    batchFlushTimer = null;
    void flushConversationBatch();
  }, BATCH_FLUSH_INTERVAL_MS);
}

async function flushConversationBatch() {
  if (conversationBatch.length === 0) return;
  const batch = conversationBatch.splice(0, conversationBatch.length);
  try {
    const { error } = await supabase.from('agent_conversation_events').insert(batch);
    if (error) {
      logger.warn('Failed to archive batched conversation events', {
        count: batch.length,
        error: error.message,
      });
    }
  } catch (error) {
    logger.warn('Unexpected failure while archiving batched conversation events', {
      count: batch.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export type DistributedAgentStatus = 'starting' | 'running' | 'thinking' | 'speaking' | 'cancelling' | 'stopping' | 'offline';

export interface DistributedAgentRecord {
  agentKey: string;
  roomName: string;
  identity: string | null;
  instanceId: string;
  pid: number | null;
  status: DistributedAgentStatus;
  startedAt: number;
  updatedAt: number;
}

export interface AgentConversationEvent {
  role: 'user' | 'assistant' | 'system';
  text: string;
  turnId?: string;
  source?: 'voice' | 'text' | 'agent';
  createdAt: number;
}

interface AgentConversationRow {
  room_name: string;
  identity: string;
  role: AgentConversationEvent['role'];
  text: string;
  turn_id: string | null;
  source: AgentConversationEvent['source'] | null;
  created_at: string;
}

function registryKey(agentKey: string) {
  return `agent:registry:${agentKey}`;
}

function conversationKey(roomName: string, identity: string) {
  return `agent:conversation:${roomName}:${identity}`;
}

function buildAgentKey(roomName: string, identity?: string) {
  return identity ? `${roomName}_${identity}` : roomName;
}

export async function reserveDistributedAgent(record: Omit<DistributedAgentRecord, 'updatedAt'>) {
  const nextRecord: DistributedAgentRecord = {
    ...record,
    updatedAt: Date.now(),
  };

  const result = await redis.set(
    registryKey(record.agentKey),
    JSON.stringify(nextRecord),
    'EX',
    AGENT_TTL_SECONDS,
    'NX',
  );

  if (result !== 'OK') {
    return false;
  }

  await redis.sadd(ACTIVE_AGENTS_SET_KEY, record.agentKey);
  return true;
}

export async function syncDistributedAgent(record: DistributedAgentRecord) {
  await redis.setex(
    registryKey(record.agentKey),
    AGENT_TTL_SECONDS,
    JSON.stringify({
      ...record,
      updatedAt: Date.now(),
    } satisfies DistributedAgentRecord),
  );
  await redis.sadd(ACTIVE_AGENTS_SET_KEY, record.agentKey);
}

export async function releaseDistributedAgent(agentKey: string) {
  await redis.del(registryKey(agentKey));
  await redis.srem(ACTIVE_AGENTS_SET_KEY, agentKey);
}

export async function getDistributedAgent(roomName: string, identity?: string) {
  const raw = await redis.get(registryKey(buildAgentKey(roomName, identity)));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as DistributedAgentRecord;
  } catch {
    return null;
  }
}

export async function countDistributedAgents() {
  const keys = await redis.smembers(ACTIVE_AGENTS_SET_KEY);
  if (keys.length === 0) return 0;

  const pipeline = redis.pipeline();
  keys.forEach((key: string) => pipeline.exists(registryKey(key)));
  const results = await pipeline.exec();

  if (!results) {
    return 0;
  }

  let activeCount = 0;
  const staleKeys: string[] = [];

  results.forEach((result: [Error | null, unknown], index: number) => {
    // result is [error, resultValue]
    const exists = result[1];
    if (exists === 1) {
      activeCount += 1;
    } else {
      staleKeys.push(keys[index]);
    }
  });

  if (staleKeys.length > 0) {
    await redis.srem(ACTIVE_AGENTS_SET_KEY, ...staleKeys);
  }

  return activeCount;
}

export async function appendConversationEvent(roomName: string, identity: string, event: AgentConversationEvent) {
  const key = conversationKey(roomName, identity);
  await redis.rpush(key, JSON.stringify(event));
  await redis.expire(key, CONVERSATION_TTL_SECONDS);

  const row: AgentConversationRow = {
    room_name: roomName,
    identity,
    role: event.role,
    text: event.text,
    turn_id: event.turnId ?? null,
    source: event.source ?? null,
    created_at: new Date(event.createdAt).toISOString(),
  };

  conversationBatch.push(row);
  if (conversationBatch.length >= BATCH_SIZE) {
    await flushConversationBatch();
  } else {
    scheduleBatchFlush();
  }
}

export async function getConversationHistory(roomName: string, identity: string, limit = 50) {
  try {
    const { data, error } = await supabase
      .from('agent_conversation_events')
      .select('role, text, turn_id, source, created_at')
      .eq('room_name', roomName)
      .eq('identity', identity)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(limit, 200)));

    if (!error && Array.isArray(data) && data.length > 0) {
      return [...data]
        .reverse()
        .map((row: Record<string, unknown>) => ({
          role: row.role as AgentConversationEvent['role'],
          text: String(row.text ?? ''),
          turnId: typeof row.turn_id === 'string' ? row.turn_id : undefined,
          source: row.source as AgentConversationEvent['source'] | undefined,
          createdAt: Date.parse(String(row.created_at ?? new Date(0).toISOString())),
        }));
    }
  } catch (error) {
    logger.warn('Failed to load archived agent conversation history, falling back to Redis', {
      roomName,
      identity,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const key = conversationKey(roomName, identity);
  const start = Math.max(-limit, -500);
  const rawEvents = await redis.lrange(key, start, -1);

  return rawEvents.flatMap((raw: string) => {
    try {
      return [JSON.parse(raw) as AgentConversationEvent];
    } catch (parseErr) {
      logger.debug('Failed to parse conversation event from Redis', { error: (parseErr as Error)?.message });
      return [];
    }
  });
}

// Flush pending conversation events on graceful shutdown
function handleShutdownSignal(signal: string) {
  logger.info(`[SHUTDOWN] Received ${signal}, flushing pending conversation batch...`);
  if (batchFlushTimer) {
    clearTimeout(batchFlushTimer);
    batchFlushTimer = null;
  }
  void flushConversationBatch();
}

process.on('SIGTERM', () => handleShutdownSignal('SIGTERM'));
process.on('SIGINT', () => handleShutdownSignal('SIGINT'));
