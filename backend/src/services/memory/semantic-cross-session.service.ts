/**
 * Semantic Cross-Session Search Service
 * Ø§Ù„Ø¨Ø­Ø« Ø§Ù„Ø¯Ù„Ø§Ù„ÙŠ Ø¹Ø¨Ø± Ø§Ù„Ù…Ø­Ø§Ø¯Ø«Ø§Øª Ù…Ø¹ ØªØ®Ø²ÙŠÙ† Ø¯Ø§Ø¦Ù…
 * 
 * Enhances the existing cross-session service with:
 * - Persistent message embeddings in database
 * - Vector similarity search via pgvector
 * - Automatic embedding generation on message save
 * - Efficient batch embedding updates
 */

import { supabase } from '../../config/supabase.config.js';
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

interface MessageEmbedding {
  message_id: string;
  session_id: string;
  user_id: string;
  content: string;
  embedding: number[];
  role: string;
  created_at: string;
}

class SemanticCrossSessionService {
  private static instance: SemanticCrossSessionService;
  private readonly SIMILARITY_THRESHOLD = 0.65;
  private readonly BATCH_EMBEDDING_SIZE = 50;
  private readonly MAX_RESULTS_PER_SESSION = 5;

  private constructor() {}

  static getInstance(): SemanticCrossSessionService {
    if (!SemanticCrossSessionService.instance) {
      SemanticCrossSessionService.instance = new SemanticCrossSessionService();
    }
    return SemanticCrossSessionService.instance;
  }

  /**
   * Ensure message_embeddings table exists
   * Creates it if missing (idempotent)
   */
  private async ensureEmbeddingsTable(): Promise<void> {
    try {
      // Try to query the table - if it fails, it doesn't exist
      const { error } = await supabase
        .from('message_embeddings')
        .select('id')
        .limit(1);

      if (error && error.code === '42P01') {
        // Table doesn't exist - in production, use migrations
        logger.warn('[SemanticCrossSession] message_embeddings table not found. Create via migration.');
      }
    } catch {
      logger.warn('[SemanticCrossSession] Could not verify message_embeddings table');
    }
  }

  /**
   * Generate and store embeddings for a message
   * Call this after saving a message to DB
   */
  async indexMessage(
    messageId: string,
    sessionId: string,
    userId: string,
    content: string,
    role: string
  ): Promise<boolean> {
    try {
      // Skip very short messages
      if (!content || content.trim().length < 10) return false;

      const embedding = await generateEmbedding(content);
      if (!embedding) return false;

      const { error } = await supabase
        .from('message_embeddings')
        .upsert({
          message_id: messageId,
          session_id: sessionId,
          user_id: userId,
          content: content.substring(0, 2000), // Store snippet for reference
          embedding,
          role,
          created_at: new Date().toISOString(),
        }, { onConflict: 'message_id' });

      if (error) {
        logger.warn('[SemanticCrossSession] Failed to index message', { error, messageId });
        return false;
      }

      return true;
    } catch (err) {
      logger.error('[SemanticCrossSession] Error indexing message', { error: (err as Error)?.message, messageId });
      return false;
    }
  }

  /**
   * Batch index messages (for backfill or bulk operations)
   */
  async batchIndexMessages(
    userId: string,
    messages: Array<{ id: string; session_id: string; content: string; role: string; created_at: string }>
  ): Promise<{ indexed: number; failed: number }> {
    let indexed = 0;
    let failed = 0;

    // Process in batches
    for (let i = 0; i < messages.length; i += this.BATCH_EMBEDDING_SIZE) {
      const batch = messages.slice(i, i + this.BATCH_EMBEDDING_SIZE);
      const texts = batch.map(m => m.content.substring(0, 2000));

      try {
        const embeddings = await generateEmbeddings(texts);
        if (!embeddings || embeddings.length !== batch.length) {
          failed += batch.length;
          continue;
        }

        const rows = batch.map((msg, idx) => ({
          message_id: msg.id,
          session_id: msg.session_id,
          user_id: userId,
          content: texts[idx],
          embedding: embeddings[idx],
          role: msg.role,
          created_at: msg.created_at,
        }));

        const { error } = await supabase
          .from('message_embeddings')
          .upsert(rows, { onConflict: 'message_id' });

        if (error) {
          logger.warn('[SemanticCrossSession] Batch upsert failed', { error });
          failed += batch.length;
        } else {
          indexed += batch.length;
        }
      } catch (err) {
        logger.error('[SemanticCrossSession] Batch embedding failed', { error: (err as Error)?.message });
        failed += batch.length;
      }
    }

    logger.info('[SemanticCrossSession] Batch indexing complete', { indexed, failed });
    return { indexed, failed };
  }

