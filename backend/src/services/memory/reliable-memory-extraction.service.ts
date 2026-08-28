/**
 * Reliable Memory Extraction Service
 * خدمة استخراج الذاكرة الموثوقة
 * 
 * Features:
 * - Retry logic with exponential backoff
 * - Dead letter queue for failed extractions
 * - Visibility/monitoring via database tracking
 * - Idempotency guarantees
 * - Rate limiting per user
 * - Structured logging for observability
 */

import { supabase } from '../../config/supabase.config.js';
import { MemoryConfig } from '../../config/memory.config.js';
import { createLogger } from '../../utils/logger.js';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { extractFacts } from './memory-fact-extractor.js';
import { getMemory, setMemory, type MemoryEntry } from './memory-repository.js';
import { enhancedMemory } from './enhanced-memory.service.js';
import { crossSession } from './cross-session.service.js';

const log = createLogger('reliable-memory-extraction');

// ==========================================
// Types
// ==========================================

export interface ExtractionJob {
  id: string;
  userId: string;
  threadId: string | null;
  messages: Array<{ role: string; content: string }>;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter';
  attempt: number;
  maxAttempts: number;
  extractedFacts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  nextRetryAt: string | null;
}

export interface ExtractionConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  maxConcurrentExtractions: number;
  minMessagesForExtraction: number;
  maxExtractionsPerUserPerDay: number;
}

export interface ExtractionResult {
  success: boolean;
  extractedCount: number;
  jobId: string;
  error?: string;
  facts: Array<{ key: string; value: unknown; category: string }>;
}

export interface DeadLetterEntry {
  id: string;
  jobId: string;
  userId: string;
  threadId: string | null;
  messages: Array<{ role: string; content: string }>;
  lastError: string;
  attempts: number;
  createdAt: string;
  resolved: boolean;
  resolvedAt: string | null;
}

// ==========================================
// Default Configuration
// ==========================================

const DEFAULT_CONFIG: ExtractionConfig = {
  maxAttempts: 3,
  baseDelayMs: 5000,      // 5 seconds
  maxDelayMs: 300000,     // 5 minutes
  backoffMultiplier: 2,
  maxConcurrentExtractions: 3,
  minMessagesForExtraction: 6,
  maxExtractionsPerUserPerDay: 10,
};

// ==========================================
// Database Helpers
// ==========================================

async function ensureExtractionTables(): Promise<void> {
  try {
    // Check if extraction_jobs table exists
    const { error } = await supabase
      .from('memory_extraction_jobs')
      .select('id')
      .limit(1);

    if (error && error.code === '42P01') {
      log.warn('memory_extraction_jobs table not found. Create via migration.');
    }
  } catch {
    log.warn('Could not verify memory_extraction_jobs table');
  }
}

