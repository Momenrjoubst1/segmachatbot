import { createLogger } from '../utils/logger.js';

const log = createLogger('chat-title-config');

/**
 * إعدادات نظام التسمية التلقائية للمحادثات
 * Chat Auto-Titling Configuration
 */

export const ChatTitleConfig = {
  /**
   * تفعيل/تعطيل النظام بالكامل
   * Enable/Disable the entire system
   */
  enabled: process.env.CHAT_AUTO_TITLING_ENABLED !== 'false',

  /**
   * عدد الرسائل المطلوبة لتفعيل التسمية
   * Number of messages required to trigger titling
   */
  minMessagesCount: parseInt(process.env.CHAT_TITLE_MIN_MESSAGES || '3'),

  /**
   * الحد الأقصى لطول العنوان (بالأحرف)
   * Maximum title length in characters
   */
  maxTitleLength: parseInt(process.env.CHAT_TITLE_MAX_LENGTH || '100'),

  /**
   * عدد الـ tokens المسموح بها للنموذج
   * Max tokens for AI model
   */
  maxTokens: parseInt(process.env.CHAT_TITLE_MAX_TOKENS || '20'),

  /**
   * درجة الحرارة للنموذج (0-1)
   * Temperature for AI model (0-1)
   */
  temperature: parseFloat(process.env.CHAT_TITLE_TEMPERATURE || '0.7'),

  /**
   * العناوين الافتراضية التي يجب استبدالها
   * Default titles that should be replaced
   */
  defaultTitles: [
    'New Chat',
    'محادثة جديدة',
    'new chat',
    'محادثه جديده',
    'NEW CHAT',
    'New chat session',
    'Chat',
    'شات',
  ],

  /**
   * أولوية النماذج المستخدمة
   * Priority order of AI models to use
   */
  modelPriority: [
    { provider: 'azure', model: 'gpt-4o-mini', envKey: 'AZURE_OPENAI_API_KEY' },
    { provider: 'google', model: 'gemini-1.5-flash', envKey: 'GOOGLE_API_KEY' },
    { provider: 'github', model: 'gpt-4o-mini', envKey: 'GITHUB_TOKEN' },
    { provider: 'groq', model: 'gemma2-9b-it', envKey: 'GROQ_API_KEY' },
  ],

  /**
   * Timeout للعملية (بالميلي ثانية)
   * Timeout for the operation in milliseconds
   */
  timeout: parseInt(process.env.CHAT_TITLE_TIMEOUT || '10000'),

  /**
   * عدد المحاولات في حالة الفشل
   * Number of retry attempts on failure
   */
  retryAttempts: parseInt(process.env.CHAT_TITLE_RETRY_ATTEMPTS || '2'),

  /**
   * تأخير بين المحاولات (بالميلي ثانية)
   * Delay between retry attempts in milliseconds
   */
  retryDelay: parseInt(process.env.CHAT_TITLE_RETRY_DELAY || '1000'),

  /**
   * تفعيل التسجيل المفصل
   * Enable verbose logging
   */
  verboseLogging: process.env.CHAT_TITLE_VERBOSE_LOGGING === 'true',

  /**
   * تفعيل التخزين المؤقت (Cache)
   * Enable caching of generated titles
   */
  enableCache: process.env.CHAT_TITLE_ENABLE_CACHE !== 'false',

  /**
   * مدة صلاحية الـ Cache (بالثواني)
   * Cache TTL in seconds
   */
  cacheTTL: parseInt(process.env.CHAT_TITLE_CACHE_TTL || '86400'), // 24 hours

  /**
   * System Prompt المستخدم
   * System prompt for AI model
   */
  systemPrompt: process.env.CHAT_TITLE_SYSTEM_PROMPT || `أنت خبير محترف في تلخيص المحادثات وتحسين تجربة المستخدم (UX). ستصلك رسائل من بداية محادثة بين مستخدم وبوت ذكي. مهمتك الوحيدة هي قراءة السياق وتوليد عنوان ذكي، دقيق، ومبتكر يعبر عن جوهر المحادثة.

**قواعد مهمة جداً:**
- ركز على **آخر رسالة من المستخدم** لأنها عادة تحتوي على السؤال أو الموضوع الرئيسي
- تجاهل التحيات والمجاملات مثل "مرحبا"، "كيف حالك"، "شكراً"
- إذا كان آخر سؤال من المستخدم واضح ومحدد، اجعل العنوان يعبر عنه مباشرة
- إذا كانت المحادثة عن سؤال معين (مثل: كم طول برج خليفة؟)، اجعل العنوان يعبر عن السؤال نفسه

**الشروط الصارمة:**
1. طول العنوان يجب أن يكون من 2 إلى 4 كلمات فقط.
2. يجب أن يكون العنوان باللغة العربية الفصحى وبصيغة جذابة.
3. لا تضع نقطة في نهاية العنوان، ولا تستخدم أي علامات ترقيم أو رموز تعبيرية.
4. لا تكتب أي مقدمات أو تفسيرات مثل "العنوان المقترح هو:"، بل أرسل نص العنوان الصافي مباشرة.

**أمثلة:**
- إذا كان السؤال: "كم طول برج خليفة؟" → العنوان: "طول برج خليفة"
- إذا كان السؤال: "كيف أستعد للامتحان؟" → العنوان: "الاستعداد للامتحان"
- إذا كان السؤال: "ما هي عاصمة فرنسا؟" → العنوان: "عاصمة فرنسا"`,

  /**
   * التحقق من صحة الإعدادات
   * Validate configuration
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (this.minMessagesCount < 1) {
      errors.push('minMessagesCount must be at least 1');
    }

    if (this.maxTitleLength < 10) {
      errors.push('maxTitleLength must be at least 10');
    }

    if (this.maxTokens < 5) {
      errors.push('maxTokens must be at least 5');
    }

    if (this.temperature < 0 || this.temperature > 1) {
      errors.push('temperature must be between 0 and 1');
    }

    if (this.timeout < 1000) {
      errors.push('timeout must be at least 1000ms');
    }

    if (this.retryAttempts < 0) {
      errors.push('retryAttempts must be non-negative');
    }

    // Check if at least one API key is available
    const hasApiKey = this.modelPriority.some(
      model => process.env[model.envKey]
    );

    if (this.enabled && !hasApiKey) {
      errors.push('No AI API key found. Please set GOOGLE_API_KEY, GITHUB_TOKEN, or GROQ_API_KEY');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  },

  /**
   * طباعة الإعدادات الحالية
   * Print current configuration
   */
  print(): void {
    log.info('📋 Chat Auto-Titling Configuration:');
    log.info('  ✓ Enabled:', this.enabled);
    log.info('  ✓ Min Messages:', this.minMessagesCount);
    log.info('  ✓ Max Title Length:', this.maxTitleLength);
    log.info('  ✓ Max Tokens:', this.maxTokens);
    log.info('  ✓ Temperature:', this.temperature);
    log.info('  ✓ Timeout: ' + this.timeout + ' ms');
    log.info('  ✓ Retry Attempts:', this.retryAttempts);
    log.info('  ✓ Cache Enabled:', this.enableCache);
    log.info('  ✓ Verbose Logging:', this.verboseLogging);
    
    const availableModels = this.modelPriority
      .filter(m => process.env[m.envKey])
      .map(m => m.model);
    
    log.info('  ✓ Available Models:', availableModels.join(', ') || 'None');
    
    const validation = this.validate();
    if (!validation.valid) {
      log.info('  ⚠️  Configuration Errors:');
      validation.errors.forEach(err => log.info('    -', err));
    }
  }
};

// التحقق من الإعدادات عند التحميل
if (ChatTitleConfig.verboseLogging) {
  ChatTitleConfig.print();
}

// تصدير دالة مساعدة للتحقق من التفعيل
export function isChatTitlingEnabled(): boolean {
  return ChatTitleConfig.enabled && ChatTitleConfig.validate().valid;
}

// تصدير دالة للحصول على النموذج المتاح
export function getAvailableModel(): { provider: string; model: string } | null {
  for (const modelConfig of ChatTitleConfig.modelPriority) {
    if (process.env[modelConfig.envKey]) {
      return {
        provider: modelConfig.provider,
        model: modelConfig.model
      };
    }
  }
  return null;
}
