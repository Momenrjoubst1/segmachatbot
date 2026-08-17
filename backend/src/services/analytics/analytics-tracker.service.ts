import type { SupabaseClient } from "@supabase/supabase-js";

interface AnalyticsEvent {
  id: string;
  event_type: string;
  user_id: string;
  thread_id?: string;
  tokens_used?: number;
  response_time_ms?: number;
  created_at: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface DailyMetric {
  date: string;
  total_conversations: number;
  total_messages: number;
  total_tokens_used: number;
  avg_response_time_ms: number;
  feedback_avg_score: number;
  estimated_cost_usd: number;
  active_users: number;
  top_models: Array<{ model: string; count: number }>;
  [key: string]: unknown;
}

interface TrackOptions {
  event_type: string;
  user_id: string;
  metadata?: Record<string, unknown>;
  thread_id?: string;
  tokens_used?: number;
  response_time_ms?: number;
  [key: string]: unknown;
}

export class AnalyticsTracker {
  constructor(private supabase: SupabaseClient) {}

  async getUserEvents(userId: string, limit: number): Promise<AnalyticsEvent[]> {
    const { data, error } = await this.supabase
      .from("analytics_events")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []) as AnalyticsEvent[];
  }

  async getDailyMetrics(startDate: Date, endDate: Date): Promise<DailyMetric[]> {
    const { data, error } = await this.supabase
      .from("analytics_daily_metrics")
      .select("*")
      .gte("date", startDate.toISOString().split("T")[0])
      .lte("date", endDate.toISOString().split("T")[0])
      .order("date", { ascending: true });

    if (error) throw error;
    return (data || []) as DailyMetric[];
  }

  async getUserDailyMetrics(userId: string, startDate: Date, endDate: Date): Promise<DailyMetric[]> {
    // For user-scoped metrics, we'll aggregate from individual events
    // since analytics_daily_metrics doesn't have user_id column
    const { data, error } = await this.supabase
      .from("analytics_events")
      .select("*")
      .eq("user_id", userId)
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDate.toISOString())
      .order("created_at", { ascending: true });

    if (error) throw error;
    const events = (data || []) as AnalyticsEvent[];

    // Group by date and calculate metrics
    const dailyMap = new Map<string, DailyMetric>();
    
    for (const event of events) {
      const date = event.created_at.split("T")[0];
      if (!dailyMap.has(date)) {
        dailyMap.set(date, {
          date,
          total_conversations: 0,
          total_messages: 0,
          total_tokens_used: 0,
          avg_response_time_ms: 0,
          feedback_avg_score: 0,
          estimated_cost_usd: 0,
          active_users: 1,
          top_models: [],
        });
      }
      
      const metric = dailyMap.get(date)!;
      metric.total_messages += 1;
      
      if (event.event_type === "conversation_created") {
        metric.total_conversations += 1;
      }
      
      if (event.tokens_used) {
        metric.total_tokens_used += event.tokens_used;
      }
      
      if (event.response_time_ms) {
        metric.avg_response_time_ms = 
          (metric.avg_response_time_ms * (metric.total_messages - 1) + event.response_time_ms) / metric.total_messages;
      }
      
      if (event.event_type === "feedback" && event.metadata?.score) {
        const feedbackCount = metric.feedback_avg_score === 0 ? 0 : 1;
        metric.feedback_avg_score = 
          (metric.feedback_avg_score * feedbackCount + (event.metadata.score as number)) / (feedbackCount + 1);
      }
      
      // Estimate cost (very rough approximation)
      if (event.tokens_used) {
        metric.estimated_cost_usd += event.tokens_used * 0.00002; // $0.02 per 1K tokens
      }
    }
    
    return Array.from(dailyMap.values());
  }

  async track(options: TrackOptions): Promise<void> {
    const { error } = await this.supabase.from("analytics_events").insert({
      event_type: options.event_type,
      user_id: options.user_id,
      thread_id: options.thread_id,
      tokens_used: options.tokens_used,
      response_time_ms: options.response_time_ms,
      metadata: options.metadata || {},
    });

    if (error) throw error;
  }

  async trackFeedback(
    userId: string,
    messageId: string,
    score: number,
    threadId?: string
  ): Promise<void> {
    const { error } = await this.supabase.from("analytics_events").insert({
      event_type: "feedback",
      user_id: userId,
      thread_id: threadId,
      metadata: { message_id: messageId, score },
    });

    if (error) throw error;
  }
}
