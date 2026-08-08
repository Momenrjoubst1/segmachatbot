/**
 * Cross-Session Recall Service
 * نظام التذكر عبر المحادثات - مستوحى من Gemini
 * يربط المحادثات القديمة بالجديدة
 */

import { knowledgeSupabase as supabase } from '../../config/supabase.config.js';
import { MemoryConfig } from '../../config/memory.config.js';
import { logger } from '../../utils/logger.js';
import { generateEmbedding, generateEmbeddings } from '../rag/embedding-service.js';
import { cosineSimilarity } from 'ai';

interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ChatMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

interface CrossSessionResult {
  sessionId: string;
  sessionTitle: string;
  messages: ChatMessage[];
  relevanceScore: number;
  timestamp: string;
}

class CrossSessionService {
  private static instance: CrossSessionService;

  private constructor() {}

  static getInstance(): CrossSessionService {
    if (!CrossSessionService.instance) {
      CrossSessionService.instance = new CrossSessionService();
    }
    return CrossSessionService.instance;
  }

  /**
   * البحث في المحادثات السابقة
   */
  async searchPreviousChats(
    userId: string,
    query: string,
    currentSessionId?: string
  ): Promise<CrossSessionResult[]> {
    if (!MemoryConfig.crossSession.enabled) {
      return [];
    }

    try {
      // الحصول على المحادثات السابقة
      const sessions = await this.getRecentSessions(userId, currentSessionId);

      if (sessions.length === 0) {
        return [];
      }

      // البحث في كل محادثة
      const results: CrossSessionResult[] = [];

      for (const session of sessions) {
        const relevantMessages = await this.searchInSession(
          session.id,
          query,
          MemoryConfig.crossSession.resultsPerChat
        );

        if (relevantMessages.length > 0) {
          results.push({
            sessionId: session.id,
            sessionTitle: session.title || 'محادثة سابقة',
            messages: relevantMessages,
            relevanceScore: this.calculateRelevance(query, relevantMessages),
            timestamp: session.updated_at,
          });
        }
      }

      // ترتيب حسب الصلة
      results.sort((a, b) => b.relevanceScore - a.relevanceScore);

      if (MemoryConfig.debug.enabled && results.length > 0) {
        logger.info('[Cross-Session] Found relevant previous chats', {
          userId,
          count: results.length,
          topScore: results[0]?.relevanceScore,
        });
      }

      return results.slice(0, 5); // أفضل 5 نتائج
    } catch (error) {
      logger.error('[Cross-Session] Error searching previous chats', { error, userId });
      return [];
    }
  }

  /**
   * الحصول على المحادثات الأخيرة
   */
  private async getRecentSessions(
    userId: string,
    excludeSessionId?: string
  ): Promise<ChatSession[]> {
    try {
      const maxAgeDays = MemoryConfig.crossSession.maxChatAgeDays;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

      let query = supabase
        .from('chat_sessions')
        .select('id, user_id, title, created_at, updated_at')
        .eq('user_id', userId)
        .gte('updated_at', cutoffDate.toISOString())
        .order('updated_at', { ascending: false })
        .limit(MemoryConfig.crossSession.maxPreviousChats);

      if (excludeSessionId) {
        query = query.neq('id', excludeSessionId);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('[Cross-Session] Error getting sessions', { error, userId });
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('[Cross-Session] Error in getRecentSessions', { error, userId });
      return [];
    }
  }

  /**
   * البحث في محادثة محددة
   */
  private async searchInSession(
    sessionId: string,
    query: string,
    limit: number
  ): Promise<ChatMessage[]> {
    try {
      // استراتيجية 1: البحث النصي البسيط
      const textResults = await this.textSearch(sessionId, query, limit);

      // استراتيجية 2: البحث بالـ embeddings (إذا كان متاحاً)
      if (process.env.SUPABASE_URL) {
        try {
          const embeddingResults = await this.embeddingSearch(sessionId, query, limit);
          
          // دمج النتائج
          const combined = [...textResults, ...embeddingResults];
          const unique = this.deduplicateMessages(combined);
          
          return unique.slice(0, limit);
        } catch (embError) {
          logger.warn('[Cross-Session] Embedding search failed, falling back to text search', { error: (embError as Error)?.message, sessionId });
          return textResults;
        }
      }

      return textResults;
    } catch (error) {
      logger.error('[Cross-Session] Error searching in session', { error, sessionId });
      return [];
    }
  }

  /**
   * البحث النصي البسيط
   */
  private async textSearch(
    sessionId: string,
    query: string,
    limit: number
  ): Promise<ChatMessage[]> {
    try {
      // استخراج الكلمات المفتاحية
      const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2)
        .slice(0, 5); // أول 5 كلمات

      if (keywords.length === 0) {
        return [];
      }

      // البحث في الرسائل
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(100); // فحص آخر 100 رسالة

      if (error || !data) {
        return [];
      }

      // تصفية الرسائل المطابقة
      const matches = data.filter(msg => {
        const content = msg.content.toLowerCase();
        return keywords.some(keyword => content.includes(keyword));
      });

      return matches.slice(0, limit);
    } catch (error) {
      logger.error('[Cross-Session] Error in text search', { error, sessionId });
      return [];
    }
  }

