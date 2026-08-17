/**
 * Enhanced Memory Bank Service
 * نظام ذاكرة دائمة محسّن - مستوحى من Gemini Memory Bank
 * يحفظ معلومات المستخدم بشكل ذكي ومنظم
 */

import { supabase } from '../../config/supabase.config.js';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { MemoryConfig, type MemoryCategory } from '../../config/memory.config.js';
import { logger } from '../../utils/logger.js';

interface EnhancedMemoryEntry {
  id?: string;
  user_id: string;
  category: MemoryCategory;
  key: string;
  value: any;
  confidence: number; // 0-1
  source: 'extracted' | 'explicit' | 'inferred';
  created_at?: string;
  updated_at?: string;
  expires_at?: string | null;
  metadata?: Record<string, any>;
}

class EnhancedMemoryService {
  private static instance: EnhancedMemoryService;

  private constructor() {}

  static getInstance(): EnhancedMemoryService {
    if (!EnhancedMemoryService.instance) {
      EnhancedMemoryService.instance = new EnhancedMemoryService();
    }
    return EnhancedMemoryService.instance;
  }

  /**
   * استخراج ذكريات من المحادثة
   */
  async extractMemories(
    userId: string,
    messages: { role: string; content: string }[],
    threadId?: string
  ): Promise<EnhancedMemoryEntry[]> {
    if (!MemoryConfig.memoryBank.enabled) {
      return [];
    }

    if (messages.length < MemoryConfig.memoryBank.minMessagesForExtraction) {
      return [];
    }

    try {
      // الحصول على الذكريات الموجودة لتجنب التكرار
      const existing = await this.getAllMemories(userId);
      const existingKeys = new Set(existing.map(e => e.key));

      // استخراج الذكريات باستخدام AI
      const extracted = await this.extractWithAI(messages, existingKeys);

      // حفظ الذكريات الجديدة
      const saved: EnhancedMemoryEntry[] = [];
      for (const memory of extracted) {
        const result = await this.setMemory(
          userId,
          memory.category,
          memory.key,
          memory.value,
          {
            confidence: memory.confidence,
            source: 'extracted',
            threadId,
          }
        );
        if (result) {
          saved.push(result);
        }
      }

      if (MemoryConfig.debug.enabled && saved.length > 0) {
        logger.info('[Enhanced Memory] Extracted memories', {
          userId,
          count: saved.length,
          categories: [...new Set(saved.map(m => m.category))],
        });
      }

      return saved;
    } catch (error) {
      logger.error('[Enhanced Memory] Error extracting memories', { error, userId });
      return [];
    }
  }

