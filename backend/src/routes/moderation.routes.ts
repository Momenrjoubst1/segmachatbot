// Moderation API routes: quick/full content checks, decision logging, health.

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import { asyncHandler } from '../utils/express-async-wrapper.js';
import { inputValidator, moderationCheckSchema } from '../services/security/input-validator.js';
import { moderateFull } from '../services/chat/moderation.service.js';
import { supabase } from '../services/supabase.service.js';
import { isAdminUser } from '../utils/admin-role-check.js';

const log = createLogger('moderation-api');

const router = Router();

// Zod schemas for request bodies.

/** Body for POST /api/moderation/log */
const logDecisionSchema = z.object({
  content: z.string().min(1).max(50_000),
  action: z.enum(['allow', 'censor', 'block']),
  flaggedParts: z.array(z.string()).optional(),
  riskScore: z.number().min(0).max(100).optional(),
  reason: z.string().max(500).optional(),
  threadId: z.string().uuid().optional(),
});

export type LogDecisionInput = z.infer<typeof logDecisionSchema>;

// Route handlers.

// POST /api/moderation/check — quick in-process injection/abuse validation.
router.post(
  '/check',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = moderationCheckSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      });
      return;
    }

    const { content, maxMessageLength, enableInjectionDetection, enableModeration } = parsed.data;
    const result = await inputValidator.validate(content, {
      maxMessageLength,
      enableInjectionDetection,
      enableModeration,
    });

    log.debug('Moderation check', {
      userId: req.user?.id,
      valid: result.valid,
      riskScore: result.riskScore,
      issueCount: result.issues.length,
    });

    res.json({
      success: true,
      data: result,
    });
  }),
);

// POST /api/moderation/full — local injection detection plus Supabase moderator.
router.post(
  '/full',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = moderationCheckSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      });
      return;
    }

    const { content } = parsed.data;
    const result = await moderateFull(content);

    log.info('Full moderation completed', {
      userId: req.user?.id,
      action: result.action,
      riskScore: result.riskScore,
      blocked: result.blocked,
    });

    res.json({
      success: true,
      data: result,
    });
  }),
);

// POST /api/moderation/log — persist a moderation decision for analytics.
router.post(
  '/log',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = logDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      });
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const decision = parsed.data;
    const { error } = await supabase.from('analytics_events').insert({
      user_id: userId,
      event_type: 'moderation_decision',
      metadata: {
        action: decision.action,
        flaggedParts: decision.flaggedParts ?? [],
        riskScore: decision.riskScore ?? 0,
        reason: decision.reason ?? null,
        threadId: decision.threadId ?? null,
        contentLength: decision.content.length,
        timestamp: new Date().toISOString(),
      },
    });

    if (error) {
      log.warn('Failed to log moderation decision', { error: error.message });
      res.status(500).json({ success: false, error: 'Failed to log decision' });
      return;
    }

    res.json({ success: true });
  }),
);

// GET /api/moderation/health — liveness probe; detailed check is admin-only.
router.get(
  '/health',
  asyncHandler(async (req: Request, res: Response) => {
    const base = {
      inputValidator: true,
      supabaseModerator: 'unknown' as 'ok' | 'unavailable' | 'unknown',
    };

    if (isAdminUser(req.user?.id)) {
      try {
        const { data, error } = await supabase.functions.invoke(
          'check-content-moderation',
          { body: { content: '__health_probe__' } },
        );
        base.supabaseModerator = error ? 'unavailable' : (data ? 'ok' : 'unknown');
      } catch (healthErr) {
        log.warn('Health probe failed', { error: (healthErr as Error)?.message });
        base.supabaseModerator = 'unavailable';
      }
    }

    res.json({ success: true, data: base });
  }),
);

export default router;
