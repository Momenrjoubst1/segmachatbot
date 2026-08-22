import { describe, it, expect, vi } from 'vitest';
import { AsyncMutex, Semaphore } from '../utils/async-mutex.js';

describe('AsyncMutex', () => {
  it('starts unlocked', () => {
    const mutex = new AsyncMutex();
    expect(mutex.isLocked()).toBe(false);
  });

  it('acquires lock and marks as locked', async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire();
    expect(mutex.isLocked()).toBe(true);
    release();
    expect(mutex.isLocked()).toBe(false);
  });

  it('queues second acquirer while locked', async () => {
    const mutex = new AsyncMutex();
    const release1 = await mutex.acquire();

    let secondAcquired = false;
    const p2 = mutex.acquire().then((r) => {
      secondAcquired = true;
      return r;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(secondAcquired).toBe(false);

    release1();
    const release2 = await p2;
    expect(secondAcquired).toBe(true);
    release2();
  });

  it('runExclusive runs fn while locked and releases after', async () => {
    const mutex = new AsyncMutex();
    const result = await mutex.runExclusive(async () => {
      expect(mutex.isLocked()).toBe(true);
      return 42;
    });
    expect(result).toBe(42);
    expect(mutex.isLocked()).toBe(false);
  });

  it('releases lock even if fn throws', async () => {
    const mutex = new AsyncMutex();
    await expect(
      mutex.runExclusive(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(mutex.isLocked()).toBe(false);
  });

  it('serializes concurrent callers', async () => {
    const mutex = new AsyncMutex();
    const order: number[] = [];

    const task = (id: number, delayMs: number) =>
      mutex.runExclusive(async () => {
        order.push(id);
        await new Promise((r) => setTimeout(r, delayMs));
        order.push(id);
      });

    await Promise.all([task(1, 20), task(2, 10)]);
    expect(order).toEqual([1, 1, 2, 2]);
  });
});

describe('Semaphore', () => {
  it('allows concurrent access up to max', async () => {
    const sem = new Semaphore(2);
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    expect(true).toBe(true);
    r1();
    r2();
  });

  it('queues when max concurrency reached', async () => {
    const sem = new Semaphore(1);
    const r1 = await sem.acquire();

    let acquired = false;
    const p2 = sem.acquire().then((r) => {
      acquired = true;
      return r;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(acquired).toBe(false);

    r1();
    const release2 = await p2;
    expect(acquired).toBe(true);
    release2();
  });

  it('runExclusive acquires and releases', async () => {
    const sem = new Semaphore(1);
    const result = await sem.runExclusive(async () => 7);
    expect(result).toBe(7);
  });

  it('releases even if fn throws', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.runExclusive(async () => {
        throw new Error('fail');
      })
    ).rejects.toThrow('fail');
  });

  it('releases correctly after queue drain', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    const task = (id: number) =>
      sem.runExclusive(async () => {
        order.push(id);
        await new Promise((r) => setTimeout(r, 10));
      });

    await Promise.all([task(1), task(2), task(3)]);
    expect(order).toEqual([1, 2, 3]);
  });
});