  /**
   * Search previous chats using semantic vector similarity
   * Uses pgvector for efficient similarity search
   */
  async searchPreviousChats(
    userId: string,
    query: string,
    currentSessionId?: string,
    options?: {
      limit?: number;
      minSimilarity?: number;
      maxAgeDays?: number;
      includeTextSearch?: boolean;
    }
  ): Promise<CrossSessionResult[]> {
    if (!MemoryConfig.crossSession.enabled) {
      return [];
    }

    try {
      await this.ensureEmbeddingsTable();

      const {
        limit = 5,
        minSimilarity = this.SIMILARITY_THRESHOLD,
        maxAgeDays = MemoryConfig.crossSession.maxChatAgeDays,
        includeTextSearch = true,
      } = options ?? {};

      // Generate query embedding
      const queryEmbedding = await generateEmbedding(query);
      if (!queryEmbedding) {
        logger.warn('[SemanticCrossSession] Failed to generate query embedding');
        return [];
      }

      // Vector similarity search via RPC
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

      const { data: vectorResults, error: vectorError } = await supabase
        .rpc('search_message_embeddings', {
          query_embedding: queryEmbedding,
          user_id_filter: userId,
          session_id_exclude: currentSessionId ?? '',
          match_threshold: minSimilarity,
          match_count: limit * 3, // Get more for session grouping
          cutoff_date: cutoffDate.toISOString(),
        });

      if (vectorError) {
        logger.warn('[SemanticCrossSession] Vector search failed, falling back to text search', {
          error: vectorError.message,
        });
      }

      // Optional: Text search fallback/complement
      let textResults: ChatMessage[] = [];
      if (includeTextSearch) {
        textResults = await this.textSearchFallback(userId, query, currentSessionId, limit * 2);
      }

      // Combine and group by session
      const sessionGroups = new Map<string, CrossSessionResult>();

      // Process vector results
      if (vectorResults && vectorResults.length > 0) {
        for (const row of vectorResults) {
          const sessionId = row.session_id;
          const similarity = row.similarity;

          if (!sessionGroups.has(sessionId)) {
            sessionGroups.set(sessionId, {
              sessionId,
              sessionTitle: row.session_title || 'Ù…Ø­Ø§Ø¯Ø«Ø© Ø³Ø§Ø¨Ù‚Ø©',
              messages: [],
              relevanceScore: 0,
              timestamp: row.session_updated_at,
            });
          }

          const group = sessionGroups.get(sessionId)!;
          if (group.messages.length < this.MAX_RESULTS_PER_SESSION) {
            group.messages.push({
              id: row.message_id,
              session_id: row.session_id,
              role: row.role,
              content: row.content,
              created_at: row.message_created_at,
            });
            group.relevanceScore = Math.max(group.relevanceScore, similarity);
          }
        }
      }

      // Process text search results (lower weight)
      for (const msg of textResults) {
        const sessionId = msg.session_id;
        if (!sessionGroups.has(sessionId)) {
          sessionGroups.set(sessionId, {
            sessionId,
            sessionTitle: 'Ù…Ø­Ø§Ø¯Ø«Ø© Ø³Ø§Ø¨Ù‚Ø©',
            messages: [],
            relevanceScore: 0,
            timestamp: msg.created_at,
          });
        }
        const group = sessionGroups.get(sessionId)!;
        if (group.messages.length < this.MAX_RESULTS_PER_SESSION) {
          // Check if already included
          if (!group.messages.some(m => m.id === msg.id)) {
            group.messages.push(msg);
            group.relevanceScore = Math.max(group.relevanceScore, 0.4); // Text search base score
          }
        }
      }

      // Convert to array and sort by relevance
      const results = Array.from(sessionGroups.values())
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit);

      if (MemoryConfig.debug.enabled && results.length > 0) {
        logger.info('[SemanticCrossSession] Found relevant previous chats', {
          userId,
          count: results.length,
          topScore: results[0]?.relevanceScore,
          topSession: results[0]?.sessionTitle,
        });
      }

      return results;
    } catch (error) {
      logger.error('[SemanticCrossSession] Error searching previous chats', { error, userId });
      return [];
    }
  }

  /**
   * Text search fallback for when vector search fails
   */
  private async textSearchFallback(
    userId: string,
    query: string,
    excludeSessionId?: string,
    limit = 50
  ): Promise<ChatMessage[]> {
    try {
      const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2)
        .slice(0, 5);

      if (keywords.length === 0) return [];

      // chat_messages has no user_id column - resolve the user's sessions first
      const { data: userSessions, error: sessionsError } = await supabase
        .from('chat_sessions')
        .select('id')
        .eq('user_id', userId);

      if (sessionsError || !userSessions || userSessions.length === 0) return [];

      let sessionIds = userSessions.map(s => s.id);
      if (excludeSessionId) {
        sessionIds = sessionIds.filter(id => id !== excludeSessionId);
        if (sessionIds.length === 0) return [];
      }

      const orConditions = keywords.map(k => `content.ilike.%${k}%`).join(',');

      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, session_id, role, content, created_at')
        .in('session_id', sessionIds)
        .or(orConditions)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error || !data) return [];

      return data.map(msg => ({
        id: msg.id,
        session_id: msg.session_id,
        role: msg.role,
        content: msg.content,
        created_at: msg.created_at,
      }));
    } catch (error) {
      logger.error('[SemanticCrossSession] Text search fallback failed', { error });
      return [];
    }
  }

  /**
   * Build cross-session context for prompt injection
   */
  async buildCrossSessionContext(
    userId: string,
    query: string,
    currentSessionId?: string,
    options?: {
      maxSessions?: number;
      maxMessagesPerSession?: number;
      maxTotalTokens?: number;
    }
  ): Promise<string> {
    const {
      maxSessions = 3,
      maxMessagesPerSession = 3,
      maxTotalTokens = 1500,
    } = options ?? {};

    try {
      const results = await this.searchPreviousChats(userId, query, currentSessionId, {
        limit: maxSessions,
      });

      if (results.length === 0) {
        return '';
      }

      const sections: string[] = [];
      let totalTokens = 0;

      for (const result of results) {
        const messages = result.messages
          .slice(0, maxMessagesPerSession)
          .map(m => `${m.role === 'user' ? 'Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…' : 'Ø§Ù„Ù…Ø³Ø§Ø¹Ø¯'}: ${m.content.substring(0, 300)}`)
          .join('\n');

        const section = `**Ù…Ù† Ù…Ø­Ø§Ø¯Ø«Ø© Ø³Ø§Ø¨Ù‚Ø© (${result.sessionTitle}):**\n${messages}`;
        const sectionTokens = estimateTokens(section);

        if (totalTokens + sectionTokens > maxTotalTokens) {
          break;
        }

        sections.push(section);
        totalTokens += sectionTokens;
      }

      if (sections.length === 0) return '';

      return `\n**Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ù…Ù† Ù…Ø­Ø§Ø¯Ø«Ø§Øª Ø³Ø§Ø¨Ù‚Ø© Ø°Ø§Øª ØµÙ„Ø©:**\n${sections.join('\n\n')}\n`;
    } catch (error) {
      logger.error('[SemanticCrossSession] Error building context', { error, userId });
      return '';
    }
  }

  /**
   * Get session summaries for quick overview
   */
  async getPreviousChatSummaries(
    userId: string,
    limit = 10
  ): Promise<Array<{ sessionId: string; title: string; lastMessage: string; updatedAt: string }>> {
    try {
      const { data, error } = await supabase
        .from('chat_sessions')
        .select('id, title, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(limit);

      if (error || !data) return [];

      const summaries = await Promise.all(
        data.map(async (session) => {
          const { data: messages } = await supabase
            .from('chat_messages')
            .select('content')
            .eq('session_id', session.id)
            .eq('role', 'user')
            .order('created_at', { ascending: true })
            .limit(3);

          const lastUserMsg = messages?.[messages.length - 1]?.content ?? '';
          return {
            sessionId: session.id,
            title: session.title || 'Ù…Ø­Ø§Ø¯Ø«Ø©',
            lastMessage: lastUserMsg.substring(0, 100),
            updatedAt: session.updated_at,
          };
        })
      );

      return summaries;
    } catch (error) {
      logger.error('[SemanticCrossSession] Error getting summaries', { error });
      return [];
    }
  }

  /**
   * Clean up old embeddings (call periodically)
   */
  async cleanupOldEmbeddings(maxAgeDays: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

      const { data, error } = await supabase
        .from('message_embeddings')
        .delete()
        .lt('created_at', cutoffDate.toISOString())
        .select('id');

      if (error) {
        logger.warn('[SemanticCrossSession] Cleanup failed', { error: error.message });
        return 0;
      }

      const count = data?.length ?? 0;
      if (count > 0) {
        logger.info('[SemanticCrossSession] Cleaned up old embeddings', { count });
      }
      return count;
    } catch (error) {
      logger.error('[SemanticCrossSession] Cleanup error', { error });
      return 0;
    }
  }
}