  /**
   * البحث بالـ embeddings باستخدام cosine similarity
   * يولد embeddings لرسائل المحادثة ويقارنها مع استعلام المستخدم
   */
  private async embeddingSearch(
    sessionId: string,
    query: string,
    limit: number
  ): Promise<ChatMessage[]> {
    try {
      const queryEmbedding = await generateEmbedding(query);
      if (!queryEmbedding) {
        return [];
      }

      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error || !data || data.length === 0) {
        return [];
      }

      const embeddings = await generateEmbeddings(
        data.map(m => m.content.substring(0, 500))
      );

      if (!embeddings || embeddings.length === 0) {
        return [];
      }

      const scored = data
        .map((msg, i) => ({
          message: msg,
          score: embeddings[i]
            ? cosineSimilarity(queryEmbedding, embeddings[i])
            : 0,
        }))
        .filter(item => item.score > 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return scored.map(item => item.message);
    } catch (error) {
      logger.error('[Cross-Session] Error in embedding search', { error, sessionId });
      return [];
    }
  }

  /**
   * حساب درجة الصلة
   */
  private calculateRelevance(query: string, messages: ChatMessage[]): number {
    if (messages.length === 0) {
      return 0;
    }

    const queryWords = new Set(
      query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    );

    let totalScore = 0;
    for (const msg of messages) {
      const msgWords = new Set(
        msg.content.toLowerCase().split(/\s+/).filter(w => w.length > 2)
      );

      // حساب Jaccard similarity
      const intersection = new Set([...queryWords].filter(x => msgWords.has(x)));
      const union = new Set([...queryWords, ...msgWords]);
      const similarity = intersection.size / union.size;

      totalScore += similarity;
    }

    return totalScore / messages.length;
  }

  /**
   * إزالة التكرار من الرسائل
   */
  private deduplicateMessages(messages: ChatMessage[]): ChatMessage[] {
    const seen = new Set<string>();
    const unique: ChatMessage[] = [];

    for (const msg of messages) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        unique.push(msg);
      }
    }

    return unique;
  }

  /**
   * بناء سياق من المحادثات السابقة
   */
  async buildCrossSessionContext(
    userId: string,
    query: string,
    currentSessionId?: string
  ): Promise<string> {
    try {
      const results = await this.searchPreviousChats(userId, query, currentSessionId);

      if (results.length === 0) {
        return '';
      }

      const sections: string[] = [];

      for (const result of results.slice(0, 3)) { // أفضل 3 نتائج
        const messages = result.messages
          .map(m => `${m.role === 'user' ? 'المستخدم' : 'المساعد'}: ${m.content.substring(0, 200)}`)
          .join('\n');

        sections.push(`**من محادثة سابقة (${result.sessionTitle}):**\n${messages}`);
      }

      return `\n**معلومات من محادثات سابقة:**\n${sections.join('\n\n')}\n`;
    } catch (error) {
      logger.error('[Cross-Session] Error building context', { error, userId });
      return '';
    }
  }

  /**
   * الحصول على ملخص المحادثات السابقة
   */
  async getPreviousChatsummary(userId: string, limit = 5): Promise<string[]> {
    try {
      const sessions = await this.getRecentSessions(userId);

      const summaries: string[] = [];

      for (const session of sessions.slice(0, limit)) {
        const { data: messages } = await supabase
          .from('chat_messages')
          .select('content')
          .eq('session_id', session.id)
          .eq('role', 'user')
          .order('created_at', { ascending: true })
          .limit(3);

        if (messages && messages.length > 0) {
          const topics = messages.map(m => m.content.substring(0, 50)).join('، ');
          summaries.push(`${session.title || 'محادثة'}: ${topics}`);
        }
      }

      return summaries;
    } catch (error) {
      logger.error('[Cross-Session] Error getting summaries', { error, userId });
      return [];
    }
  }

  /**
   * ربط محادثتين (للمحادثات المرتبطة)
   */
  async linkSessions(sessionId1: string, sessionId2: string, reason?: string): Promise<boolean> {
    try {
      // يمكن إضافة جدول session_links في المستقبل
      // هذا مثال بسيط
      if (MemoryConfig.debug.enabled) {
        logger.info('[Cross-Session] Sessions linked', { sessionId1, sessionId2, reason });
      }
      return true;
    } catch (error) {
      logger.error('[Cross-Session] Error linking sessions', { error });
      return false;
    }
  }
}

// Export singleton instance
export const crossSession = CrossSessionService.getInstance();
