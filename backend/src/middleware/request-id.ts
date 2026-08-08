import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';
import { setTraceContext, clearTraceContext } from '../utils/logger.js';

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
  setTraceContext({ requestId });

  res.on('finish', () => {
    clearTraceContext();
  });

  next();
}
