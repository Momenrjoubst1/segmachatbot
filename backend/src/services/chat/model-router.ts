/**
 * Model Router with Circuit Breaker + Fallback
 * موجه النماذج مع قاطع الدائرة والاحتياطي
 *
 * Features / الميزات:
 * 1. Circuit Breaker: After N consecutive failures for a model, stop trying it temporarily
 *    قاطع الدائرة: بعد N أعطال متتالية لنموذج، توقف عن تجربته مؤقتاً
 * 2. Model Fallback Chain: If primary fails, try fallback models in order
 *    سلسلة الاحتياطي: إذا فشل النموذج الأساسي، جرب النماذج البديلة بالترتيب
 * 3. Health tracking per model/provider
 *    تتبع صحة كل نموذج/مزود
 * 4. Graceful degradation messaging
 *    رسائل تدهور سلسة
 */

import { createLogger } from "../../utils/logger.js";
import type { ProviderName } from "../../routes/chat/chat-shared.js";
import { getProviderAndModel } from "../../routes/chat/chat-shared.js";

const log = createLogger("model-router");

// ─── Circuit Breaker States / حالات قاطع الدائرة ───

export enum CircuitBreakerState {
  /** Normal operation — requests flow through / وضع طبيعي — الطلبات تمر */
  CLOSED = "CLOSED",
  /** Broken — reject all requests / معطل — رفض جميع الطلبات */
  OPEN = "OPEN",
  /** Testing — allow one request to probe recovery / اختبار — السماح بطلب واحد لاختبار التعافي */
  HALF_OPEN = "HALF_OPEN",
}

// ─── CircuitBreaker Class / صنف قاطع الدائرة ───

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private lastFailureTime: Date | null = null;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number; // ms

  constructor(
    failureThreshold: number = 3,
    resetTimeout: number = 60_000,
  ) {
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
  }

  /**
   * Check if a request can be executed through this circuit
   * التحقق مما إذا كان يمكن تنفيذ طلب عبر هذه الدائرة
   */
  canExecute(): boolean {
    if (this.state === CircuitBreakerState.CLOSED) {
      return true;
    }

    if (this.state === CircuitBreakerState.OPEN) {
      // Check if reset timeout has elapsed → transition to HALF_OPEN
      // التحقق مما إذا انقضت مهلة إعادة التعيين → الانتقال إلى HALF_OPEN
      if (
        this.lastFailureTime &&
        Date.now() - this.lastFailureTime.getTime() >= this.resetTimeout
      ) {
        this.state = CircuitBreakerState.HALF_OPEN;
        log.info(
          `Circuit breaker transitioning OPEN → HALF_OPEN (reset timeout elapsed)`,
        );
        return true;
      }
      return false;
    }

    // HALF_OPEN — allow one probe request
    // HALF_OPEN — السماح بطلب اختبار واحد
    return true;
  }

  /**
   * Record a successful call / تسجيل مكالمة ناجحة
   */
  recordSuccess(): void {
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      log.info(`Circuit breaker transitioning HALF_OPEN → CLOSED (probe succeeded)`);
    }
    this.failureCount = 0;
    this.state = CircuitBreakerState.CLOSED;
  }

  /**
   * Record a failed call / تسجيل مكالمة فاشلة
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      // Probe failed — go back to OPEN
      // فشل الاختبار — العودة إلى OPEN
      this.state = CircuitBreakerState.OPEN;
      log.warn(
        `Circuit breaker transitioning HALF_OPEN → OPEN (probe failed)`,
      );
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitBreakerState.OPEN;
      log.warn(
        `Circuit breaker transitioning CLOSED → OPEN (${this.failureCount} consecutive failures, threshold=${this.failureThreshold})`,
      );
    }
  }

  /** Get current state / الحصول على الحالة الحالية */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /** Get failure count / الحصول على عدد الإخفاقات */
  getFailureCount(): number {
    return this.failureCount;
  }

  /** Get last failure time / الحصول على وقت آخر إخفاق */
  getLastFailureTime(): Date | null {
    return this.lastFailureTime;
  }
}

