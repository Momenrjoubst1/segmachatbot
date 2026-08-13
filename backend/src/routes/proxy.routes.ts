import { Router } from 'express';
import { fetchImageForProxy } from '../utils/safe-fetch-url.js';
import { asyncHandler } from '../utils/express-async-wrapper.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/image', asyncHandler(async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'URL parameter is required' });
    return;
  }

  try {
    const { buffer, contentType } = await fetchImageForProxy(url);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.warn('[proxy] Image fetch failed', { url, error: msg });
    res.status(502).json({ error: 'Failed to fetch image', detail: msg });
  }
}));

export default router;
