/**
 * ═════════════════════════════════════════=====═══════════════════════════════
 * Mock Redis Client — In-memory fallback for development without Redis
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('mock-redis');

class MockRedis {
  private data = new Map<string, string>();
  private sets = new Map<string, Set<string>>();
  private zsets = new Map<string, Map<string, number>>();
  private expiries = new Map<string, number>();

  constructor() {
    log.info('⚠️  Using Mock Redis (In-Memory). Install Redis for production use.');
  }

  private checkExpiry(key: string) {
    const expiry = this.expiries.get(key);
    if (expiry && Date.now() > expiry) {
      this.data.delete(key);
      this.sets.delete(key);
      this.zsets.delete(key);
      this.expiries.delete(key);
      return true;
    }
    return false;
  }

  async get(key: string): Promise<string | null> {
    if (this.checkExpiry(key)) return null;
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: any[]): Promise<'OK' | null> {
    const upperArgs = args.map((a: any) => (typeof a === 'string' ? a.toUpperCase() : a));
    if (upperArgs.includes('NX') && this.data.has(key) && !this.checkExpiry(key)) {
      return null;
    }
    this.data.set(key, value);
    const exIdx = upperArgs.indexOf('EX');
    if (exIdx !== -1) {
      const ttl = Number(args[exIdx + 1]);
      this.expiries.set(key, Date.now() + ttl * 1000);
    }
    return 'OK';
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.data.set(key, value);
    this.expiries.set(key, Date.now() + seconds * 1000);
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    if (this.checkExpiry(key)) this.data.delete(key);
    const current = parseInt(this.data.get(key) || '0', 10);
    const next = current + 1;
    this.data.set(key, String(next));
    return next;
  }

  async decr(key: string): Promise<number> {
    if (this.checkExpiry(key)) this.data.delete(key);
    const current = parseInt(this.data.get(key) || '0', 10);
    const next = Math.max(0, current - 1);
    this.data.set(key, String(next));
    return next;
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.data.delete(key) || this.sets.delete(key) || this.zsets.delete(key)) count++;
      this.expiries.delete(key);
    }
    return count;
  }

  async exists(key: string): Promise<number> {
    if (this.checkExpiry(key)) return 0;
    return (this.data.has(key) || this.sets.has(key) || this.zsets.has(key)) ? 1 : 0;
  }

  async sadd(key: string, ...values: string[]): Promise<number> {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    const set = this.sets.get(key)!;
    let added = 0;
    for (const v of values) {
      if (!set.has(v)) { set.add(v); added++; }
    }
    return added;
  }

  async smembers(key: string): Promise<string[]> {
    if (this.checkExpiry(key)) return [];
    const set = this.sets.get(key);
    return set ? Array.from(set) : [];
  }

  async srem(key: string, ...values: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const v of values) {
      if (set.delete(v)) removed++;
    }
    return removed;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    const zset = this.zsets.get(key)!;
    const isNew = !zset.has(member);
    zset.set(member, score);
    return isNew ? 1 : 0;
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  async zremrangebyscore(key: string, min: string | number, max: string | number): Promise<number> {
    const zset = this.zsets.get(key);
    if (!zset) return 0;
    const minVal = min === '-inf' ? -Infinity : Number(min);
    const maxVal = max === '+inf' ? Infinity : Number(max);
    let removed = 0;
    for (const [member, score] of zset) {
      if (score >= minVal && score <= maxVal) {
        zset.delete(member);
        removed++;
      }
    }
    return removed;
  }

  async zrange(key: string, start: number, stop: number, ...args: any[]): Promise<any[]> {
    const zset = this.zsets.get(key);
    if (!zset || zset.size === 0) return [];
    const sorted = Array.from(zset.entries()).sort((a, b) => a[1] - b[1]);
    const realStop = stop < 0 ? sorted.length + stop + 1 : stop + 1;
    const sliced = sorted.slice(start, realStop);
    const withScores = args.map((a: any) => String(a).toUpperCase()).includes('WITHSCORES');
    if (withScores) {
      const result: any[] = [];
      for (const [member, score] of sliced) {
        result.push(member, String(score));
      }
      return result;
    }
    return sliced.map(([member]) => member);
  }

  async pexpire(key: string, ms: number): Promise<number> {
    if (this.data.has(key) || this.sets.has(key) || this.zsets.has(key) || this.lists.has(key)) {
      this.expiries.set(key, Date.now() + ms);
      return 1;
    }
    return 0;
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.pexpire(key, seconds * 1000);
  }

  private lists = new Map<string, string[]>();

  async lpush(key: string, ...values: string[]): Promise<number> {
    if (!this.lists.has(key)) this.lists.set(key, []);
    const list = this.lists.get(key)!;
    list.unshift(...values);
    return list.length;
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    if (!this.lists.has(key)) this.lists.set(key, []);
    const list = this.lists.get(key)!;
    list.push(...values);
    return list.length;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key);
    if (!list) return [];
    const realStop = stop < 0 ? list.length + stop + 1 : stop + 1;
    return list.slice(start, realStop);
  }

  async rpoplpush(source: string, destination: string): Promise<string | null> {
    const srcList = this.lists.get(source);
    if (!srcList || srcList.length === 0) return null;
    const value = srcList.pop()!;
    if (!this.lists.has(destination)) this.lists.set(destination, []);
    this.lists.get(destination)!.unshift(value);
    return value;
  }

  async lrem(key: string, count: number, value: string): Promise<number> {
    const list = this.lists.get(key);
    if (!list) return 0;
    let removed = 0;
    const absCount = Math.abs(count) || list.length;
    for (let i = list.length - 1; i >= 0 && removed < absCount; i--) {
      if (list[i] === value) {
        list.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  async eval(script: string, numKeys: number, ...args: any[]): Promise<any> {
    const keys = args.slice(0, numKeys);
    const scriptArgs = args.slice(numKeys);
    if (script.includes('#room.participants >= 2') || script.includes('room.participants >= 2')) {
      const key = keys[0];
      const identity = scriptArgs[0];
      const ttl = Number(scriptArgs[1]);
      const raw = await this.get(key);
      if (!raw) return 0;
      const room = JSON.parse(raw);
      if (room.participants.length >= 2) return 0;
      if (room.participants.includes(identity)) return 1;
      room.participants.push(identity);
      await this.setex(key, ttl, JSON.stringify(room));
      return 1;
    }
    if (script.includes('p ~= identity')) {
      const key = keys[0];
      const roomName = scriptArgs[0];
      const identity = scriptArgs[1];
      const country = scriptArgs[2];
      const raw = await this.get(key);
      if (!raw) return 0;
      const room = JSON.parse(raw);
      room.participants = room.participants.filter((p: string) => p !== identity);
      if (room.participants.length === 0) {
        await this.del(key);
        await this.srem('rooms:active', roomName);
        await this.srem(`country:${country}`, roomName);
        return 0;
      } else {
        await this.setex(key, 4 * 60 * 60, JSON.stringify(room));
        return room.participants.length;
      }
    }
    if (script.includes('ZREMRANGEBYSCORE') && script.includes('ZADD') && script.includes('ZCARD')) {
      const key = keys[0];
      const now = Number(scriptArgs[0]);
      const window = Number(scriptArgs[1]);
      const member = scriptArgs[2];
      await this.zremrangebyscore(key, '-inf', now - window);
      await this.zadd(key, now, member);
      await this.pexpire(key, window);
      const currentHits = await this.zcard(key);
      const oldest = await this.zrange(key, 0, 0, 'WITHSCORES');
      const oldestScore = oldest.length >= 2 ? Number(oldest[1]) : now;
      return [currentHits, oldestScore + window];
    }
    log.warn('MockRedis: Unsupported Lua script');
    return null;
  }

  defineCommand(name: string, opts: { numberOfKeys: number; lua: string }) {
    const numKeys = opts.numberOfKeys;
    const lua = opts.lua;
    (this as any)[name] = async (...args: any[]) => {
      return this.eval(lua, numKeys, ...args);
    };
  }

  pipeline() {
    const commands: { method: string; args: any[] }[] = [];
    const self = this as any;
    const pipelineObj: any = {
      exec: async () => {
        const results = [];
        for (const cmd of commands) {
          try {
            if (typeof self[cmd.method] !== 'function') throw new Error(`Method ${cmd.method} not found`);
            const result = await self[cmd.method](...cmd.args);
            results.push([null, result]);
          } catch (err) {
            results.push([err, null]);
          }
        }
        return results;
      }
    };
    return new Proxy(pipelineObj, {
      get: (target, prop) => {
        if (prop in target) return target[prop];
        return (...args: any[]) => {
          commands.push({ method: prop as string, args });
          return pipelineObj;
        };
      }
    });
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  on(event: string, callback: (...args: any[]) => void) {
    if (event === 'connect') {
      setTimeout(() => callback(), 0);
    }
    return this as any;
  }

  off(_event: string, _callback?: (...args: any[]) => void) {
    return this as any;
  }

  unsubscribe(_channel?: string) {
    return this as any;
  }

  disconnect() {
    return this as any;
  }

  // SCAN for production-safe key iteration
  async scan(cursor: string, ...args: any[]): Promise<[string, string[]]> {
    let match = '*';
    let count = 100;
    for (let i = 0; i < args.length; i++) {
      if (String(args[i]).toUpperCase() === 'MATCH') match = String(args[i + 1]);
      if (String(args[i]).toUpperCase() === 'COUNT') count = Number(args[i + 1]);
    }
    const allKeys: string[] = [
      ...Array.from(this.data.keys()),
      ...Array.from(this.sets.keys()),
      ...Array.from(this.zsets.keys()),
    ];
    const filtered = match !== '*' && match !== '*'
      ? allKeys.filter(k => k.includes(match.replace(/\*/g, '')))
      : allKeys;
    const cursorNum = parseInt(cursor) || 0;
    const batch = filtered.slice(cursorNum, cursorNum + count);
    const nextCursor = cursorNum + count < filtered.length ? String(cursorNum + count) : '0';
    return [nextCursor, batch];
  }

  // Hash operations
  private hashes = new Map<string, Map<string, string>>();

  async hset(key: string, field: string, value: string): Promise<number> {
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    const hash = this.hashes.get(key)!;
    const isNew = !hash.has(field);
    hash.set(field, value);
    return isNew ? 1 : 0;
  }

  async hget(key: string, field: string): Promise<string | null> {
    if (this.checkExpiry(key)) return null;
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    if (this.checkExpiry(key)) return {};
    const hash = this.hashes.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash.entries());
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    const hash = this.hashes.get(key)!;
    const current = parseInt(hash.get(field) || '0');
    const newVal = current + increment;
    hash.set(field, String(newVal));
    return newVal;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    const hash = this.hashes.get(key);
    if (!hash) return 0;
    let deleted = 0;
    for (const field of fields) {
      if (hash.delete(field)) deleted++;
    }
    return deleted;
  }

  async ttl(key: string): Promise<number> {
    const expiry = this.expiries.get(key);
    if (!expiry) return -1;
    if (Date.now() > expiry) {
      this.expiries.delete(key);
      return -2;
    }
    return Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
  }

  // ── Custom Lua-script-backed commands (declared in client.ts) ──────────────

  /** Sliding-window rate limit via ZSET. Returns [hits, oldestExpiryMs]. */
  async slidingWindowRateLimit(
    key: string,
    nowMs: number,
    windowMs: number,
    member: string,
  ): Promise<[number, number]> {
    await this.zremrangebyscore(key, '-inf', nowMs - windowMs);
    await this.zadd(key, nowMs, member);
    await this.pexpire(key, windowMs);
    const hits = await this.zcard(key);
    const oldest = await this.zrange(key, 0, 0, 'WITHSCORES');
    const oldestScore = oldest.length >= 2 ? Number(oldest[1]) : nowMs;
    return [hits, oldestScore + windowMs];
  }

  /** Fixed-window counter for guest chat quota. Returns [count, ttlSeconds]. */
  async guestFixedWindowIncr(
    key: string,
    windowSeconds: number,
  ): Promise<[number, number]> {
    const count = await this.incr(key);
    if (count === 1) {
      await this.expire(key, windowSeconds);
    }
    const ttl = await this.ttl(key);
    return [count, Math.max(0, ttl)];
  }

  /** Append JSON entries to a list, bounded by maxLength and maxChars. */
  async guestAppendTranscript(
    key: string,
    entryJson: string,
    maxLength: number,
    maxChars: number,
    windowSeconds: number,
  ): Promise<number> {
    await this.rpush(key, entryJson);
    // Enforce max length
    const len = await this.llen(key);
    if (len > maxLength) {
      const excess = len - maxLength;
      for (let i = 0; i < excess; i++) {
        await this.lpop(key);
      }
    }
    // Enforce max chars
    const items = await this.lrange(key, 0, -1);
    let totalChars = items.reduce((sum, item) => sum + item.length, 0);
    while (totalChars > maxChars && items.length > 1) {
      const removed = items.shift()!;
      totalChars -= removed.length;
      await this.lpop(key);
    }
    // Set TTL if not set
    const ttl = await this.ttl(key);
    if (ttl === -1) {
      await this.expire(key, windowSeconds);
    }
    return items.length;
  }

  /** Return a duplicate "client" (same in-memory store for mock). */
  duplicate(): MockRedis {
    // MockRedis is a singleton in-memory store — just return `this`
    return this;
  }

  /** Minimal subscribe (no-op for mock). */
  async subscribe(_channel: string): Promise<number> {
    return 1;
  }

  /** Minimal lpop */
  async lpop(key: string): Promise<string | null> {
    const list = this.lists.get(key);
    if (!list || list.length === 0) return null;
    return list.shift() ?? null;
  }

  /** List length */
  async llen(key: string): Promise<number> {
    const list = this.lists.get(key);
    return list ? list.length : 0;
  }
}

export default MockRedis;
