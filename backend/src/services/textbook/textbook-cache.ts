// Textbook search cache: LRU cache implementation.

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_SIZE = 100;

export class LRUCache<K, V> {
  private cache = new Map<K, { value: V; expiry: number }>();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number, ttl: number) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiry < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, { value, expiry: Date.now() + this.ttl });
  }

  delete(key: K): void {
    this.cache.delete(key);
  }
}

export const structureCache = new LRUCache<string, Array<{ id: string; level?: string; title?: string; page_start?: number; page_end?: number; textbook_id?: string; children?: unknown[] }>>(CACHE_MAX_SIZE, CACHE_TTL_MS);
export const curriculumCache = new LRUCache<string, Array<{ id: string; level: string; title: string; page_start: number; page_end: number; textbook_id?: string }>>(CACHE_MAX_SIZE, CACHE_TTL_MS);
export const sectionEmbeddingCache = new LRUCache<string, Map<string, number[]>>(CACHE_MAX_SIZE, CACHE_TTL_MS);

export function invalidateStructureCache(userId: string): void {
  structureCache.delete(`structure:${userId}`);
  curriculumCache.delete(`curriculum:${userId}`);
}
