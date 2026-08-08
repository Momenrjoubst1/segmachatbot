import express from 'express';
import { supabase } from '../services/supabase.service.js';
import { asyncHandler } from '../utils/express-async-wrapper.js';
import { feedbackSchema } from '../validators/feedback-validation.js';

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { email, name, category, message, rating } = parsed.data;
  const { error } = await supabase.from('feedback').insert({
    user_id: userId,
    email: email ?? req.user?.email ?? null,
    name,
    category,
    message,
    rating,
  });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ success: true });
}));

export default router;
