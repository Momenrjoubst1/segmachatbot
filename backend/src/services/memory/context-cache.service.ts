/**
 * Context Caching Service
 * نظام تخزين مؤقت ذكي مستوحى من Gemini Context Caching
 * يعمل مع أي نموذج AI
 */

import redis from '../../config/redis/client.js';
import crypto from 'crypto';
import { MemoryConfig } from '../../config/memory.config.js';
import { logger } from '../../utils/logger.js';

interface CacheEntry {
  content: string;
  hash: string;
  createdAt: number;
  accessCount: number;
  lastAccessedAt: number;
  size: number;
  metadata?: Record<string, any>;
}

interface CacheStats {
  hits: number;
  misses: number;
  totalSize: number;
  entries: number;
}

class ContextCacheService {
  private static instance: ContextCacheService;
  private readonly prefix = 'context_cache:';
  private readonly statsKey = 'context_cache:stats';

  private constructor() {}

  static getInstance(): ContextCacheService {
    if (!ContextCacheService.instance) {
      ContextCacheService.instance = new ContextCacheService();
    }
    return ContextCacheService.instance;
  }

  /**
   * توليد hash فريد للمحتوى
   */
  private generateHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * توليد مفتاح الـ cache
   */
  private getCacheKey(userId: string, hash: string): string {
    return `${this.prefix}${userId}:${hash}`;
  }

  /**
   * حفظ محتوى في الـ cache
   */
  async set(
    userId: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<{ cached: boolean; hash: string; reason?: string }> {
    if (!MemoryConfig.caching.enabled) {
      return { cached: false, hash: '', reason: 'caching_disabled' };
    }

    // تحقق من الحد الأدنى للحجم
    if (content.length < MemoryConfig.caching.minContentSize) {
      return { cached: false, hash: '', reason: 'content_too_small' };
    }

    try {
      const hash = this.generateHash(content);
      const cacheKey = this.getCacheKey(userId, hash);

      // تحقق إذا كان موجود مسبقاً
      const existing = await redis.get(cacheKey);
      if (existing) {
        // تحديث إحصائيات الوصول
        const entry: CacheEntry = JSON.parse(existing);
        entry.accessCount++;
        entry.lastAccessedAt = Date.now();
        await redis.setex(cacheKey, MemoryConfig.caching.ttl, JSON.stringify(entry));
        
        if (MemoryConfig.debug.enabled) {
          logger.info('[Context Cache] Cache hit (update)', { userId, hash: hash.substring(0, 8) });
        }
        
        return { cached: true, hash };
      }

      // إنشاء إدخال جديد
      const entry: CacheEntry = {
        content,
        hash,
        createdAt: Date.now(),
        accessCount: 1,
        lastAccessedAt: Date.now(),
        size: content.length,
        metadata,
      };

      // حفظ في Redis مع TTL
      await redis.setex(cacheKey, MemoryConfig.caching.ttl, JSON.stringify(entry));

      // تحديث الإحصائيات
      await this.updateStats('entries', 1);
      await this.updateStats('totalSize', content.length);

      if (MemoryConfig.debug.enabled) {
        logger.info('[Context Cache] Content cached', {
          userId,
          hash: hash.substring(0, 8),
          size: content.length,
          ttl: MemoryConfig.caching.ttl,
        });
      }

      return { cached: true, hash };
    } catch (error) {
      logger.error('[Context Cache] Error caching content', { error, userId });
      return { cached: false, hash: '', reason: 'error' };
    }
  }

  /**
   * استرجاع محتوى من الـ cache
   */
  async get(userId: string, hash: string): Promise<{ found: boolean; content?: string; metadata?: Record<string, any> }> {
    if (!MemoryConfig.caching.enabled) {
      return { found: false };
    }

    try {
      const cacheKey = this.getCacheKey(userId, hash);
      const cached = await redis.get(cacheKey);

      if (!cached) {
        await this.updateStats('misses', 1);
        if (MemoryConfig.debug.enabled) {
          logger.info('[Context Cache] Cache miss', { userId, hash: hash.substring(0, 8) });
        }
        return { found: false };
      }

      const entry: CacheEntry = JSON.parse(cached);
      
      // تحديث إحصائيات الوصول
      entry.accessCount++;
      entry.lastAccessedAt = Date.now();
      await redis.setex(cacheKey, MemoryConfig.caching.ttl, JSON.stringify(entry));

      await this.updateStats('hits', 1);

      if (MemoryConfig.debug.enabled) {
        logger.info('[Context Cache] Cache hit', {
          userId,
          hash: hash.substring(0, 8),
          accessCount: entry.accessCount,
        });
      }

      return {
        found: true,
        content: entry.content,
        metadata: entry.metadata,
      };
    } catch (error) {
      logger.error('[Context Cache] Error retrieving from cache', { error, userId, hash });
      return { found: false };
    }
  }

  /**
   * البحث عن محتوى مشابه في الـ cache
   */
  async findSimilar(userId: string, content: string, threshold = 0.8): Promise<{ found: boolean; hash?: string; similarity?: number }> {
    if (!MemoryConfig.caching.enabled) {
      return { found: false };
    }

    try {
      const contentHash = this.generateHash(content);
      
      // بحث سريع بالـ hash أولاً
      const exactMatch = await this.get(userId, contentHash);
      if (exactMatch.found) {
        return { found: true, hash: contentHash, similarity: 1.0 };
      }

      // استخدام SCAN بدلاً من KEYS (آمن للإنتاج)
      const pattern = `${this.prefix}${userId}:*`;
      const keys = await this.scanKeys(pattern, 200); // فحص أول 200 لكل تحسين التشابه
      
      if (keys.length === 0) {
        return { found: false };
      }

      // بحث بالتشابه (مبسط - يمكن تحسينه بـ embeddings)
      for (const key of keys) {
        const cached = await redis.get(key);
        if (!cached) continue;

        const entry: CacheEntry = JSON.parse(cached);
        const similarity = this.calculateSimilarity(content, entry.content);

        if (similarity >= threshold) {
          return { found: true, hash: entry.hash, similarity };
        }
      }

      return { found: false };
    } catch (error) {
      logger.error('[Context Cache] Error finding similar content', { error, userId });
      return { found: false };
    }
  }

  /**
   * مسح كل الـ cache للمستخدم (using SCAN بدلاً من KEYS)
   */
  async clearUserCache(userId: string): Promise<number> {
    try {
      const pattern = `${this.prefix}${userId}:*`;
      const keys = await this.scanKeys(pattern, 1000);
      
      if (keys.length === 0) {
        return 0;
      }

      await redis.del(...keys);
      
      if (MemoryConfig.debug.enabled) {
        logger.info('[Context Cache] User cache cleared', { userId, count: keys.length });
      }
      
      return keys.length;
    } catch (error) {
      logger.error('[Context Cache] Error clearing user cache', { error, userId });
      return 0;
    }
  }

  /**
   * تنظيف الـ cache القديم (صيانة) - باستخدام SCAN
   */
  async cleanup(): Promise<{ cleaned: number; errors: number }> {
    let cleaned = 0;
    let errors = 0;

    try {
      const pattern = `${this.prefix}*`;
      const keys = await this.scanKeys(pattern, 1000);

      for (const key of keys) {
        try {
          const ttl = await redis.ttl(key);
          if (ttl === -1) {
            // لا يوجد TTL، احذفه
            await redis.del(key);
            cleaned++;
          }
        } catch (entryErr) {
          errors++;
          logger.warn('[Context Cache] Failed to check TTL for key during cleanup', { error: (entryErr as Error)?.message });
        }
      }

      if (MemoryConfig.debug.enabled) {
        logger.info('[Context Cache] Cleanup completed', { cleaned, errors });
      }
    } catch (error) {
      logger.error('[Context Cache] Error during cleanup', { error });
    }

    return { cleaned, errors };
  }

  /**
   * Helper: SCAN بدلاً من KEYS (آمن للإنتاج)
   */
  private async scanKeys(pattern: string, limit: number): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    
    do {
      const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
      
      if (keys.length >= limit) {
        break;
      }
    } while (cursor !== '0' && keys.length < limit);
    
    return keys.slice(0, limit);
  }

