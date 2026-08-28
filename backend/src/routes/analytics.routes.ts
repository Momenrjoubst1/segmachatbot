import { Router } from 'express';
import { supabase } from '../config/supabase.config.js';
import { AnalyticsTracker } from '../services/analytics/analytics-tracker.service.js';
import { requireAdmin } from '../utils/admin-role-check.js';
import { asyncHandler } from '../utils/express-async-wrapper.js';
import { trackEventSchema, feedbackScoreSchema } from '../validators/analytics-validation.js';
import { ValidationError, UnauthorizedError } from '../utils/error-handler.js';

const router = Router();

const tracker = new AnalyticsTracker(supabase);

// GET /api/analytics/user-dashboard — user-scoped analytics for the signed-in user.
router.get('/user-dashboard', asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { days = '7' } = req.query;
  const numDays = parseInt(days as string, 10);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - numDays);

  const recentEvents: Record<string, unknown>[] = await tracker.getUserEvents(userId, 20);

  interface DailyMetric {
    total_conversations: number;
    total_messages: number;
    avg_response_time_ms: number;
    total_tokens_used: number;
    feedback_avg_score: number;
    estimated_cost_usd: number;
    [key: string]: unknown;
  }
  const dailyMetrics: DailyMetric[] = await tracker.getUserDailyMetrics(userId, startDate, endDate);

  const totalConversations = dailyMetrics.reduce((sum: number, m: DailyMetric) => sum + m.total_conversations, 0);
  const totalMessages = dailyMetrics.reduce((sum: number, m: DailyMetric) => sum + m.total_messages, 0);
  const avgResponseTime = dailyMetrics.length > 0
    ? dailyMetrics.reduce((sum: number, m: DailyMetric) => sum + m.avg_response_time_ms, 0) / dailyMetrics.length
    : 0;
  const totalTokens = dailyMetrics.reduce((sum: number, m: DailyMetric) => sum + m.total_tokens_used, 0);
  const avgFeedbackScore = dailyMetrics.length > 0
    ? dailyMetrics.reduce((sum: number, m: DailyMetric) => sum + m.feedback_avg_score, 0) / dailyMetrics.length
    : 0;
  const totalCost = dailyMetrics.reduce((sum: number, m: DailyMetric) => sum + m.estimated_cost_usd, 0);

  const modelMap = new Map<string, number>();
  dailyMetrics.forEach((m: DailyMetric) => {
    const topModels = m.top_models as Array<{ model: string; count: number }>;
    topModels.forEach(({ model, count }: { model: string; count: number }) => {
      modelMap.set(model, (modelMap.get(model) || 0) + count);
    });
  });
  const topModels = Array.from(modelMap.entries())
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // RAG misses in the last 7 days (passive retrieval feedback)
  let ragMissesLast7Days = 0;
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { count } = await supabase
      .from('retrieval_feedback')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('user_satisfied', false)
      .gte('created_at', sevenDaysAgo.toISOString());
    ragMissesLast7Days = count ?? 0;
  } catch {
    // Silent — analytics enrichment must not break the dashboard
  }

  res.json({
    success: true,
    data: {
      scope: 'user',
      summary: {
        totalConversations,
        totalMessages,
        avgResponseTime: Math.round(avgResponseTime),
        totalTokens,
        avgFeedbackScore: Math.round(avgFeedbackScore * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        ragMissesLast7Days,
        dateRange: {
          start: startDate.toISOString().split('T')[0],
          end: endDate.toISOString().split('T')[0],
        },
      },
      dailyMetrics,
      topModels,
      recentEvents,
    },
  });
}));