function generateJobId(): string {
  return `ext_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function calculateNextRetry(attempt: number, config: ExtractionConfig): Date {
  const delay = Math.min(
    config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
    config.maxDelayMs
  );
  return new Date(Date.now() + delay);
}

// ==========================================
// Core Extraction Logic
// ==========================================

/**
 * Extract facts from messages using AI with structured output
 */
async function extractFactsWithAI(
  messages: Array<{ role: string; content: string }>,
  existingKeys: Set<string>
): Promise<Array<{ category: string; key: string; value: unknown; confidence: number }>> {
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
    const azureKey = process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    const azureEndpoint = process.env.AZURE_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
    const azureModel = process.env.AZURE_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4o-mini';

    let model;
    if (azureKey && azureEndpoint) {
      const cleanEndpoint = azureEndpoint.replace(/\/$/, '');
      model = createOpenAI({
        baseURL: cleanEndpoint,
        apiKey: azureKey,
        headers: { "api-key": azureKey },
      }).chat(azureModel);
    } else if (process.env.OPENROUTER_API_KEY) {
      model = createOpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY,
      }).chat('openai/gpt-4o-mini');
    } else {
      throw new Error('No AI provider configured for memory extraction');
    }

    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: 1500,
      temperature: 0.2,
    });

    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      log.warn('[ReliableExtraction] No JSON found in AI response');
      return [];
    }

    const extracted = JSON.parse(jsonMatch[0]);
    
    // Filter results
    return extracted.filter((item: { category?: string; key?: string; value?: unknown; confidence?: number }) =>
      item.category &&
      item.key &&
      item.value &&
      item.confidence! >= 0.7 &&
      (MemoryConfig.memoryBank.categories as readonly string[]).includes(item.category) &&
      !existingKeys.has(item.key)
    );
  } catch (error) {
    log.error('[ReliableExtraction] Error in AI extraction', { error });
    throw error;
  }
}

/**
 * Save extracted facts to database
 */
async function saveFacts(
  userId: string,
  facts: Array<{ category: string; key: string; value: unknown; confidence: number }>,
  threadId: string | undefined
): Promise<number> {
  let saved = 0;
  for (const fact of facts) {
    try {
      await setMemory(userId, fact.key, fact.value, fact.category as any, threadId);
      saved++;
    } catch (err) {
      log.warn('[ReliableExtraction] Failed to save fact', { error: (err as Error)?.message, fact: fact.key });
    }
  }
  return saved;
}

// ==========================================
// Reliable Extraction Service
// ==========================================

class ReliableMemoryExtractionService {
  private static instance: ReliableMemoryExtractionService;
  private config: ExtractionConfig = DEFAULT_CONFIG;
  private processingJobs = new Map<string, boolean>();

  private constructor() {
    // Periodic cleanup of stuck jobs
    setInterval(() => this.cleanupStuckJobs(), 5 * 60 * 1000).unref();
    // Periodic retry of failed jobs
    setInterval(() => this.retryFailedJobs(), 2 * 60 * 1000).unref();
  }

  static getInstance(): ReliableMemoryExtractionService {
    if (!ReliableMemoryExtractionService.instance) {
      ReliableMemoryExtractionService.instance = new ReliableMemoryExtractionService();
    }
    return ReliableMemoryExtractionService.instance;
  }

  /**
   * Configure the service
   */
  configure(config: Partial<ExtractionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Submit a new extraction job (non-blocking)
   * Returns job ID for tracking
   */
  async submitExtractionJob(
    userId: string,
    messages: Array<{ role: string; content: string }>,
    threadId?: string
  ): Promise<string> {
    // Validate
    if (messages.length < this.config.minMessagesForExtraction) {
      throw new Error(`Insufficient messages for extraction (need ${this.config.minMessagesForExtraction}, got ${messages.length})`);
    }

    // Check daily limit
    const today = new Date().toISOString().split('T')[0];
    const { count } = await supabase
      .from('memory_extraction_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00`);

    if ((count ?? 0) >= this.config.maxExtractionsPerUserPerDay) {
      throw new Error(`Daily extraction limit reached for user ${userId}`);
    }

    // Check concurrent limit
    const { count: activeCount } = await supabase
      .from('memory_extraction_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['pending', 'processing']);

    if ((activeCount ?? 0) >= this.config.maxConcurrentExtractions) {
      throw new Error(`Concurrent extraction limit reached for user ${userId}`);
    }

    // Create job record
    const jobId = generateJobId();
    const job: Omit<ExtractionJob, 'id'> = {
      userId,
      threadId: threadId ?? null,
      messages,
      status: 'pending',
      attempt: 0,
      maxAttempts: this.config.maxAttempts,
      extractedFacts: 0,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      nextRetryAt: null,
    };

    const { error } = await supabase
      .from('memory_extraction_jobs')
      .insert({ ...job, id: jobId });

    if (error) {
      log.error('[ReliableExtraction] Failed to create job', { error, jobId });
      throw new Error(`Failed to create extraction job: ${error.message}`);
    }

    // Process asynchronously (fire and forget with tracking)
    this.processJobAsync(jobId).catch(err => {
      log.error('[ReliableExtraction] Unhandled job processing error', { error: err, jobId });
    });

    return jobId;
  }

  /**
   * Process a job asynchronously with retry logic
   */
  private async processJobAsync(jobId: string): Promise<void> {
    if (this.processingJobs.has(jobId)) return;
    this.processingJobs.set(jobId, true);

    try {
      await this.processJob(jobId);
    } finally {
      this.processingJobs.delete(jobId);
    }
  }

  /**
   * Process a single extraction job
   */
  private async processJob(jobId: string): Promise<void> {
    // Load job
    const { data: job, error: loadError } = await supabase
      .from('memory_extraction_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (loadError || !job) {
      log.error('[ReliableExtraction] Job not found', { jobId, error: loadError });
      return;
    }

    const jobData = job as ExtractionJob;

    // Skip if already completed or dead_letter
    if (jobData.status === 'completed' || jobData.status === 'dead_letter') {
      return;
    }

    // Claim the job with a verified pending→processing transition. Supabase
    // reports no error for zero-row updates, so the claim must be confirmed
    // by the returned row count — otherwise two workers (or a retry racing
    // the original) could extract the same conversation in parallel.
    const { data: claimed, error: claimError } = await supabase
      .from('memory_extraction_jobs')
      .update({
        status: 'processing',
        attempt: jobData.attempt + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', 'pending')
      .select('id');

    if (claimError || !claimed || claimed.length === 0) {
      log.info('[ReliableExtraction] Job not claimable (claimed/completed elsewhere)', { jobId });
      return;
    }

    try {
      // Check if we should use enhanced memory extraction
      let extractedCount = 0;
      let extractedFacts: Array<{ key: string; value: unknown; category: string }> = [];

      if (MemoryConfig.memoryBank.enabled) {
        // Use enhanced memory service
        const enhancedResults = await enhancedMemory.extractMemories(
          jobData.userId,
          jobData.messages,
          jobData.threadId ?? undefined
        );
        extractedCount = enhancedResults.length;
        extractedFacts = enhancedResults.map(r => ({
          key: r.key,
          value: r.value,
          category: r.category,
        }));
      } else {
        // Fallback to basic extraction
        const existing = await getMemory(jobData.userId);
        const existingKeys = new Set(existing.map(e => e.key));
        
        const facts = await extractFactsWithAI(jobData.messages, existingKeys);
        extractedFacts = facts.map(f => ({ key: f.key, value: f.value, category: f.category }));
        extractedCount = await saveFacts(jobData.userId, facts, jobData.threadId ?? undefined);
      }

      // Also index for cross-session search
      if (jobData.threadId && extractedCount > 0) {
        try {
          await crossSession.indexMessageForSearch(
            `ext_${jobId}`,
            jobData.threadId,
            jobData.userId,
            `Extracted ${extractedCount} facts from conversation`,
            'system'
          );
        } catch (idxErr) {
          log.warn('[ReliableExtraction] Cross-session indexing failed', { error: (idxErr as Error)?.message });
        }
      }

      // Mark completed
      await this.updateJobStatus(jobId, 'completed', {
        extractedFacts: extractedCount,
        completedAt: new Date().toISOString(),
      });

      log.info('[ReliableExtraction] Job completed', {
        jobId,
        userId: jobData.userId,
        extractedCount,
        attempt: jobData.attempt + 1,
      });

    } catch (err) {
      const error = err as Error;
      await this.handleJobFailure(jobId, error);
    }
  }

  /**
   * Handle job failure with retry logic
   */
  private async handleJobFailure(jobId: string, error: Error): Promise<void> {
    const { data: job } = await supabase
      .from('memory_extraction_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job) return;

    const jobData = job as ExtractionJob;
    const nextAttempt = jobData.attempt + 1;

    if (nextAttempt >= jobData.maxAttempts) {
      // Move to dead letter queue
      await this.moveToDeadLetter(jobId, error.message);
      log.error('[ReliableExtraction] Job moved to dead letter', { jobId, error: error.message, attempts: nextAttempt });
    } else {
      // Schedule retry
      const nextRetry = calculateNextRetry(nextAttempt, this.config);
      await this.updateJobStatus(jobId, 'pending', {
        attempt: nextAttempt,
        error: error.message,
        nextRetryAt: nextRetry.toISOString(),
      });
      log.warn('[ReliableExtraction] Job failed, scheduling retry', {
        jobId,
        attempt: nextAttempt,
        maxAttempts: jobData.maxAttempts,
        nextRetry: nextRetry.toISOString(),
        error: error.message,
      });
    }
  }

  /**
   * Move failed job to dead letter queue
   */
  private async moveToDeadLetter(jobId: string, error: string): Promise<void> {
    const { data: job } = await supabase
      .from('memory_extraction_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job) return;

    const jobData = job as ExtractionJob;

    // Insert into dead letter table
    await supabase
      .from('memory_extraction_dead_letter')
      .insert({
        job_id: jobId,
        user_id: jobData.userId,
        thread_id: jobData.threadId,
        messages: jobData.messages,
        last_error: error,
        attempts: jobData.attempt,
        created_at: new Date().toISOString(),
        resolved: false,
      });

    // Update job status
    await this.updateJobStatus(jobId, 'dead_letter', {
      error,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Update job status in database
   */
  private async updateJobStatus(
    jobId: string,
    status: ExtractionJob['status'],
    updates: Partial<ExtractionJob> = {}
  ): Promise<void> {
    await supabase
      .from('memory_extraction_jobs')
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...updates,
      })
      .eq('id', jobId);
  }

  /**
   * Get job status for monitoring
   */
  async getJobStatus(jobId: string): Promise<ExtractionJob | null> {
    const { data, error } = await supabase
      .from('memory_extraction_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !data) return null;
    return data as ExtractionJob;
  }

  /**
   * Get user's extraction jobs for monitoring
   */
  async getUserJobs(userId: string, limit = 20): Promise<ExtractionJob[]> {
    const { data, error } = await supabase
      .from('memory_extraction_jobs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return (data || []) as ExtractionJob[];
  }

  /**
   * Get dead letter entries for admin review
   */
  async getDeadLetters(limit = 50): Promise<DeadLetterEntry[]> {
    const { data, error } = await supabase
      .from('memory_extraction_dead_letter')
      .select('*')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return (data || []) as DeadLetterEntry[];
  }

  /**
   * Retry a dead letter entry
   */
  async retryDeadLetter(deadLetterId: string): Promise<string | null> {
    const { data: dl, error } = await supabase
      .from('memory_extraction_dead_letter')
      .select('*')
      .eq('id', deadLetterId)
      .single();

    if (error || !dl) return null;

    const deadLetter = dl as DeadLetterEntry;

    // Create new job from dead letter
    const jobId = await this.submitExtractionJob(
      deadLetter.userId,
      deadLetter.messages,
      deadLetter.threadId ?? undefined
    );

    // Mark dead letter as resolved
    await supabase
      .from('memory_extraction_dead_letter')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', deadLetterId);

    return jobId;
  }

  /**
   * Cleanup stuck jobs (processing for too long)
   */
  private async cleanupStuckJobs(): Promise<void> {
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes

    const { data: stuckJobs } = await supabase
      .from('memory_extraction_jobs')
      .select('id')
      .eq('status', 'processing')
      .lt('updated_at', staleThreshold);

    if (stuckJobs && stuckJobs.length > 0) {
      for (const job of stuckJobs) {
        await this.updateJobStatus(job.id, 'pending', {
          error: 'Job timed out, rescheduling',
          attempt: 0, // Reset attempt count
        });
      }
      log.info('[ReliableExtraction] Reset stuck jobs', { count: stuckJobs.length });
    }
  }

  /**
   * Retry failed jobs that are due for retry
   */
  private async retryFailedJobs(): Promise<void> {
    const now = new Date().toISOString();

    const { data: retryJobs } = await supabase
      .from('memory_extraction_jobs')
      .select('id')
      .eq('status', 'pending')
      .not('next_retry_at', 'is', null)
      .lte('next_retry_at', now);

    if (retryJobs && retryJobs.length > 0) {
      for (const job of retryJobs) {
        this.processJobAsync(job.id).catch(err => {
          log.error('[ReliableExtraction] Retry processing error', { error: err, jobId: job.id });
        });
      }
      log.info('[ReliableExtraction] Retrying scheduled jobs', { count: retryJobs.length });
    }
  }

  /**
   * Get extraction statistics for monitoring
   */
  async getStats(): Promise<{
    totalJobs: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    deadLetter: number;
    avgExtractedPerJob: number;
    successRate: number;
  }> {
    const { data: jobs } = await supabase
      .from('memory_extraction_jobs')
      .select('status, extracted_facts')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (!jobs) {
      return {
        totalJobs: 0,
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        deadLetter: 0,
        avgExtractedPerJob: 0,
        successRate: 0,
      };
    }

    const stats = {
      totalJobs: jobs.length,
      pending: jobs.filter(j => j.status === 'pending').length,
      processing: jobs.filter(j => j.status === 'processing').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      deadLetter: jobs.filter(j => j.status === 'dead_letter').length,
      avgExtractedPerJob: 0,
      successRate: 0,
    };

    const completedJobs = jobs.filter(j => j.status === 'completed');
    if (completedJobs.length > 0) {
      stats.avgExtractedPerJob = completedJobs.reduce((sum, j) => sum + (j.extracted_facts || 0), 0) / completedJobs.length;
      stats.successRate = completedJobs.length / (completedJobs.length + stats.failed + stats.deadLetter);
    }

    return stats;
  }
}

// Export singleton instance
export const reliableMemoryExtraction = ReliableMemoryExtractionService.getInstance();

/**
 * Database migration SQL:
 * 
 * CREATE TABLE memory_extraction_jobs (
 *   id TEXT PRIMARY KEY,
 *   user_id UUID NOT NULL REFERENCES auth.users(id),
 *   thread_id UUID REFERENCES chat_sessions(id),
 *   messages JSONB NOT NULL,
 *   status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
 *   attempt INT NOT NULL DEFAULT 0,
 *   max_attempts INT NOT NULL DEFAULT 3,
 *   extracted_facts INT NOT NULL DEFAULT 0,
 *   error TEXT,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   completed_at TIMESTAMPTZ,
 *   next_retry_at TIMESTAMPTZ
 * );
 * 
 * CREATE INDEX ON memory_extraction_jobs (user_id, status);
 * CREATE INDEX ON memory_extraction_jobs (next_retry_at) WHERE status = 'pending' AND next_retry_at IS NOT NULL;
 * 
 * CREATE TABLE memory_extraction_dead_letter (
 *   id BIGSERIAL PRIMARY KEY,
 *   job_id TEXT NOT NULL,
 *   user_id UUID NOT NULL REFERENCES auth.users(id),
 *   thread_id UUID REFERENCES chat_sessions(id),
 *   messages JSONB NOT NULL,
 *   last_error TEXT NOT NULL,
 *   attempts INT NOT NULL,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   resolved BOOLEAN NOT NULL DEFAULT FALSE,
 *   resolved_at TIMESTAMPTZ
 * );
 * 
 * CREATE INDEX ON memory_extraction_dead_letter (user_id, resolved);
 */