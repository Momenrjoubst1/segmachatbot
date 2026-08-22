import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { supabase } from "../../../services/rag/rag-supabase-client.js";
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('calendar-insights');

createToolMetadata("get_calendar_insights", "Analyze the user's calendar and return insights", {
  requiresUserId: true,
  category: "productivity",
  enabledByDefault: true,
});

// ============================================
// Tool: get_calendar_insights
// ============================================
registerTool("get_calendar_insights", {
  description: "Get AI-powered insights and analysis of the user's calendar. Returns summaries, patterns, and suggestions based on the user's schedule.",
  inputSchema: z.object({
    period: z.enum(["today", "tomorrow", "this_week", "this_month"]).optional().describe("Time period for analysis"),
    include_conflicts: z.boolean().optional().describe("Check for scheduling conflicts (default: true)"),
    include_suggestions: z.boolean().optional().describe("Generate smart suggestions (default: true)"),
  }),
  execute: async (args: {
    period?: "today" | "tomorrow" | "this_week" | "this_month";
    include_conflicts?: boolean;
    include_suggestions?: boolean;
    __userId?: string;
  }) => {
    try {
      const userId = args.__userId;
      if (!userId) {
        return JSON.stringify({ status: "error", message: "User not authenticated" });
      }

      const checkConflicts = args.include_conflicts !== false;
      const includeSuggestions = args.include_suggestions !== false;

      // Calculate date range
      const now = new Date();
      let startDate = new Date();
      let endDate = new Date();

      switch (args.period) {
        case "today":
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
          break;
        case "tomorrow":
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
          break;
        case "this_week":
          const dayOfWeek = now.getDay();
          startDate = new Date(now);
          startDate.setDate(now.getDate() - dayOfWeek);
          startDate.setHours(0, 0, 0, 0);
          endDate = new Date(startDate);
          endDate.setDate(startDate.getDate() + 7);
          break;
        case "this_month":
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
          break;
        default:
          // Default: today
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      }

      // Fetch events
      const { data: events, error } = await supabase
        .from("user_calendar_events")
        .select(`
          *,
          user_calendar_attendees(id, email, name, status)
        `)
        .eq("user_id", userId)
        .gte("start_time", startDate.toISOString())
        .lte("start_time", endDate.toISOString())
        .order("start_time", { ascending: true });

      if (error) {
        log.error("[Calendar] Insights query error:", error);
        return JSON.stringify({ status: "error", message: "Failed to fetch events" });
      }

      interface CalendarEvent { start_time: string; end_time: string; [key: string]: unknown; }
      const calendarEvents: CalendarEvent[] = (events || []) as CalendarEvent[];

      // Generate insights
      const insights: Record<string, unknown> = {
        period: args.period || "today",
        event_count: calendarEvents.length,
      };

      if (calendarEvents.length > 0) {
        // Time distribution
        const morningEvents = calendarEvents.filter((e: CalendarEvent) => {
          const hour = new Date(e.start_time).getHours();
          return hour >= 6 && hour < 12;
        }).length;
        const afternoonEvents = calendarEvents.filter((e: CalendarEvent) => {
          const hour = new Date(e.start_time).getHours();
          return hour >= 12 && hour < 18;
        }).length;
        const eveningEvents = calendarEvents.filter((e: CalendarEvent) => {
          const hour = new Date(e.start_time).getHours();
          return hour >= 18 || hour < 6;
        }).length;

        insights.time_distribution = {
          morning: morningEvents,
          afternoon: afternoonEvents,
          evening: eveningEvents,
        };

        // Total hours
        const totalMinutes = calendarEvents.reduce((sum: number, event: CalendarEvent) => {
          const start = new Date(event.start_time);
          const end = new Date(event.end_time);
          return sum + (end.getTime() - start.getTime()) / (60 * 1000);
        }, 0);
        insights.total_hours = Math.round(totalMinutes / 60 * 10) / 10;

        // Average event duration
        insights.avg_event_duration_minutes = Math.round(totalMinutes / calendarEvents.length);

        // Busiest day (if week/month)
        if (args.period === "this_week" || args.period === "this_month") {
          const dayCounts: Record<string, number> = {};
          calendarEvents.forEach((event: CalendarEvent) => {
            const day = new Date(event.start_time).toLocaleDateString("en-US", { weekday: "long" });
            dayCounts[day] = (dayCounts[day] || 0) + 1;
          });
          const busiestDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];
          insights.busiest_day = busiestDay ? busiestDay[0] : null;
          insights.busiest_day_count = busiestDay ? busiestDay[1] : 0;
        }

        // Meeting vs focus time
        const meetingKeywords = ["meeting", "call", "conference", "sync", "standup", "review"];
        const meetingsCount = calendarEvents.filter((e: CalendarEvent) =>
          meetingKeywords.some((k: string) => (e.title as string).toLowerCase().includes(k))
        ).length;
        insights.meetings_count = meetingsCount;
        insights.focus_time_count = calendarEvents.length - meetingsCount;

        // Events with attendees (collaborative)
        const collaborativeEvents = calendarEvents.filter((e: CalendarEvent) =>
          e.user_calendar_attendees && (e.user_calendar_attendees as unknown[]).length > 0
        ).length;
        insights.collaborative_events = collaborativeEvents;

        // Early morning (before 9am)
        const earlyMorningEvents = calendarEvents.filter((e: CalendarEvent) => {
          const hour = new Date(e.start_time).getHours();
          return hour < 9;
        }).length;
        insights.early_morning_events = earlyMorningEvents;

        // Late evening (after 6pm)
        const lateEveningEvents = calendarEvents.filter((e: CalendarEvent) => {
          const hour = new Date(e.start_time).getHours();
          return hour >= 18;
        }).length;
        insights.late_evening_events = lateEveningEvents;

        // Today's highlights
        if (args.period === "today") {
          const nextEvent = calendarEvents.find((e: CalendarEvent) => new Date(e.start_time) > now);
          const firstEvent = calendarEvents[0];
          
          insights.today = {
            first_event: firstEvent ? {
              title: firstEvent.title,
              time: new Date(firstEvent.start_time).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
              }),
            } : null,
            next_event: nextEvent ? {
              title: nextEvent.title,
              time: new Date(nextEvent.start_time).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
              }),
              minutes_until: Math.round((new Date(nextEvent.start_time).getTime() - now.getTime()) / (60 * 1000)),
            } : null,
            current_time: now.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            }),
          };
        }
      } else {
        insights.free_day = true;
        insights.message = "No events scheduled for this period.";
      }

      // Check for conflicts
      if (checkConflicts && events && events.length > 1) {
        const conflicts: Array<{ event1: { id: string; title: string }; event2: { id: string; title: string }; overlap_minutes: number }> = [];
        
        for (let i = 0; i < events.length; i++) {
          for (let j = i + 1; j < events.length; j++) {
            const event1 = events[i];
            const event2 = events[j];
            
            const start1 = new Date(event1.start_time);
            const end1 = new Date(event1.end_time);
            const start2 = new Date(event2.start_time);
            const end2 = new Date(event2.end_time);
            
            if (start1 < end2 && start2 < end1) {
              conflicts.push({
                event1: { id: event1.id, title: event1.title },
                event2: { id: event2.id, title: event2.title },
                overlap_minutes: Math.round(
                  Math.min(end1.getTime(), end2.getTime()) - Math.max(start1.getTime(), start2.getTime())
                ) / (60 * 1000),
              });
            }
          }
        }
        
        insights.conflicts = conflicts;
        insights.has_conflicts = conflicts.length > 0;
      }

      // Generate suggestions
      if (includeSuggestions) {
        const suggestions: string[] = [];

        if (calendarEvents.length > 0) {
          // Suggest buffer time if many meetings back-to-back
          const backToBack = calendarEvents.filter((e: CalendarEvent, i: number) => {
            if (i === 0) return false;
            const prevEnd = new Date((calendarEvents[i - 1] as CalendarEvent).end_time);
            const currStart = new Date(e.start_time);
            return (currStart.getTime() - prevEnd.getTime()) < 10 * 60 * 1000; // less than 10 min gap
          }).length;
          
          if (backToBack >= 3) {
            suggestions.push("You have several back-to-back meetings. Consider adding 5-minute buffers between them.");
          }

          // Suggest focusing on high-priority if many meetings
          if (calendarEvents.length > 5) {
            suggestions.push("You have a busy schedule. Block some focused work time between meetings.");
          }

          // Early morning warning
          if ((insights.early_morning_events as number) >= 2) {
            suggestions.push("You have multiple early morning events. Make sure to get adequate rest.");
          }

          // Late evening warning
          if ((insights.late_evening_events as number) >= 2) {
            suggestions.push("You have late evening commitments. Plan your day to finish earlier.");
          }

          // Free day opportunity
          if (events.length < 2 && (args.period === "this_week" || args.period === "this_month")) {
            suggestions.push("You have relatively open days this week. Great time for deep work or planning.");
          }
        }

        insights.suggestions = suggestions;
      }

      return JSON.stringify({
        status: "success",
        insights,
      });
    } catch (err: unknown) {
      log.error("[Calendar] get_calendar_insights error:", err instanceof Error ? err : new Error(String(err)));
      return JSON.stringify({
        status: "error",
        message: "Failed to generate calendar insights",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});