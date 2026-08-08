import { Router } from 'express';
import { fetchImageForProxy } from '../utils/safe-fetch-url.js';
import { asyncHandler } from '../utils/express-async-wrapper.js';

const router = Router();

router.get('/image', asyncHandler(async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'URL parameter is required' });
    return;
  }

  const { buffer, contentType } = await fetchImageForProxy(url);

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(buffer);
}));

export default router;