  /**
   * حساب التشابه بين نصين (مبسط)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    // خوارزمية بسيطة - يمكن استبدالها بـ embeddings للدقة
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  /**
   * حذف محتوى من الـ cache
   */
  async delete(userId: string, hash: string): Promise<boolean> {
    try {
      const cacheKey = this.getCacheKey(userId, hash);
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        const entry: CacheEntry = JSON.parse(cached);
        await redis.del(cacheKey);
        await this.updateStats('entries', -1);
        await this.updateStats('totalSize', -entry.size);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('[Context Cache] Error deleting from cache', { error, userId, hash });
      return false;
    }
  }

  /**
   * الحصول على إحصائيات الـ cache
   */
  async getStats(): Promise<CacheStats> {
    try {
      const stats = await redis.hgetall(this.statsKey);
      return {
        hits: parseInt(stats.hits || '0'),
        misses: parseInt(stats.misses || '0'),
        totalSize: parseInt(stats.totalSize || '0'),
        entries: parseInt(stats.entries || '0'),
      };
    } catch (error) {
      logger.error('[Context Cache] Error getting stats', { error });
      return { hits: 0, misses: 0, totalSize: 0, entries: 0 };
    }
  }

  /**
   * تحديث الإحصائيات
   */
  private async updateStats(field: string, increment: number): Promise<void> {
    try {
      await redis.hincrby(this.statsKey, field, increment);
    } catch (error) {
      logger.error('[Context Cache] Error updating stats', { error, field, increment });
    }
  }

  /**
   * إعادة تعيين الإحصائيات
   */
  async resetStats(): Promise<void> {
    try {
      await redis.del(this.statsKey);
      if (MemoryConfig.debug.enabled) {
        logger.info('[Context Cache] Stats reset');
      }
    } catch (error) {
      logger.error('[Context Cache] Error resetting stats', { error });
    }
  }
}

// Export singleton instance
export const contextCache = ContextCacheService.getInstance();
