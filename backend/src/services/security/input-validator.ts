/**
 * Input Validation Service
 * خدمة التحقق من المدخلات - كشف الحقن والمحتوى الضار
 *
 * Detects:
 *  1. Prompt-injection attempts
 *  2. Excess length (token-bombing)
 *  3. Repetitive / abuse content
 *  4. Profanity (optional, lazy-loaded)
 *
 * Used by:
 *  - POST /api/moderation/check  (sync, in-process)
 *  - POST /api/moderation/full    (async, also runs Supabase moderator)
 */

import { createLogger } from '../../utils/logger.js';
import { z } from 'zod';

const log = createLogger('input-validator');

// ==========================================
// Public types
// ==========================================

export type ValidationIssueType =
  | 'injection'
  | 'length'
  | 'moderation'
  | 'structure'
  | 'abuse';

export type ValidationSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ValidationIssue {
  type: ValidationIssueType;
  severity: ValidationSeverity;
  message: string;
  details?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  sanitizedMessage?: string;
  riskScore: number; // 0-100, higher = more risky
}

export interface ValidationOptions {
  maxMessageLength?: number;
  enableInjectionDetection?: boolean;
  enableModeration?: boolean;
  language?: 'ar' | 'en' | 'auto';
}

/** Zod schema for the `/api/moderation/check` request body. */
export const moderationCheckSchema = z.object({
  content: z.string().min(1).max(50_000),
  maxMessageLength: z.number().int().positive().optional(),
  enableInjectionDetection: z.boolean().optional(),
  enableModeration: z.boolean().optional(),
  language: z.enum(['ar', 'en', 'auto']).optional(),
});

export type ModerationCheckInput = z.infer<typeof moderationCheckSchema>;

// ==========================================
// Pattern definitions
// ==========================================

interface PatternRule {
  pattern: RegExp;
  severity: ValidationSeverity;
  desc: string;
}

const INJECTION_PATTERNS: ReadonlyArray<PatternRule> = [
  // System prompt extraction
  { pattern: /ignore (all )?(previous|above|prior) (instructions?|prompts?|rules?|messages?)/i, severity: 'high', desc: 'System prompt extraction attempt' },
  { pattern: /disregard (all )?(previous|above|prior)/i, severity: 'high', desc: 'System prompt extraction attempt' },
  { pattern: /forget (all )?(your )?(instructions?|rules?|training)/i, severity: 'high', desc: 'Instruction override attempt' },
  { pattern: /you are now/i, severity: 'medium', desc: 'Role override attempt' },
  { pattern: /act as (a |an |if you are)/i, severity: 'low', desc: 'Role play attempt' },

  // Prompt leaking
  { pattern: /(show|print|output|display|reveal|repeat) (me )?(your )?(system prompt|instructions|rules|initial message)/i, severity: 'high', desc: 'Prompt leaking attempt' },
  { pattern: /what (are|were) you (told|instructed|programmed)/i, severity: 'medium', desc: 'Instruction probing' },
  { pattern: /begin (your response|reply) with/i, severity: 'medium', desc: 'Output manipulation attempt' },

  // Jailbreak
  { pattern: /DAN|Do Anything Now|jailbreak|bypass (filter|restrictions?|limitations?)/i, severity: 'critical', desc: 'Jailbreak attempt' },
  { pattern: /pretend (you are|to be) (an? )?(unrestricted|uncensored|unfiltered)/i, severity: 'high', desc: 'Restriction bypass attempt' },

  // Token manipulation
  { pattern: /\[INST\]|\[\/INST\]|<<SYS>>|<</i, severity: 'high', desc: 'Token injection attempt' },
  { pattern: /\bSYSTEM:\s/i, severity: 'medium', desc: 'System role injection' },
];

const ABUSE_PATTERNS: ReadonlyArray<PatternRule> = [
  // Token bombing
  { pattern: /\s{500,}/, severity: 'medium', desc: 'Excessive whitespace (potential token bombing)' },
  // Repetitive content
  { pattern: /(.{50,})\1{5,}/i, severity: 'medium', desc: 'Repetitive content flooding' },
  // Excessive emoji/special chars (common in spam)
  { pattern: /[\u{1F600}-\u{1F64F}]{20,}/u, severity: 'low', desc: 'Excessive emoji spam' },
  // Repeated special characters
  { pattern: /[!?._-]{50,}/, severity: 'low', desc: 'Excessive special characters' },
];

// ==========================================
// Service
// ==========================================

const SEVERITY_WEIGHT: Record<ValidationSeverity, number> = {
  critical: 50,
  high: 30,
  medium: 15,
  low: 5,
};

class InputValidationService {
  private static instance: InputValidationService;

  private constructor() {}

  static getInstance(): InputValidationService {
    if (!InputValidationService.instance) {
      InputValidationService.instance = new InputValidationService();
    }
    return InputValidationService.instance;
  }

