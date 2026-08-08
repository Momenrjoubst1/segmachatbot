/**
 * Advanced Memory System Configuration
 * مستوحى من نظام Gemini لكن يعمل مع أي نموذج
 */

import { createLogger } from "../utils/logger.js";

const log = createLogger('memory-config');

export const MemoryConfig = {
  // ==========================================
  // Context Window Management
  // ==========================================
  contextWindow: {
    // الحد الأقصى للرسائل قبل التلخيص
    maxMessages: parseInt(process.env.MEMORY_MAX_MESSAGES || '50'),
    
    // عدد الرسائل الأولى التي تُحفظ دائماً
    keepFirstMessages: parseInt(process.env.MEMORY_KEEP_FIRST || '5'),
    
    // عدد الرسائل الأخيرة التي تُحفظ دائماً
    keepLastMessages: parseInt(process.env.MEMORY_KEEP_LAST || '40'),
    
    // الحد الأدنى للرسائل قبل بدء التلخيص
    minMessagesForSummary: parseInt(process.env.MEMORY_MIN_FOR_SUMMARY || '12'),
  },

  // ==========================================
  // Smart Summarization
  // ==========================================
  summarization: {
    // تفعيل/تعطيل التلخيص الذكي
    enabled: process.env.MEMORY_SUMMARIZATION_ENABLED !== 'false',
    
    // النموذج المستخدم للتلخيص (رخيص وسريع)
    model: process.env.MEMORY_SUMMARY_MODEL || 'gpt-4o-mini',
    
    // الحد الأقصى لطول الملخص (tokens)
    maxSummaryTokens: parseInt(process.env.MEMORY_SUMMARY_MAX_TOKENS || '500'),
    
    // عدد الرسائل التي تُلخص في كل مرة
    messagesPerSummary: parseInt(process.env.MEMORY_MESSAGES_PER_SUMMARY || '10'),
    
    // الحد الأدنى لطول الرسالة لتضمينها في الملخص
    minMessageLength: parseInt(process.env.MEMORY_MIN_MESSAGE_LENGTH || '10'),
  },

  // ==========================================
  // Context Caching
  // ==========================================
  caching: {
    // تفعيل/تعطيل التخزين المؤقت
    enabled: process.env.MEMORY_CACHING_ENABLED !== 'false',
    
    // مدة الاحتفاظ بالـ cache (بالثواني)
    ttl: parseInt(process.env.MEMORY_CACHE_TTL || '3600'), // ساعة واحدة
    
    // الحد الأدنى لحجم المحتوى للتخزين المؤقت (characters)
    minContentSize: parseInt(process.env.MEMORY_CACHE_MIN_SIZE || '1000'),
    
    // الحد الأقصى لحجم الـ cache (MB)
    maxCacheSize: parseInt(process.env.MEMORY_CACHE_MAX_SIZE || '100'),
  },

  // ==========================================
  // Enhanced Memory Bank
  // ==========================================
  memoryBank: {
    // تفعيل/تعطيل الذاكرة الدائمة المحسّنة
    enabled: process.env.MEMORY_BANK_ENABLED !== 'false',
    
    // الحد الأقصى لعدد الحقائق المحفوظة لكل مستخدم
    maxFactsPerUser: parseInt(process.env.MEMORY_MAX_FACTS || '100'),
    
    // الحد الأدنى لعدد الرسائل قبل استخراج الحقائق
    minMessagesForExtraction: parseInt(process.env.MEMORY_MIN_FOR_EXTRACTION || '6'),
    
    // الحد الأقصى لعدد مرات الاستخراج في الجلسة الواحدة
    maxExtractionsPerSession: parseInt(process.env.MEMORY_MAX_EXTRACTIONS || '5'),
    
    // الفئات المدعومة
    categories: [
      'personal',      // معلومات شخصية
      'academic',      // معلومات أكاديمية
      'preference',    // تفضيلات
      'context',       // سياق
      'goal',          // أهداف
      'schedule',      // جدول
      'behavior',      // سلوك
    ] as const,
  },

  // ==========================================
  // Cross-Session Recall
  // ==========================================
  crossSession: {
    // تفعيل/تعطيل التذكر عبر المحادثات
    enabled: process.env.MEMORY_CROSS_SESSION_ENABLED !== 'false',
    
    // عدد المحادثات السابقة للبحث فيها
    maxPreviousChats: parseInt(process.env.MEMORY_MAX_PREVIOUS_CHATS || '10'),
    
    // الحد الأقصى لعمر المحادثة للبحث فيها (أيام)
    maxChatAgeDays: parseInt(process.env.MEMORY_MAX_CHAT_AGE_DAYS || '30'),
    
    // عدد النتائج من كل محادثة
    resultsPerChat: parseInt(process.env.MEMORY_RESULTS_PER_CHAT || '3'),
  },

  // ==========================================
  // Performance & Optimization
  // ==========================================
  performance: {
    // تفعيل/تعطيل الضغط للرسائل الطويلة
    compressionEnabled: process.env.MEMORY_COMPRESSION_ENABLED !== 'false',
    
    // الحد الأدنى لطول الرسالة للضغط (characters)
    compressionThreshold: parseInt(process.env.MEMORY_COMPRESSION_THRESHOLD || '5000'),
    
    // تفعيل/تعطيل التحميل الكسول للذاكرة
    lazyLoadingEnabled: process.env.MEMORY_LAZY_LOADING_ENABLED !== 'false',
    
    // تفعيل/تعطيل التوازي في العمليات
    parallelProcessing: process.env.MEMORY_PARALLEL_PROCESSING !== 'false',
  },

  // ==========================================
  // Debugging & Monitoring
  // ==========================================
  debug: {
    // تفعيل/تعطيل سجلات التصحيح
    enabled: process.env.MEMORY_DEBUG === 'true',
    
    // تفعيل/تعطيل إحصائيات الأداء
    performanceMetrics: process.env.MEMORY_METRICS === 'true',
    
    // تفعيل/تعطيل تسجيل العمليات
    logOperations: process.env.MEMORY_LOG_OPERATIONS === 'true',
  },
};

