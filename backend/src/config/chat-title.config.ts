import { createLogger } from '../utils/logger.js';

const log = createLogger('chat-title-config');

// Chat auto-titling configuration.

export const ChatTitleConfig = {
  // Enable or disable the whole auto-titling system.
  enabled: process.env.CHAT_AUTO_TITLING_ENABLED !== 'false',

  // Messages required before titling triggers.
  minMessagesCount: parseInt(process.env.CHAT_TITLE_MIN_MESSAGES || '2'),

  // Maximum title length in characters.
  maxTitleLength: parseInt(process.env.CHAT_TITLE_MAX_LENGTH || '100'),

  // Max tokens allowed for the AI model.
  maxTokens: parseInt(process.env.CHAT_TITLE_MAX_TOKENS || '20'),

  // Sampling temperature for the AI model (0-1).
  temperature: parseFloat(process.env.CHAT_TITLE_TEMPERATURE || '0.7'),

  // Default titles that should be replaced.
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

  // Priority order of AI models to try.
  modelPriority: [
    { provider: 'groq', model: 'qwen/qwen3.8-27b', envKey: 'GROQ_API_KEY' },
    { provider: 'bigmodel', model: 'glm-4-flash', envKey: 'BIGMODEL_API_KEY' },
    { provider: 'google', model: 'gemini-2.5-flash', envKey: 'GOOGLE_API_KEY' },
    { provider: 'nvidia', model: 'nvidia/nemotron-3.5-lightning-30b-a3b', envKey: 'NVIDIA_API_KEY' },
  ],

  // Timeout for the operation in milliseconds.
  timeout: parseInt(process.env.CHAT_TITLE_TIMEOUT || '10000'),

  // Number of retry attempts on failure.
  retryAttempts: parseInt(process.env.CHAT_TITLE_RETRY_ATTEMPTS || '2'),

  // Delay between retry attempts in milliseconds.
  retryDelay: parseInt(process.env.CHAT_TITLE_RETRY_DELAY || '1000'),

  // Enable verbose logging.
  verboseLogging: process.env.CHAT_TITLE_VERBOSE_LOGGING === 'true',

  // Enable caching of generated titles.
  enableCache: process.env.CHAT_TITLE_ENABLE_CACHE !== 'false',

  // Cache TTL in seconds.
  cacheTTL: parseInt(process.env.CHAT_TITLE_CACHE_TTL || '86400'), // 24 hours

  // System prompt for the AI model.
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

  // Validate the configuration values.
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

  // Log the current configuration values.
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

// Print the config on load when verbose logging is enabled.
if (ChatTitleConfig.verboseLogging) {
  ChatTitleConfig.print();
}

// Report whether auto-titling is enabled and its config is valid.
export function isChatTitlingEnabled(): boolean {
  return ChatTitleConfig.enabled && ChatTitleConfig.validate().valid;
}

// Return the first model in priority order whose API key is present.
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