// ─── Fallback Chain Definition / تعريف سلسلة الاحتياطي ───
// Config-driven: can be overridden via MODEL_FALLBACK_CHAINS env var (JSON)
const DEFAULT_FALLBACK_CHAINS: Record<string, string[]> = {
  // Baichat
  "deepseek-v4-flash": ["gemini-3.7-flash", "gemini-2.5-flash", "nvidia/nemotron-3.5-lightning-30b-a3b:free", "gpt-4o-mini"],
  // Google Gemini (direct) - gemini-3.7-flash is alias for gemini-2.5-flash
  "gemini-3.7-flash": ["gemini-2.5-flash", "gemini-2.5-pro", "glm-5.2", "nvidia/nemotron-3.5-lightning-30b-a3b:free", "gpt-4o-mini"],
  "gemini-2.5-flash": ["gemini-2.5-pro", "gemini-3.7-flash", "glm-5.2", "nvidia/nemotron-3.5-lightning-30b-a3b:free", "gpt-4o-mini"],
  "gemini-2.5-pro": ["gemini-2.5-flash", "gemini-3.7-flash", "gpt-4o-mini"],
  "gemini-3-flash": ["gemini-2.5-flash", "gemini-3.7-flash", "nvidia/nemotron-3.5-lightning-30b-a3b:free", "gpt-4o-mini"],
  "gemini-3.1-flash-lite": ["gemini-2.5-flash", "gemini-3.7-flash", "nvidia/nemotron-3.5-lightning-30b-a3b:free", "gpt-4o-mini"],
  // BigModel
  "glm-5.2": ["qwen/qwen3.6-27b", "nvidia/nemotron-3-super-49b-a49b:free", "gpt-4o-mini"],
  // Azure/OpenAI
  "gpt-5.4": ["gpt-4o", "gpt-4o-mini"],
  "gpt-4o": ["gpt-4o-mini", "qwen/qwen3.6-27b"],
  "gpt-4o-mini": ["qwen/qwen3.6-27b", "nvidia/nemotron-3.5-lightning-30b-a3b:free"],
  // Groq
  "qwen/qwen3.6-27b": ["gpt-4o-mini", "glm-5.2", "nvidia/nemotron-3-super-49b-a49b:free"],
  "qwen/qwen3-32b": ["qwen/qwen3.6-27b", "nvidia/nemotron-3-super-49b-a49b:free", "gpt-4o-mini"],
  "mixtral-8x7b-32768": ["qwen/qwen3.6-27b", "nvidia/nemotron-3.5-lightning-30b-a3b:free", "gpt-4o-mini"],
  "llama-3.3-70b-versatile": ["qwen/qwen3.6-27b", "nvidia/nemotron-3-super-49b-a49b:free", "gpt-4o-mini"],
  "llama-3.1-8b-instant": ["llama-3.3-70b-versatile", "nvidia/nemotron-3.5-lightning-30b-a3b:free", "gpt-4o-mini"],
  "openai/gpt-oss-120b": ["openai/gpt-oss-20b", "qwen/qwen3.6-27b", "gpt-4o-mini"],
  "openai/gpt-oss-20b": ["openai/gpt-oss-120b", "nvidia/nemotron-3-super-49b-a49b:free", "gpt-4o-mini"],
  "meta-llama/llama-4-scout-17b-16e-instruct": ["llama-3.3-70b-versatile", "nvidia/nemotron-3.5-lightning-30b-a3b:free", "gpt-4o-mini"],
  // OpenRouter Free
  "google/gemini-2.0-flash-exp:free": ["nvidia/nemotron-3.5-lightning-30b-a3b:free", "gpt-4o-mini"],
  "qwen/qwen-2.5-72b-instruct:free": ["nvidia/nemotron-3-super-49b-a49b:free", "gpt-4o-mini"],
  "anthropic/claude-3.5-haiku": ["gpt-4o-mini", "gpt-4o"],
  // NVIDIA OpenRouter Free
  "nvidia/nemotron-3-ultra-550b-a55b:free": ["nvidia/nemotron-3-super-49b-a49b:free", "gpt-4o-mini"],
  "nvidia/nemotron-3.5-lightning-30b-a3b:free": ["nvidia/nemotron-3-nano-30b-a3b:free", "gpt-4o-mini"],
  "nvidia/nemotron-3-super-49b-a49b:free": ["nvidia/nemotron-3.5-lightning-30b-a3b:free", "gpt-4o-mini"],
  "nvidia/nemotron-3-nano-30b-a3b:free": ["nvidia/nemotron-nano-9b-v2:free", "gpt-4o-mini"],
  "nvidia/nemotron-nano-9b-v2:free": ["liquid/lfm2.5-2.6b:free", "gpt-4o-mini"],
  "nvidia/nemotron-nano-12b-2-vl:free": ["nvidia/nemotron-nano-9b-v2:free", "gpt-4o-mini"],
  "google/gemma-4-26b-a4b:free": ["nvidia/nemotron-3.5-lightning-30b-a3b:free", "gpt-4o-mini"],
  "openai/gpt-oss-20b:free": ["nvidia/nemotron-3-super-49b-a49b:free", "gpt-4o-mini"],
  "poolside/laguna-s-2.1:free": ["nvidia/nemotron-3.5-lightning-30b-a3b:free", "gpt-4o-mini"],
  "poolside/laguna-xs-2.1:free": ["liquid/lfm2.5-2.6b:free", "gpt-4o-mini"],
  "dots-studio/dots3-note-preview:free": ["nvidia/nemotron-3-nano-30b-a3b:free", "gpt-4o-mini"],
  "liquid/lfm2.5-2.6b:free": ["nvidia/nemotron-nano-9b-v2:free", "gpt-4o-mini"],
  // Fireworks
  "accounts/fireworks/models/gemma-4-31b-it": ["gpt-4o-mini", "nvidia/nemotron-3.5-lightning-30b-a3b:free"],
  // Novita
  "inclusionai/ling-3.0-tiny": ["qwen/qwen3.6-27b", "nvidia/nemotron-3-nano-30b-a3b:free", "gpt-4o-mini"],
  // NVIDIA NIM (direct)
  "nvidia/llama-3.1-nemotron-70b-instruct": ["nvidia/llama-3.3-70b-instruct", "qwen/qwen3.6-27b", "gpt-4o-mini"],
  "nvidia/llama-3.3-70b-instruct": ["qwen/qwen3.6-27b", "nvidia/nemotron-3-super-49b-a49b:free", "gpt-4o-mini"],
  "nvidia/deepseek-r1": ["deepseek-v4-flash", "nvidia/nemotron-3-super-49b-a49b:free", "gpt-4o-mini"],
  "meta/llama-3.1-8b-instruct": ["meta/llama-3.1-70b-instruct", "nvidia/nemotron-3.5-lightning-30b-a3b:free", "gpt-4o-mini"],
  "meta/llama-3.1-70b-instruct": ["nvidia/llama-3.3-70b-instruct", "qwen/qwen3.6-27b", "gpt-4o-mini"],
  "qwen/qwen2.5-72b-instruct": ["qwen/qwen3.6-27b", "nvidia/nemotron-3-super-49b-a49b:free", "gpt-4o-mini"],
  // Cerebras
  "llama-3.3-70b": ["qwen/qwen3.6-27b", "nvidia/nemotron-3-super-49b-a49b:free", "gpt-4o-mini"],
  "llama-3.1-8b": ["llama-3.3-70b", "nvidia/nemotron-3.5-lightning-30b-a3b:free", "gpt-4o-mini"],
};