// Type definitions
export type MemoryCategory = typeof MemoryConfig.memoryBank.categories[number];

export interface MemoryMetrics {
  totalMessages: number;
  summarizedMessages: number;
  cachedItems: number;
  memoryFacts: number;
  crossSessionHits: number;
  processingTimeMs: number;
}

// Validation
export function validateMemoryConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (MemoryConfig.contextWindow.maxMessages < MemoryConfig.contextWindow.minMessagesForSummary) {
    errors.push('maxMessages must be >= minMessagesForSummary');
  }

  if (MemoryConfig.contextWindow.keepFirstMessages + MemoryConfig.contextWindow.keepLastMessages > MemoryConfig.contextWindow.maxMessages) {
    errors.push('keepFirstMessages + keepLastMessages must be <= maxMessages');
  }

  if (MemoryConfig.summarization.maxSummaryTokens < 100) {
    errors.push('maxSummaryTokens must be >= 100');
  }

  if (MemoryConfig.caching.ttl < 60) {
    errors.push('cache TTL must be >= 60 seconds');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Validate configuration on startup (skip in test environments)
if (process.env.NODE_ENV !== 'test') {
  const validation = validateMemoryConfig();
  if (!validation.valid) {
    log.error('Memory configuration errors', { errors: validation.errors });
  }

  if (MemoryConfig.debug.enabled) {
    log.info('Advanced Memory System Configuration:', {
      contextWindow: MemoryConfig.contextWindow,
      summarization: MemoryConfig.summarization,
      caching: MemoryConfig.caching,
      memoryBank: MemoryConfig.memoryBank,
      crossSession: MemoryConfig.crossSession,
    });
    if (validation.valid) {
      log.info('Configuration valid');
    }
  }
}