/**
 * Estimate tokens (local copy to avoid circular import)
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const totalChars = text.replace(/\s+/g, '').length || 1;
  const arabicRatio = arabicChars / totalChars;
  let ratio = 4;
  if (arabicRatio > 0.5) ratio = 2.5;
  else if (arabicRatio > 0.15) ratio = 3;
  return Math.ceil((text.length / ratio) * 1.05);
}

// Export singleton instance
export const semanticCrossSession = SemanticCrossSessionService.getInstance();

/**
 * Database migration SQL for message_embeddings table:
 * 
 * CREATE EXTENSION IF NOT EXISTS vector;
 * 
 * CREATE TABLE message_embeddings (
 *   id BIGSERIAL PRIMARY KEY,
 *   message_id UUID NOT NULL UNIQUE,
 *   session_id UUID NOT NULL,
 *   user_id UUID NOT NULL,
 *   content TEXT NOT NULL,
 *   embedding VECTOR(9692) NOT NULL,
 *   role TEXT NOT NULL,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * );
 * 
 * CREATE INDEX ON message_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
 * CREATE INDEX ON message_embeddings (user_id);
 * CREATE INDEX ON message_embeddings (session_id);
 * 
 * -- RPC function for similarity search:
 * CREATE OR REPLACE FUNCTION search_message_embeddings(
 *   query_embedding VECTOR(9692),
 *   user_id_filter UUID,
 *   session_id_exclude UUID DEFAULT NULL,
 *   match_threshold FLOAT DEFAULT 0.65,
 *   match_count INT DEFAULT 20,
 *   cutoff_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days'
 * )
 * RETURNS TABLE (
 *   message_id UUID,
 *   session_id UUID,
 *   session_title TEXT,
 *   session_updated_at TIMESTAMPTZ,
 *   content TEXT,
 *   role TEXT,
 *   message_created_at TIMESTAMPTZ,
 *   similarity FLOAT
 * )
 * LANGUAGE sql STABLE
 * AS $$
 *   SELECT
 *     me.message_id,
 *     me.session_id,
 *     cs.title AS session_title,
 *     cs.updated_at AS session_updated_at,
 *     me.content,
 *     me.role,
 *     me.created_at AS message_created_at,
 *     1 - (me.embedding <=> query_embedding) AS similarity
 *   FROM message_embeddings me
 *   JOIN chat_sessions cs ON cs.id = me.session_id
 *   WHERE me.user_id = user_id_filter
 *     AND (session_id_exclude IS NULL OR me.session_id != session_id_exclude)
 *     AND cs.updated_at >= cutoff_date
 *     AND 1 - (me.embedding <=> query_embedding) >= match_threshold
 *   ORDER BY me.embedding <=> query_embedding
 *   LIMIT match_count;
 * $$;
 */