function loadFallbackChains(): Record<string, string[]> {
  const envChains = process.env.MODEL_FALLBACK_CHAINS;
  if (envChains) {
    try {
      const parsed = JSON.parse(envChains) as Record<string, string[]>;
      log.info('Loaded custom model fallback chains from env', { count: Object.keys(parsed).length });
      return { ...DEFAULT_FALLBACK_CHAINS, ...parsed };
    } catch (e) {
      log.warn('Failed to parse MODEL_FALLBACK_CHAINS, using defaults', { error: (e as Error).message });
    }
  }
  return DEFAULT_FALLBACK_CHAINS;
}

const FALLBACK_CHAINS = loadFallbackChains();

// ─── ModelRouter Class / صنف موجه النماذج ───

export class ModelRouter {
  private breakers: Map<string, CircuitBreaker> = new Map();

  /**
   * Get or create a circuit breaker for a given model
   * الحصول على أو إنشاء قاطع دائرة لنموذج معين
   */
  private getBreaker(model: string): CircuitBreaker {
    if (!this.breakers.has(model)) {
      this.breakers.set(model, new CircuitBreaker());
    }
    return this.breakers.get(model)!;
  }

  /**
   * Get the ordered fallback chain for a given model
   * الحصول على سلسلة الاحتياطي المرتبة لنموذج معين
   *
   * Returns the chain defined in FALLBACK_CHAINS, with gpt-4o-mini
   * appended as a last resort if not already present.
   */
  getFallbackChain(primaryModel: string): string[] {
    const chain = FALLBACK_CHAINS[primaryModel]
      ? [...FALLBACK_CHAINS[primaryModel]]
      : [];

    // Ensure gpt-4o-mini is always the last resort
    // ضمان أن gpt-4o-mini هو الملاذ الأخير دائماً
    if (!chain.includes("gpt-4o-mini")) {
      chain.push("gpt-4o-mini");
    }

    return chain;
  }