  /**
   * Comprehensive async validation.  Performs injection + abuse detection.
   * Profanity filtering is opt-in via `enableModeration` — when the
   * `bad-words` package is not installed the call still succeeds and
   * profanity detection is silently skipped.
   */
  async validate(
    message: string,
    options: ValidationOptions = {},
  ): Promise<ValidationResult> {
    const maxMessageLength = options.maxMessageLength
      ?? parseInt(process.env.MAX_MESSAGE_LENGTH || '400000', 10);
    const enableInjectionDetection = options.enableInjectionDetection
      ?? process.env.ENABLE_INJECTION_DETECTION !== 'false';
    const enableModeration = options.enableModeration
      ?? process.env.ENABLE_CONTENT_MODERATION !== 'false';

    const issues: ValidationIssue[] = [];
    let riskScore = 0;
    let sanitizedMessage = message;

    // 1. Structure
    if (!message || typeof message !== 'string') {
      return {
        valid: false,
        issues: [{
          type: 'structure',
          severity: 'critical',
          message: 'Message must be a non-empty string',
        }],
        riskScore: 100,
      };
    }

    // 2. Length
    if (message.length > maxMessageLength) {
      issues.push({
        type: 'length',
        severity: 'medium',
        message: `Message too long (${message.length}/${maxMessageLength} chars). Please shorten your message.`,
      });
      riskScore += 20;
    }

    // 3. Injection
    if (enableInjectionDetection) {
      const injectionIssues = this.detectInjection(message);
      issues.push(...injectionIssues);
      for (const i of injectionIssues) {
        riskScore += SEVERITY_WEIGHT[i.severity];
      }
    }

    // 4. Abuse patterns
    const abuseIssues = this.detectAbuse(message);
    issues.push(...abuseIssues);
    riskScore += abuseIssues.length * 20;

    // 5. Profanity (best-effort, lazy) — extended to 20K chars for better coverage
    if (enableModeration && message.length < 20_000) {
      const profanity = await this.checkProfanity(message);
      if (profanity.flagged) {
        sanitizedMessage = profanity.cleaned ?? message;
        issues.push({
          type: 'moderation',
          severity: 'low',
          message: 'Content contained profanity (auto-cleaned)',
        });
        riskScore += 10;
      }
    }

    riskScore = Math.min(riskScore, 100);
    const hasCritical = issues.some(i => i.severity === 'critical');
    const valid = !hasCritical;

    if (issues.length > 0) {
      log.info('Validation completed', {
        messageLength: message.length,
        issueCount: issues.length,
        riskScore,
        valid,
        issueTypes: issues.map(i => `${i.type}:${i.severity}`),
      });
    }

    return {
      valid,
      issues,
      sanitizedMessage: sanitizedMessage !== message ? sanitizedMessage : undefined,
      riskScore,
    };
  }

  /**
   * Synchronous quick check (no profanity, no async work).
   * Suitable for high-throughput pre-LLM filtering where latency matters.
   */
  validateQuick(message: string, maxLength = 400_000): ValidationResult {
    const issues: ValidationIssue[] = [];
    let riskScore = 0;

    if (!message || typeof message !== 'string') {
      return {
        valid: false,
        issues: [{
          type: 'structure',
          severity: 'critical',
          message: 'Invalid message',
        }],
        riskScore: 100,
      };
    }

    if (message.length > maxLength) {
      issues.push({
        type: 'length',
        severity: 'medium',
        message: 'Message too long',
      });
      riskScore += 20;
    }

    // Critical injection patterns only (sync fast-path)
    for (const { pattern, severity, desc } of INJECTION_PATTERNS) {
      if (severity === 'critical' && pattern.test(message)) {
        issues.push({ type: 'injection', severity, message: desc });
        riskScore += 50;
      }
    }

    return {
      valid: riskScore < 50,
      issues,
      riskScore: Math.min(riskScore, 100),
    };
  }

  // ---- private helpers ----

  private detectInjection(message: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const { pattern, severity, desc } of INJECTION_PATTERNS) {
      if (pattern.test(message)) {
        log.warn('Injection pattern detected', { desc, pattern: pattern.source });
        issues.push({
          type: 'injection',
          severity,
          message: desc,
          details: 'Content blocked by security filter',
        });
      }
    }
    return issues;
  }

  private detectAbuse(message: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const { pattern, severity, desc } of ABUSE_PATTERNS) {
      if (pattern.test(message)) {
        issues.push({ type: 'abuse', severity, message: desc });
      }
    }
    return issues;
  }

  /**
   * Best-effort profanity check.  Loads `bad-words` lazily — if the
   * package is not installed the call returns `{ flagged: false }`
   * without throwing so callers can keep working.
   */
  private async checkProfanity(
    message: string,
  ): Promise<{ flagged: boolean; cleaned?: string }> {
    try {
      // `bad-words` is optional. If it's not installed, the dynamic
      // import throws and we silently skip the check.
      const mod = await import('bad-words' as string).catch(() => null);
      if (!mod) return { flagged: false };

      const Filter = (mod as { Filter: new () => {
        isProfane: (s: string) => boolean;
        clean: (s: string) => string;
      } }).Filter;

      const filter = new Filter();
      if (filter.isProfane(message)) {
        return { flagged: true, cleaned: filter.clean(message) };
      }
      return { flagged: false };
    } catch (err) {
      log.warn('Profanity filter unavailable', { error: (err as Error).message });
      return { flagged: false };
    }
  }
}

// Singleton export + named class export
export const inputValidator = InputValidationService.getInstance();
export { InputValidationService };