  /**
   * استخراج الذكريات باستخدام AI
   */
  private async extractWithAI(
    messages: { role: string; content: string }[],
    existingKeys: Set<string>
  ): Promise<Array<{ category: MemoryCategory; key: string; value: any; confidence: number }>> {
    const conversationText = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const prompt = `أنت خبير في استخراج المعلومات المهمة من المحادثات.
استخرج المعلومات المهمة التالية من المحادثة وصنفها:

**الفئات المتاحة:**
- personal: معلومات شخصية (الاسم، العمر، المهنة، إلخ)
- academic: معلومات أكاديمية (التخصص، المواد، المعدل، إلخ)
- preference: تفضيلات (اللغة، أسلوب الرد، المواضيع المفضلة، إلخ)
- context: سياق (المشاريع الحالية، التحديات، إلخ)
- goal: أهداف (ما يريد تحقيقه)
- schedule: جدول (مواعيد، امتحانات، إلخ)
- behavior: سلوك (عادات، أنماط، إلخ)

**المحادثة:**
${conversationText}

**تعليمات:**
1. استخرج فقط المعلومات المهمة والدائمة
2. لا تستخرج معلومات مؤقتة أو غير مهمة
3. أعط كل معلومة درجة ثقة من 0 إلى 1
4. تجنب المعلومات الموجودة مسبقاً: ${Array.from(existingKeys).join(', ')}

**الرد بصيغة JSON فقط:**
[
  {
    "category": "academic",
    "key": "major",
    "value": "هندسة كهربائية",
    "confidence": 0.95
  }
]`;

    try {
      const model = this.getModel();
      const { text } = await generateText({
        model,
        prompt,
        maxOutputTokens: 1000,
        temperature: 0.2,
      });

      // استخراج JSON من الرد
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warn('[Enhanced Memory] No JSON found in AI response', { text: text.substring(0, 100) });
        return [];
      }

      try {
        const extracted = JSON.parse(jsonMatch[0]);
        
        // تصفية النتائج
        return extracted.filter((item: any) => 
          item.category &&
          item.key &&
          item.value &&
          item.confidence >= 0.7 &&
          MemoryConfig.memoryBank.categories.includes(item.category) &&
          !existingKeys.has(item.key)
        );
      } catch (parseError) {
        logger.error('[Enhanced Memory] JSON parse error', { parseError, text: text.substring(0, 200) });
        return [];
      }
    } catch (error) {
      logger.error('[Enhanced Memory] Error in AI extraction', { error });
      return [];
    }
  }

  /**
   * حفظ ذاكرة
   */
  async setMemory(
    userId: string,
    category: MemoryCategory,
    key: string,
    value: any,
    options?: {
      confidence?: number;
      source?: 'extracted' | 'explicit' | 'inferred';
      threadId?: string;
      expiresIn?: number; // milliseconds
    }
  ): Promise<EnhancedMemoryEntry | null> {
    try {
      const entry: EnhancedMemoryEntry = {
        user_id: userId,
        category,
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
        confidence: options?.confidence ?? 1.0,
        source: options?.source ?? 'explicit',
        expires_at: options?.expiresIn ? new Date(Date.now() + options.expiresIn).toISOString() : null,
        metadata: {
          threadId: options?.threadId,
          timestamp: new Date().toISOString(),
        },
      };

      // تحقق من الحد الأقصى
      const count = await this.getMemoryCount(userId);
      if (count >= MemoryConfig.memoryBank.maxFactsPerUser) {
        // حذف أقدم ذاكرة بثقة منخفضة
        await this.removeOldestLowConfidence(userId);
      }

      const { data, error } = await supabase
        .from('user_memory')
        .upsert(entry, { onConflict: 'user_id,key' })
        .select()
        .single();

      if (error) {
        logger.error('[Enhanced Memory] Error saving memory', { error, userId, key });
        return null;
      }

      return data;
    } catch (error) {
      logger.error('[Enhanced Memory] Error in setMemory', { error, userId, key });
      return null;
    }
  }

  /**
   * الحصول على ذاكرة محددة
   */
  async getMemory(userId: string, key: string): Promise<EnhancedMemoryEntry | null> {
    try {
      const { data, error } = await supabase
        .from('user_memory')
        .select('*')
        .eq('user_id', userId)
        .eq('key', key)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      // تحقق من انتهاء الصلاحية
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        await this.deleteMemory(userId, key);
        return null;
      }

      return data;
    } catch (error) {
      logger.error('[Enhanced Memory] Error getting memory', { error, userId, key });
      return null;
    }
  }

  /**
   * الحصول على كل الذكريات
   */
  async getAllMemories(userId: string, category?: MemoryCategory): Promise<EnhancedMemoryEntry[]> {
    try {
      let query = supabase
        .from('user_memory')
        .select('*')
        .eq('user_id', userId);

      if (category) {
        query = query.eq('category', category);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        logger.error('[Enhanced Memory] Error getting all memories', { error, userId });
        return [];
      }

      // تصفية المنتهية الصلاحية
      const now = new Date();
      return (data || []).filter(m => !m.expires_at || new Date(m.expires_at) > now);
    } catch (error) {
      logger.error('[Enhanced Memory] Error in getAllMemories', { error, userId });
      return [];
    }
  }

  /**
   * بناء سياق الذاكرة للمحادثة
   */
  async buildMemoryContext(userId: string): Promise<string> {
    try {
      const memories = await this.getAllMemories(userId);

      if (memories.length === 0) {
        return '';
      }

      // تجميع حسب الفئة
      const grouped: Partial<Record<MemoryCategory, Record<string, unknown>>> = {};
      for (const memory of memories) {
        if (!grouped[memory.category]) {
          grouped[memory.category] = {};
        }
        grouped[memory.category]![memory.key] = memory.value;
      }

      // بناء النص
      const sections: string[] = [];

      const categoryLabels: Record<MemoryCategory, string> = {
        personal: '👤 معلومات شخصية',
        academic: '📚 معلومات أكاديمية',
        preference: '⚙️ التفضيلات',
        context: '📋 السياق الحالي',
        goal: '🎯 الأهداف',
        schedule: '📅 الجدول',
        behavior: '🧠 الأنماط السلوكية',
      };

      for (const [category, items] of Object.entries(grouped)) {
        const label = categoryLabels[category as MemoryCategory] || category;
        const itemsList = Object.entries(items!)
          .map(([key, value]) => `  - ${key.replace(/_/g, ' ')}: ${value}`)
          .join('\n');
        
        sections.push(`**${label}:**\n${itemsList}`);
      }

      return sections.join('\n\n');
    } catch (error) {
      logger.error('[Enhanced Memory] Error building context', { error, userId });
      return '';
    }
  }

  /**
   * حذف ذاكرة
   */
  async deleteMemory(userId: string, key: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('user_memory')
        .delete()
        .eq('user_id', userId)
        .eq('key', key);

      return !error;
    } catch (error) {
      logger.error('[Enhanced Memory] Error deleting memory', { error, userId, key });
      return false;
    }
  }

  /**
   * مسح كل الذكريات
   */
  async clearAllMemories(userId: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('user_memory')
        .delete()
        .eq('user_id', userId)
        .select();

      if (error) {
        return 0;
      }

      return data?.length || 0;
    } catch (error) {
      logger.error('[Enhanced Memory] Error clearing memories', { error, userId });
      return 0;
    }
  }

  /**
   * عدد الذكريات
   */
  private async getMemoryCount(userId: string): Promise<number> {
    try {
      const { count } = await supabase
        .from('user_memory')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      return count || 0;
    } catch (_error) {
      logger.warn('[Enhanced Memory] Failed to get memory count', { userId });
      return 0;
    }
  }

  /**
   * حذف أقدم ذاكرة بثقة منخفضة
   */
  private async removeOldestLowConfidence(userId: string): Promise<void> {
    try {
      const { data } = await supabase
        .from('user_memory')
        .select('key')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (data) {
        await this.deleteMemory(userId, data.key);
      }
    } catch (error) {
      logger.error('[Enhanced Memory] Error removing old memory', { error, userId });
    }
  }

  /**
   * الحصول على النموذج
   */
  private getModel() {
    const azureKey = process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    const azureEndpoint = process.env.AZURE_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
    const azureModel = process.env.AZURE_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4o-mini';

    if (azureKey) {
      const cleanEndpoint = azureEndpoint ? azureEndpoint.replace(/\/$/, '') : undefined;
      if (!cleanEndpoint) {
        throw new Error('AZURE_EMBEDDING_ENDPOINT (or AZURE_ENDPOINT / AZURE_OPENAI_ENDPOINT) environment variable is not set. Cannot create OpenAI client.');
      }
      return createOpenAI({
        baseURL: cleanEndpoint,
        apiKey: azureKey,
        headers: {
          "api-key": azureKey,
        },
      }).chat(azureModel);
    } else if (process.env.OPENROUTER_API_KEY) {
      return createOpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY,
      }).chat('openai/gpt-4o-mini');
    }
    throw new Error('No AI provider configured');
  }
}

// Export singleton instance
export const enhancedMemory = EnhancedMemoryService.getInstance();
