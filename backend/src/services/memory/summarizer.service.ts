/**
 * Smart Summarization Service
 * نظام تلخيص ذكي للمحادثات - يعمل مع أي نموذج AI
 * بدلاً من حذف الرسائل القديمة، يلخصها بذكاء
 */

import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import crypto from 'crypto';
import { MemoryConfig } from '../../config/memory.config.js';
import { logger } from '../../utils/logger.js';
import { contextCache } from './context-cache.service.js';
import { estimateTokens } from './token-estimator.js';

interface Message {
  role: string;
  content: string;
  timestamp?: number;
}

interface SummaryResult {
  summary: string;
  originalMessageCount: number;
  tokensEstimate: number;
  cached: boolean;
  cacheHash?: string;
}

interface SlidingWindowResult {
  summary: string;
  tokensEstimate: number;
  windowsProcessed: number;
}

export class SummarizerService {
  private static instance: SummarizerService;

  private constructor() {}

  static getInstance(): SummarizerService {
    if (!SummarizerService.instance) {
      SummarizerService.instance = new SummarizerService();
    }
    return SummarizerService.instance;
  }

  /**
   * تلخيص مجموعة من الرسائل
   */
  async summarizeMessages(
    messages: Message[],
    userId?: string,
    options?: {
      language?: 'ar' | 'en';
      style?: 'brief' | 'detailed';
      includeContext?: boolean;
    }
  ): Promise<SummaryResult> {
    if (!MemoryConfig.summarization.enabled) {
      return {
        summary: '[التلخيص معطل]',
        originalMessageCount: messages.length,
        tokensEstimate: 0,
        cached: false,
      };
    }

    // تصفية الرسائل القصيرة جداً
    const validMessages = messages.filter(
      m => m.content && m.content.length >= MemoryConfig.summarization.minMessageLength
    );

    if (validMessages.length === 0) {
      return {
        summary: '[لا توجد رسائل للتلخيص]',
        originalMessageCount: 0,
        tokensEstimate: 0,
        cached: false,
      };
    }

    try {
      // تحقق من الـ cache أولاً
      const cacheKey = this.generateCacheKey(validMessages);
      if (userId) {
        const cached = await contextCache.get(userId, cacheKey);
        if (cached.found && cached.content) {
          if (MemoryConfig.debug.enabled) {
            logger.info('[Summarizer] Using cached summary', { userId, messageCount: validMessages.length });
          }
          return {
            summary: cached.content,
            originalMessageCount: validMessages.length,
            tokensEstimate: estimateTokens(cached.content),
            cached: true,
            cacheHash: cacheKey,
          };
        }
      }

      // توليد الملخص
      const summary = await this.generateSummary(validMessages, options);

      // حفظ في الـ cache
      if (userId && summary) {
        await contextCache.set(userId, summary, {
          type: 'summary',
          messageCount: validMessages.length,
          timestamp: Date.now(),
        });
      }

      return {
        summary,
        originalMessageCount: validMessages.length,
        tokensEstimate: estimateTokens(summary),
        cached: false,
        cacheHash: cacheKey,
      };
    } catch (error) {
      logger.error('[Summarizer] Error summarizing messages', { error, messageCount: messages.length });
      
      // Fallback: ملخص بسيط
      return {
        summary: this.createFallbackSummary(validMessages),
        originalMessageCount: validMessages.length,
        tokensEstimate: 100,
        cached: false,
      };
    }
  }