  /**
   * Get the best available model, walking the fallback chain if needed
   * الحصول على أفضل نموذج متاح، مع السير في سلسلة الاحتياطي عند الحاجة
   *
   * @param requestedModel - The model the user originally requested
   * @returns Object with model ID, provider info, and whether it's a fallback
   */
  getAvailableModel(
    requestedModel: string,
  ): { model: string; provider: ProviderName; isFallback: boolean } {
    const primaryBreaker = this.getBreaker(requestedModel);

    // If the primary model's circuit is closed or half-open (probing), try it
    // إذا كانت دائرة النموذج الأساسي مغلقة أو نصف مفتوحة (اختبار)، جربه
    if (primaryBreaker.canExecute()) {
      const { provider } = getProviderAndModel(requestedModel);
      return { model: requestedModel, provider, isFallback: false };
    }

    // Primary is OPEN — walk the fallback chain
    // النموذج الأساسي مفتوح — السير في سلسلة الاحتياطي
    log.warn(
      `Primary model "${requestedModel}" circuit is OPEN, walking fallback chain...`,
    );

    const chain = this.getFallbackChain(requestedModel);
    for (const fallbackModel of chain) {
      const breaker = this.getBreaker(fallbackModel);
      if (breaker.canExecute()) {
        const { provider } = getProviderAndModel(fallbackModel);
        log.info(
          `Falling back to "${fallbackModel}" (provider: ${provider}) for requested "${requestedModel}"`,
        );
        return { model: fallbackModel, provider, isFallback: true };
      }
    }

    // All fallbacks are also open — force gpt-4o-mini as emergency fallback
    // جميع الاحتياطيات مفتوحة أيضاً — فرض gpt-4o-mini كاحتياطي طوارئ
    log.error(
      `All models in fallback chain for "${requestedModel}" have open circuits! Forcing gpt-4o-mini as emergency fallback.`,
    );
    const { provider } = getProviderAndModel("gpt-4o-mini");
    return { model: "gpt-4o-mini", provider, isFallback: true };
  }

  /**
   * Report a successful call for a model / الإبلاغ عن مكالمة ناجحة لنموذج
   */
  reportSuccess(model: string): void {
    const breaker = this.getBreaker(model);
    breaker.recordSuccess();
    log.debug(`Recorded success for model "${model}"`, {
      state: breaker.getState(),
      failures: breaker.getFailureCount(),
    });
  }

  /**
   * Report a failed call for a model / الإبلاغ عن مكالمة فاشلة لنموذج
   */
  reportFailure(model: string): void {
    const breaker = this.getBreaker(model);
    breaker.recordFailure();
    log.warn(`Recorded failure for model "${model}"`, {
      state: breaker.getState(),
      failures: breaker.getFailureCount(),
    });
  }

  /**
   * Get health status of all tracked models
   * الحصول على حالة صحة جميع النماذج المتتبعة
   */
  getHealthStatus(): Record<
    string,
    { state: string; failures: number; lastFailure: Date | null }
  > {
    const status: Record<
      string,
      { state: string; failures: number; lastFailure: Date | null }
    > = {};

    for (const [model, breaker] of this.breakers.entries()) {
      status[model] = {
        state: breaker.getState(),
        failures: breaker.getFailureCount(),
        lastFailure: breaker.getLastFailureTime(),
      };
    }

    return status;
  }
}

// ─── Singleton instance / نسخة وحيدة ───

export const modelRouter = new ModelRouter();

// ─── Textbook QA Model / نموذج أسئلة الكتب ───

/**
 * Get the stronger model for textbook-based QA when textbook chunks are present.
 * Falls back to the current model if TEXTBOOK_QA_MODEL is not set or not allowed.
 */
export function getTextbookQAModel(): string | null {
  const configured = process.env.TEXTBOOK_QA_MODEL?.trim();
  if (!configured) return null;
  return configured;
}

// ─── Vision Model / نموذج الرؤية ───

/**
 * Model used when a user message contains images and the selected model
 * lacks native vision. Falls back to the selected model when unset.
 */
export function getVisionModel(): string | null {
  const configured = process.env.VISION_MODEL?.trim();
  if (!configured) return null;
  return configured;
}

// ─── Graceful Degradation Message / رسالة التدهور السلسة ───

/**
 * Generate a user-friendly Arabic message when falling back to a cheaper model
 * إنشاء رسالة عربية صديقة للمستخدم عند التحويل إلى نموذج أرخص
 *
 * @param originalModel - The model that was originally requested
 * @param fallbackModel - The fallback model that will be used instead
 * @returns Arabic message explaining the degradation
 */
export function getGracefulDegradationMessage(
  originalModel: string,
  fallbackModel: string,
): string {
  return `نعتذر، النموذج الأساسي (${originalModel}) غير متاح حالياً. تم التحويل إلى نموذج بديل (${fallbackModel}). قد تختلف جودة الرد قليلاً.`;
}
