/**
 * Model Router with Circuit Breaker + Fallback
 * موجه النماذج مع قاطع الدائرة والاحتياطي
 */

import { createLogger } from "../../utils/logger.js";
import type { ProviderName } from "../../routes/chat/chat-shared.js";
import { getProviderAndModel } from "../../routes/chat/chat-shared.js";
import { CircuitBreaker, CircuitBreakerState } from "./circuit-breaker.js";
import { loadFallbackChains } from "./fallback-chains.js";

const log = createLogger("model-router");

export { CircuitBreaker, CircuitBreakerState } from "./circuit-breaker.js";

const FALLBACK_CHAINS = loadFallbackChains();

export class ModelRouter {
  private breakers: Map<string, CircuitBreaker> = new Map();

  private getBreaker(model: string): CircuitBreaker {
    if (!this.breakers.has(model)) {
      this.breakers.set(model, new CircuitBreaker());
    }
    return this.breakers.get(model)!;
  }

  getFallbackChain(primaryModel: string): string[] {
    const chain = FALLBACK_CHAINS[primaryModel] ? [...FALLBACK_CHAINS[primaryModel]] : [];
    if (!chain.includes("gpt-4o-mini")) {
      chain.push("gpt-4o-mini");
    }
    return chain;
  }

  getAvailableModel(
    requestedModel: string,
  ): { model: string; provider: ProviderName; isFallback: boolean } {
    const primaryBreaker = this.getBreaker(requestedModel);

    if (primaryBreaker.canExecute()) {
      const { provider } = getProviderAndModel(requestedModel);
      return { model: requestedModel, provider, isFallback: false };
    }

    log.warn(`Primary model "${requestedModel}" circuit is OPEN, walking fallback chain...`);

    const chain = this.getFallbackChain(requestedModel);
    for (const fallbackModel of chain) {
      const breaker = this.getBreaker(fallbackModel);
      if (breaker.canExecute()) {
        const { provider } = getProviderAndModel(fallbackModel);
        log.info(`Falling back to "${fallbackModel}" (provider: ${provider}) for requested "${requestedModel}"`);
        return { model: fallbackModel, provider, isFallback: true };
      }
    }

    log.error(`All models in fallback chain for "${requestedModel}" have open circuits! Forcing gpt-4o-mini as emergency fallback.`);
    const { provider } = getProviderAndModel("gpt-4o-mini");
    return { model: "gpt-4o-mini", provider, isFallback: true };
  }

  reportSuccess(model: string): void {
    const breaker = this.getBreaker(model);
    breaker.recordSuccess();
    log.debug(`Recorded success for model "${model}"`, {
      state: breaker.getState(),
      failures: breaker.getFailureCount(),
    });
  }

  reportFailure(model: string): void {
    const breaker = this.getBreaker(model);
    breaker.recordFailure();
    log.warn(`Recorded failure for model "${model}"`, {
      state: breaker.getState(),
      failures: breaker.getFailureCount(),
    });
  }

  getHealthStatus(): Record<string, { state: string; failures: number; lastFailure: Date | null }> {
    const status: Record<string, { state: string; failures: number; lastFailure: Date | null }> = {};
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

export const modelRouter = new ModelRouter();

export function getTextbookQAModel(): string | null {
  const configured = process.env.TEXTBOOK_QA_MODEL?.trim();
  if (!configured) return null;
  return configured;
}

export function getVisionModel(): string | null {
  const configured = process.env.VISION_MODEL?.trim();
  if (!configured) return null;
  return configured;
}

export function getGracefulDegradationMessage(originalModel: string, fallbackModel: string): string {
  return `نعتذر، النموذج الأساسي (${originalModel}) غير متاح حالياً. تم التحويل إلى نموذج بديل (${fallbackModel}). قد تختلف جودة الرد قليلاً.`;
}
