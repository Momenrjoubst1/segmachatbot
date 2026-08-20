import { createLogger } from '../utils/logger.js';
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { ChatTitleConfig, isChatTitlingEnabled } from '../config/chat-title.config.js';
import redis from '../config/redis/client.js';

const logger = createLogger('chat-title-generator');
const FALLBACK_TITLE = 'محادثة جديدة';

function normalizeTitleValue(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

function isDefaultSessionTitle(title?: string | null): boolean {
  const normalized = normalizeTitleValue(title);
  if (!normalized) return true;

  return ChatTitleConfig.defaultTitles.some(defaultTitle =>
    normalizeTitleValue(defaultTitle) === normalized
  );
}

/**
 * نظام التسمية التلقائية للمحادثات (Chat Auto-Titling System)
 * 
 * يعمل هذا النظام في الخلفية (Background) لتوليد عناوين ذكية للمحادثات
 * بناءً على أول 3 رسائل في المحادثة دون التأثير على سرعة الشات الرئيسي.
 */

/**
 * إنشاء عميل AI بناءً على النموذج المتاح
 */
function createAIClient() {
  // الأولوية 1: BigModel (ZhipuAI) - GLM-5.2
  if (process.env.BIGMODEL_API_KEY) {
    return {
      client: createOpenAI({
        baseURL: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: process.env.BIGMODEL_API_KEY,
      }),
      model: "glm-5.2"
    };
  }

  // الأولوية 2: Azure OpenAI (إذا كان متاحاً)
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, '');
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4o-mini';
    
    return {
      client: createOpenAI({
        baseURL: endpoint,
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        headers: {
          "api-key": process.env.AZURE_OPENAI_API_KEY,
        },
      }),
      model: deploymentName
    };
  }
  
  // الأولوية 3: Gemini Flash (سريع واقتصادي)
  if (process.env.GOOGLE_API_KEY) {
    return {
      client: createOpenAI({
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
        apiKey: process.env.GOOGLE_API_KEY,
      }),
      model: "gemini-1.5-flash"
    };
  }
  
  // الأولوية 4: GPT-4o-mini من GitHub
  if (process.env.GITHUB_TOKEN) {
    return {
      client: createOpenAI({
        baseURL: "https://models.github.ai/inference",
        apiKey: process.env.GITHUB_TOKEN,
      }),
      model: "gpt-4o-mini"
    };
  }
  
  // الأولوية 5: Groq (سريع جداً)
  if (process.env.GROQ_API_KEY) {
    return {
      client: createOpenAI({
        baseURL: "https://api.groq.com/openai/v1",
        apiKey: process.env.GROQ_API_KEY,
      }),
      model: "qwen/qwen3.6-27b"
    };
  }
  
  throw new Error("No AI API key available for chat title generation");
}

/**
 * توليد عنوان للمحادثة بناءً على أول 3 رسائل
 */