// GET /api/analytics/dashboard — platform-wide metrics for admins.
router.get('/dashboard', requireAdmin, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { days = '7' } = req.query;
  const numDays = parseInt(days as string, 10);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - numDays);

  const recentEvents: Record<string, unknown>[] = await tracker.getUserEvents(userId, 20);

  interface DailyMetric {
    total_conversations: number;
    total_messages: number;
    avg_response_time_ms: number;
    total_tokens_used: number;
    feedback_avg_score: number;
    estimated_cost_usd: number;
    active_users?: number;
    top_models: Array<{ model: string; count: number }>;
    [key: string]: unknown;
  }
  const dailyMetrics: DailyMetric[] = await tracker.getDailyMetrics(startDate, endDate);

  const totalConversations = dailyMetrics.reduce((sum: number, m: DailyMetric) => sum + m.total_conversations, 0);
  const totalMessages = dailyMetrics.reduce((sum: number, m: DailyMetric) => sum + m.total_messages, 0);
  const avgResponseTime = dailyMetrics.length > 0
    ? dailyMetrics.reduce((sum: number, m: DailyMetric) => sum + m.avg_response_time_ms, 0) / dailyMetrics.length
    : 0;
  const totalTokens = dailyMetrics.reduce((sum: number, m: DailyMetric) => sum + m.total_tokens_used, 0);
  const avgFeedbackScore = dailyMetrics.length > 0
    ? dailyMetrics.reduce((sum: number, m: DailyMetric) => sum + m.feedback_avg_score, 0) / dailyMetrics.length
    : 0;
  const totalCost = dailyMetrics.reduce((sum: number, m: DailyMetric) => sum + m.estimated_cost_usd, 0);
  const activeUsers = dailyMetrics.reduce((sum: number, m: DailyMetric) => sum + (m.active_users || 0), 0);

  const modelMap = new Map<string, number>();
  dailyMetrics.forEach((m: DailyMetric) => {
    const topModels = m.top_models as Array<{ model: string; count: number }>;
    topModels.forEach(({ model, count }: { model: string; count: number }) => {
      modelMap.set(model, (modelMap.get(model) || 0) + count);
    });
  });
  const topModels = Array.from(modelMap.entries())
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  res.json({
    success: true,
    data: {
      scope: 'platform',
      summary: {
        totalConversations,
        totalMessages,
        activeUsers,
        avgResponseTime: Math.round(avgResponseTime),
        totalTokens,
        avgFeedbackScore: Math.round(avgFeedbackScore * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        dateRange: {
          start: startDate.toISOString().split('T')[0],
          end: endDate.toISOString().split('T')[0],
        },
      },
      dailyMetrics,
      topModels,
      recentEvents,
    },
  });
}));

router.get('/events', asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new UnauthorizedError();
  }
  const { limit = '100', event_type } = req.query;
  const numLimit = parseInt(limit as string, 10);

  let events: Record<string, unknown>[];
  if (event_type) {
    const { data, error } = await supabase
      .from('analytics_events')
      .select('*')
      .eq('user_id', userId)
      .eq('event_type', event_type as string)
      .order('created_at', { ascending: false })
      .limit(numLimit);

    if (error) throw error;
    events = data;
  } else {
    events = await tracker.getUserEvents(userId, numLimit);
  }

  res.json({
    success: true,
    data: { events },
  });
}));

router.post('/track', asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new UnauthorizedError();
  }

  const parsed = trackEventSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Invalid event data', { errors: parsed.error.flatten().fieldErrors });
  }

  const { event_type, metadata, ...rest } = parsed.data;

  await tracker.track({
    event_type,
    user_id: userId,
    metadata,
    ...rest,
  });

  res.json({
    success: true,
    message: 'Event tracked successfully',
  });
}));

router.post('/feedback', asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new UnauthorizedError();
  }

  const parsed = feedbackScoreSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Invalid feedback data', { errors: parsed.error.flatten().fieldErrors });
  }

  const { message_id, score, thread_id } = parsed.data;

  await tracker.trackFeedback(userId, message_id, score, thread_id);

  res.json({
    success: true,
    message: 'Feedback recorded successfully',
  });
}));

export default router;