  /**
   * توليد الملخص باستخدام AI
   */
  private async generateSummary(
    messages: Message[],
    options?: {
      language?: 'ar' | 'en';
      style?: 'brief' | 'detailed';
      includeContext?: boolean;
    }
  ): Promise<string> {
    const language = options?.language || 'ar';
    const style = options?.style || 'brief';
    const includeContext = options?.includeContext ?? true;

    // تحضير المحادثة
    const conversationText = messages
      .map(m => `${m.role === 'user' ? 'المستخدم' : 'المساعد'}: ${m.content}`)
      .join('\n\n');

    // بناء الـ prompt
    const prompt = this.buildSummaryPrompt(conversationText, language, style, includeContext);

    // اختيار النموذج (رخيص وسريع)
    const model = this.getModel();

    // توليد الملخص
    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: MemoryConfig.summarization.maxSummaryTokens,
      temperature: 0.3, // منخفضة للدقة
    });

    return text.trim();
  }

  /**
   * بناء prompt التلخيص
   */
  private buildSummaryPrompt(
    conversationText: string,
    language: 'ar' | 'en',
    style: 'brief' | 'detailed',
    includeContext: boolean
  ): string {
    if (language === 'ar') {
      return `أنت خبير في تلخيص المحادثات. لخص المحادثة التالية بشكل ${style === 'brief' ? 'مختصر ومركز' : 'مفصل وشامل'}.

**تعليمات التلخيص:**
1. اذكر المواضيع الرئيسية التي تم مناقشتها
2. اذكر القرارات أو الاستنتاجات المهمة
3. اذكر أي معلومات أو حقائق مهمة تم ذكرها
4. ${includeContext ? 'احتفظ بالسياق والتفاصيل المهمة' : 'ركز على النقاط الأساسية فقط'}
5. استخدم نقاط bullet points للوضوح
6. لا تذكر تفاصيل غير مهمة أو محادثات جانبية

**المحادثة:**
${conversationText}

**الملخص:**`;
    } else {
      return `You are an expert at summarizing conversations. Summarize the following conversation in a ${style === 'brief' ? 'brief and focused' : 'detailed and comprehensive'} manner.

**Summarization Instructions:**
1. Mention the main topics discussed
2. Mention important decisions or conclusions
3. Mention any important information or facts
4. ${includeContext ? 'Keep context and important details' : 'Focus on key points only'}
5. Use bullet points for clarity
6. Don't mention unimportant details or side conversations

**Conversation:**
${conversationText}

**Summary:**`;
    }
  }

  /**
   * إنشاء ملخص بسيط (fallback)
   */
  private createFallbackSummary(messages: Message[]): string {
    const userMessages = messages.filter(m => m.role === 'user');
    const topics = userMessages
      .map(m => m.content.substring(0, 50))
      .slice(0, 3)
      .join('، ');

    return `[ملخص تلقائي] تمت مناقشة: ${topics}... (${messages.length} رسالة)`;
  }

  /**
   * توليد مفتاح cache للرسائل
   */
  private generateCacheKey(messages: Message[]): string {
    const content = messages.map(m => `${m.role}:${m.content}`).join('|');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * الحصول على النموذج المناسب للتلخيص
   */
  private getModel() {
    const modelId = MemoryConfig.summarization.model;
    const azureKey = process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    const azureEndpoint = process.env.AZURE_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;

    // تحديد المزود بناءً على النموذج
    if (modelId.includes('gpt')) {
      // استخدام Azure أو OpenRouter
      if (azureKey) {
        const cleanEndpoint = azureEndpoint ? azureEndpoint.replace(/\/$/, '') : undefined;
        return createOpenAI({
          baseURL: cleanEndpoint || "https://msalrjoub25-2561-resource.openai.azure.com/openai/v1",
          apiKey: azureKey,
          headers: {
            "api-key": azureKey,
          },
        }).chat(modelId);
      } else if (process.env.OPENROUTER_API_KEY) {
        return createOpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey: process.env.OPENROUTER_API_KEY,
        }).chat(`openai/${modelId}`);
      }
    } else if (modelId.includes('llama') || modelId.includes('mixtral')) {
      // استخدام Groq
      if (process.env.GROQ_API_KEY) {
        return createOpenAI({
          baseURL: 'https://api.groq.com/openai/v1',
          apiKey: process.env.GROQ_API_KEY,
        }).chat(modelId);
      }
    }

    // Fallback: استخدام أي مزود متاح
    if (process.env.GROQ_API_KEY) {
      return createOpenAI({
        baseURL: "https://api.groq.com/openai/v1",
        apiKey: process.env.GROQ_API_KEY,
      }).chat('qwen/qwen3.6-27b');
    }

    throw new Error('No AI provider configured for summarization');
  }

  /**
   * Sliding window summarization - processes messages in overlapping windows
   * instead of one massive chunk. Produces more coherent summaries.
   *
   * نافذة منزلقة: معالجة الرسائل في نوافذ متداخلة بدلاً من كتلة واحدة ضخمة
   */
  async summarizeWithSlidingWindow(
    messages: Message[],
    userId: string,
    options: { language: string; windowSize?: number; overlap?: number }
  ): Promise<SlidingWindowResult> {
    const windowSize = options.windowSize ?? 10;
    const overlap = options.overlap ?? 2;
    const language = options.language === 'ar' ? 'ar' as const : 'en' as const;

    if (messages.length === 0) {
      return { summary: '', tokensEstimate: 0, windowsProcessed: 0 };
    }

    // If messages fit in a single window, summarize directly
    if (messages.length <= windowSize) {
      const result = await this.summarizeMessages(messages, userId, {
        language,
        style: 'brief',
      });
      return {
        summary: result.summary,
        tokensEstimate: result.tokensEstimate,
        windowsProcessed: 1,
      };
    }

    try {
      const miniSummaries: string[] = [];
      let windowsProcessed = 0;

      // Process windows with overlap
      for (let start = 0; start < messages.length; start += (windowSize - overlap)) {
        const end = Math.min(start + windowSize, messages.length);
        const windowMessages = messages.slice(start, end);

        // Skip if window is too small (can happen with overlap)
        if (windowMessages.length < 2 && start > 0) break;

        const windowLabel =
          language === 'ar'
            ? `[الجزء ${start + 1}-${end} من المحادثة]`
            : `[Part ${start + 1}-${end} of conversation]`;

        const result = await this.summarizeMessages(windowMessages, userId, {
          language,
          style: 'brief',
        });

        miniSummaries.push(`${windowLabel}\n${result.summary}`);
        windowsProcessed++;

        // If we've reached the end, stop
        if (end >= messages.length) break;
      }

      // Combine mini-summaries with temporal markers
      const combinedSummary = miniSummaries.join('\n\n');

      // If there are many mini-summaries, do a final consolidation pass
      let finalSummary: string;
      if (miniSummaries.length > 3) {
        const consolidationPrompt =
          language === 'ar'
            ? `أنت خبير في دمج الملخصات. ادمج الملخصات الجزئية التالية في ملخص واحد متماسك مع الحفاظ على الترتيب الزمني:\n\n${combinedSummary}\n\n**الملخص الموحد:**`
            : `You are an expert at combining summaries. Merge the following partial summaries into one cohesive summary while preserving temporal order:\n\n${combinedSummary}\n\n**Combined Summary:**`;

        const model = this.getModel();
        const { text } = await generateText({
          model,
          prompt: consolidationPrompt,
          maxOutputTokens: MemoryConfig.summarization.maxSummaryTokens,
          temperature: 0.3,
        });
        finalSummary = text.trim();
      } else {
        finalSummary = combinedSummary;
      }

      const tokensEstimate = estimateTokens(finalSummary);

      if (MemoryConfig.debug.enabled) {
        logger.info('[Summarizer] Sliding window completed', {
          userId,
          totalMessages: messages.length,
          windowsProcessed,
          tokensEstimate,
          windowSize,
          overlap,
        });
      }

      return {
        summary: finalSummary,
        tokensEstimate,
        windowsProcessed,
      };
    } catch (error) {
      logger.error('[Summarizer] Error in sliding window summarization', {
        error,
        messageCount: messages.length,
      });

      // Fallback to simple summarization
      const result = await this.summarizeMessages(messages, userId, { language });
      return {
        summary: result.summary,
        tokensEstimate: result.tokensEstimate,
        windowsProcessed: 1,
      };
    }
  }

  /**
   * تلخيص تدريجي (للمحادثات الطويلة جداً)
   */
  async summarizeInChunks(
    messages: Message[],
    userId?: string,
    chunkSize = 10
  ): Promise<SummaryResult> {
    if (messages.length <= chunkSize) {
      return this.summarizeMessages(messages, userId);
    }

    try {
      const summaries: string[] = [];
      
      // تقسيم إلى chunks
      for (let i = 0; i < messages.length; i += chunkSize) {
        const chunk = messages.slice(i, i + chunkSize);
        const result = await this.summarizeMessages(chunk, userId, { style: 'brief' });
        summaries.push(result.summary);
      }

      // تلخيص الملخصات
      const finalSummary = summaries.join('\n\n');
      
      if (summaries.length > 3) {
        // إذا كان هناك الكثير من الملخصات، لخصها مرة أخرى
        const metaSummary = await this.generateSummary(
          [{ role: 'assistant', content: finalSummary }],
          { style: 'detailed', includeContext: true }
        );
        
        return {
          summary: metaSummary,
          originalMessageCount: messages.length,
          tokensEstimate: estimateTokens(metaSummary),
          cached: false,
        };
      }

      return {
        summary: finalSummary,
        originalMessageCount: messages.length,
        tokensEstimate: estimateTokens(finalSummary),
        cached: false,
      };
    } catch (error) {
      logger.error('[Summarizer] Error in chunk summarization', { error, messageCount: messages.length });
      return this.summarizeMessages(messages, userId);
    }
  }

  /**
   * استخراج النقاط الرئيسية من المحادثة
   */
  async extractKeyPoints(messages: Message[], userId?: string): Promise<string[]> {
    try {
      const summary = await this.summarizeMessages(messages, userId, {
        style: 'detailed',
        includeContext: true,
      });

      // استخراج النقاط (bullet points)
      const points = summary.summary
        .split('\n')
        .filter(line => line.trim().startsWith('-') || line.trim().startsWith('•') || line.trim().startsWith('*'))
        .map(line => line.replace(/^[-•*]\s*/, '').trim())
        .filter(point => point.length > 10);

      return points;
    } catch (error) {
      logger.error('[Summarizer] Error extracting key points', { error });
      return [];
    }
  }
}

// Export singleton instance
export const summarizer = SummarizerService.getInstance();