async function generateChatTitle(messages: Array<{ role: string; content: string }>): Promise<string> {
  try {
    // التحقق من تفعيل النظام
    if (!isChatTitlingEnabled()) {
      logger.warn('Chat titling is disabled');
      return FALLBACK_TITLE;
    }

    // التأكد من وجود العدد المطلوب من الرسائل
    if (!messages || messages.length < ChatTitleConfig.minMessagesCount) {
      logger.warn(`Not enough messages to generate title (${messages?.length || 0}/${ChatTitleConfig.minMessagesCount})`);
      return FALLBACK_TITLE;
    }

    // أخذ أول N رسائل فقط
    const firstMessages = messages.slice(0, ChatTitleConfig.minMessagesCount);
    
    // تحويل الرسائل إلى نص واحد
    const conversationText = firstMessages
      .map(msg => `${msg.role === 'user' ? 'المستخدم' : 'البوت'}: ${msg.content}`)
      .join('\n\n');

    if (ChatTitleConfig.verboseLogging) {
      logger.info('Generating title for conversation with messages:', firstMessages.length);
    }

    const { client, model } = createAIClient();

    // استدعاء النموذج لتوليد العنوان مع Timeout
    const result = await Promise.race([
      generateText({
        model: client.chat(model),
        system: ChatTitleConfig.systemPrompt,
        prompt: conversationText,
        maxOutputTokens: ChatTitleConfig.maxTokens,
        temperature: ChatTitleConfig.temperature,
      }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Title generation timeout')), ChatTitleConfig.timeout)
      )
    ]);

    const generatedTitle = result.text.trim();
    
    // التحقق من صحة العنوان
    if (!generatedTitle || generatedTitle.length < 2) {
      logger.warn('Generated title is too short, using fallback');
      return FALLBACK_TITLE;
    }

    // إزالة أي علامات ترقيم أو رموز غير مرغوبة
    const words = generatedTitle
      .replace(/[.!?،؛:؛"“”'’`~!@#$%^&*()_+=\-[\]{}\\|;:<>,/?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);

    if (words.length < 2) {
      logger.warn('Generated title has less than 2 words, using fallback');
      return FALLBACK_TITLE;
    }

    const cleanTitle = words
      .slice(0, 4)
      .join(' ')
      .substring(0, ChatTitleConfig.maxTitleLength)
      .trim();

    if (!cleanTitle) {
      logger.warn('Generated title became empty after cleanup, using fallback');
      return FALLBACK_TITLE;
    }

    logger.info('Successfully generated title:', cleanTitle);
    return cleanTitle;

  } catch (error) {
    logger.error('Error generating chat title:', error instanceof Error ? error : new Error(String(error)));
    // في حالة الفشل، نعيد عنوان افتراضي
    return FALLBACK_TITLE;
  }
}

/**
 * تحديث عنوان المحادثة في قاعدة البيانات
 */
async function updateChatTitle(sessionId: string, title: string): Promise<boolean> {
  try {
    const { supabase } = await import('../services/rag/rag-supabase-client.js');
    
    let { error } = await supabase
      .from('chat_sessions')
      .update({ title, title_generated: true })
      .eq('id', sessionId);

    if (error && String(error.message || '').includes('title_generated')) {
      const fallbackResult = await supabase
        .from('chat_sessions')
        .update({ title })
        .eq('id', sessionId);
      error = fallbackResult.error;
    }

    if (error) {
      logger.error('Error updating chat title in database:', error);
      return false;
    }

    logger.info(`Successfully updated title for session ${sessionId}`);
    return true;

  } catch (error) {
    logger.error('Error in updateChatTitle:', error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

/**
 * معالج رئيسي: فحص المحادثة وتوليد العنوان إذا لزم الأمر
 * يعمل بشكل غير متزامن في الخلفية
 */
async function processChatTitling(sessionId: string): Promise<void> {
  try {
    // التحقق من تفعيل النظام
    if (!isChatTitlingEnabled()) {
      if (ChatTitleConfig.verboseLogging) {
        logger.info('Chat titling is disabled, skipping');
      }
      return;
    }

    const { supabase } = await import('../services/rag/rag-supabase-client.js');

    // 1. فحص عنوان المحادثة الحالي
    const sessionResult = await supabase
      .from('chat_sessions')
      .select('id, title, title_generated')
      .eq('id', sessionId)
      .single();

    let session = sessionResult.data as { id: string; title: string | null; title_generated?: boolean } | null;
    let sessionError = sessionResult.error;

    if (sessionError && String(sessionError.message || '').includes('title_generated')) {
      const fallbackSessionResult = await supabase
        .from('chat_sessions')
        .select('id, title')
        .eq('id', sessionId)
        .single();
      session = fallbackSessionResult.data as { id: string; title: string | null; title_generated?: boolean } | null;
      sessionError = fallbackSessionResult.error;
    }

    if (sessionError || !session) {
      logger.warn('Session not found:', sessionId);
      return;
    }

    if (session.title_generated === true) {
      if (ChatTitleConfig.verboseLogging) {
        logger.info('Session title already generated, skipping:', sessionId);
      }
      return;
    }

    // 2. التحقق من أن العنوان لا يزال افتراضياً
    const isDefaultTitle = isDefaultSessionTitle(session.title);

    if (!isDefaultTitle) {
      if (ChatTitleConfig.verboseLogging) {
        logger.info('Session already has a custom title, skipping:', session.title);
      }
      return;
    }

    // 3. عد الرسائل في المحادثة
    const { count: messageCount, error: countError } = await supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .in('role', ['user', 'assistant']);

    if (countError) {
      logger.error('Error counting messages:', countError);
      return;
    }

    // 4. Titling window — triggers when message count is between minMessagesCount and minMessagesCount+6
    //    (e.g. 2–8 messages). Wide window catches quick Q&A (2 messages) and prevents
    //    missing the trigger when multiple messages are saved in rapid succession.
    const minCount = ChatTitleConfig.minMessagesCount;
    const maxCount = ChatTitleConfig.minMessagesCount + 6;
    if (messageCount === null || messageCount === undefined || messageCount < minCount || messageCount > maxCount) {
      if (ChatTitleConfig.verboseLogging) {
        logger.info(`Session ${sessionId} count is ${messageCount ?? 0}, waiting for trigger window [${minCount}–${maxCount}]`);
      }
      return;
    }

    // 5. جلب أول 3 رسائل فقط
    const { data: messages, error: messagesError } = await supabase
      .from('chat_messages')
      .select('role, content, created_at')
      .eq('session_id', sessionId)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: true })
      .limit(ChatTitleConfig.minMessagesCount);

    if (messagesError || !messages || messages.length < ChatTitleConfig.minMessagesCount) {
      logger.error('Error fetching first messages for title generation:', messagesError);
      return;
    }

    // 6. توليد العنوان
    logger.info(`Generating title for session ${sessionId} with ${messages.length} messages`);
    let newTitle = await generateChatTitle(messages);

    // 7. Smart fallback: if AI failed or returned a default title,
    //    use the first 50 chars of the first user message as the title.
    if (isDefaultSessionTitle(newTitle)) {
      const firstUserMsg = messages.find((m) => m.role === 'user');
      if (firstUserMsg?.content) {
        const raw = firstUserMsg.content.replace(/\n/g, ' ').trim();
        newTitle = raw.length > 50 ? raw.substring(0, 50) + '…' : raw;
        logger.info(`AI title generation skipped, using fallback from first user message: "${newTitle}"`);
      } else {
        logger.warn('Generated title is still default and no user message available, skipping');
        return;
      }
    }

    // 8. تحديث قاعدة البيانات
    await updateChatTitle(sessionId, newTitle);

  } catch (error) {
    // نسجل الخطأ فقط دون التأثير على الشات الرئيسي
    logger.error('Error in processChatTitling:', error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * معالج غير متزامن يعمل في الخلفية
 * يتم استدعاؤه بعد حفظ الرسالة دون انتظار النتيجة
 */
export function triggerChatTitlingAsync(sessionId: string): void {
  const lockKey = `titling:lock:${sessionId}`;

  // Use Redis distributed lock (SET NX EX 30) to prevent duplicate work across workers
  redis.set(lockKey, '1', 'EX', 30, 'NX').then((result: string | null) => {
    if (!result) {
      // Lock already held — another worker is handling this session
      return;
    }

    setImmediate(() => {
      processChatTitling(sessionId).catch(error => {
        logger.error('Background chat titling failed:', error);
      }).finally(() => {
        redis.del(lockKey).catch((err: unknown) => {
          logger.warn('Failed to release titling lock', { error: (err as Error)?.message, lockKey });
        });
      });
    });
  }).catch((err: Error) => {
    logger.warn('Redis lock error for titling, proceeding without lock', { error: err.message });
    // Fallback: run anyway if Redis is down
    setImmediate(() => {
      processChatTitling(sessionId).catch(error => {
        logger.error('Background chat titling failed:', error);
      });
    });
  });
}
