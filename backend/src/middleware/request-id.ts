import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';
import { runWithTraceContext } from '../utils/logger.js';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const raw = req.headers['x-request-id'] as string | undefined;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let requestId: string;

  if (raw && uuidRegex.test(raw) && raw.length <= 128) {
    requestId = raw;
  } else {
    requestId = uuidv4();
  }

  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);

  // Scope the trace context to this request's call chain: every log emitted
  // while handling it carries the requestId, and concurrent requests stay
  // isolated (the previous enterWith/disable approach corrupted them).
  runWithTraceContext({ requestId }, () => next());
}
