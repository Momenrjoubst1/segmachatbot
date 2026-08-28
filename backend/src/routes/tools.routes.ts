import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/express-async-wrapper.js';
import { executeCode } from '../tools/code/executor/wandbox-code-executor.js';
import { log } from '../utils/logger.js';

const router = express.Router();

// POST /api/tools/execute — run a code snippet in the Wandbox sandbox.

const MAX_CODE_LENGTH = 50_000;
const MAX_STDIN_LENGTH = 10_000;

const executeSchema = z.object({
  code: z.string().min(1).max(MAX_CODE_LENGTH),
  language: z.string().min(1).max(30),
  stdin: z.string().max(MAX_STDIN_LENGTH).optional(),
});

// Tight per-user limit: execution shells out to an external sandbox.
export const codeExecuteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Code execution rate limit reached. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const userId = req.user?.id;
    if (userId) return userId;
    return ipKeyGenerator(req.ip || req.socket.remoteAddress || 'unknown');
  },
});

router.post(
  '/execute',
  codeExecuteLimiter,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const parsed = executeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid payload',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { code, language, stdin } = parsed.data;

    try {
      const result = await executeCode(code, language, stdin ?? '', userId);
      res.json(result);
    } catch (err) {
      log.error('Code execution failed', {
        error: (err as Error).message,
        language,
      });
      res.status(500).json({
        status: 'error',
        error: 'Code execution failed. Please try again.',
        language,
      });
    }
  }),
);

export default router;
