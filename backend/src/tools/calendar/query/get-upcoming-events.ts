import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { getGoogleCalendarAccessToken } from "../../shared/ics-and-google-auth.js";
import { supabase } from "../../../services/rag/rag-supabase-client.js";
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('calendar-events');

createToolMetadata("get_upcoming_events", "Fetch the user's upcoming calendar events", {
  requiresUserId: true,
  category: "productivity",
  enabledByDefault: true,
});

// ============================================
// Helper: Get events from Google Calendar
// ============================================
async function fetchGoogleCalendarEvents(accessToken: string, calendarId: string, timeMin: string, timeMax: string) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
    new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "100",
    });

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Google Calendar API error: ${response.statusText}`);
  }

  interface GoogleCalendarEvent {
    id?: string;
    summary?: string;
    description?: string;
    location?: string;
    htmlLink?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
    [key: string]: unknown;
  }
  const data = await response.json() as { items?: GoogleCalendarEvent[] };
  return data.items || [];
}

// ============================================
// Helper: Parse event dates
// ============================================
function parseEventDate(event: { start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }): { start: string; end: string } {
  const start = event.start?.dateTime || event.start?.date || new Date().toISOString();
  const end = event.end?.dateTime || event.end?.date || new Date().toISOString();
  return { start, end };
}

// ============================================
// Tool: get_upcoming_events
// ============================================
registerTool("get_upcoming_events", {
  description: "Get upcoming calendar events. Returns events from today onwards. Use this to check your schedule or answer questions about meetings. Supports fetching from Google Calendar or local database.",
  inputSchema: z.object({
    period: z.enum(["today", "tomorrow", "this_week", "next_week", "this_month"]).optional().describe("Time period to query"),
    days: z.number().optional().describe("Custom number of days (overrides period)"),
    include_all_day: z.boolean().optional().describe("Include all-day events (default: true)"),
    max_results: z.number().optional().describe("Maximum number of events to return (default: 20)"),
  }),
  execute: async (args: {
    period?: "today" | "tomorrow" | "this_week" | "next_week" | "this_month";
    days?: number;
    include_all_day?: boolean;
    max_results?: number;
    __userId?: string;
  }) => {
    try {
      const userId = args.__userId;
      if (!userId) {
        return JSON.stringify({ status: "error", message: "User not authenticated" });
      }

      const maxResults = args.max_results || 20;
      const includeAllDay = args.include_all_day !== false;

      // Calculate date range
      const now = new Date();
      let timeMin = new Date();
      let timeMax = new Date();

      if (args.days) {
        timeMin = now;
        timeMax = new Date(now.getTime() + args.days * 24 * 60 * 60 * 1000);
      } else {
        switch (args.period) {
          case "today":
            timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            break;
          case "tomorrow":
            timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
            break;
          case "this_week":
            const dayOfWeek = now.getDay();
            timeMin = new Date(now);
            timeMin.setDate(now.getDate() - dayOfWeek);
            timeMin.setHours(0, 0, 0, 0);
            timeMax = new Date(timeMin);
            timeMax.setDate(timeMin.getDate() + 7);
            break;
          case "next_week":
            const dayOfWeek2 = now.getDay();
            const daysUntilNextWeek = 7 - dayOfWeek2;
            const nextWeekStart = new Date(now);
            nextWeekStart.setDate(now.getDate() + daysUntilNextWeek);
            timeMin = new Date(nextWeekStart);
            timeMax = new Date(nextWeekStart);
            timeMax.setDate(nextWeekStart.getDate() + 7);
            break;
          case "this_month":
            timeMin = new Date(now.getFullYear(), now.getMonth(), 1);
            timeMax = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
            break;
          default:
            // Default: next 7 days
            timeMin = now;
            timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        }
      }

      const timeMinISO = timeMin.toISOString();
      const timeMaxISO = timeMax.toISOString();

      // Try Google Calendar first
  interface GoogleCalendarEvent {
    id?: string;
    summary?: string;
    description?: string;
    location?: string;
    htmlLink?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
    [key: string]: unknown;
  }

  let googleEvents: GoogleCalendarEvent[] = [];
  let useGoogle = false;

      try {
        // Get user's calendar settings
        const { data: settings } = await supabase
          .from("user_calendar_settings")
          .select("google_calendar_id, google_refresh_token")
          .eq("user_id", userId)
          .single();

        if (settings?.google_calendar_id) {
          const accessToken = await getGoogleCalendarAccessToken();
          if (accessToken) {
            googleEvents = await fetchGoogleCalendarEvents(
              accessToken,
              settings.google_calendar_id,
              timeMinISO,
              timeMaxISO
            );
            useGoogle = true;
          }
        }
      } catch (googleError) {
        log.warn("[Calendar] Google Calendar fetch failed, falling back to local:", googleError instanceof Error ? googleError : new Error(String(googleError)));
      }

      // Fetch from local database
      let query = supabase
        .from("user_calendar_events")
        .select(`
          *,
          user_calendar_attendees(id, email, name, status)
        `)
        .eq("user_id", userId)
        .gte("start_time", timeMinISO)
        .lte("start_time", timeMaxISO)
        .order("start_time", { ascending: true })
        .limit(maxResults);

      const { data: localEvents, error } = await query;

      if (error) {
        log.error("[Calendar] Local DB query error:", error);
      }

      // Combine and format events
      const allEvents: Array<{ id?: string; title: string; start_time: string; end_time: string; description?: string; location?: string; is_all_day?: boolean; provider?: string; external_link?: string; color?: string; attendees?: unknown[] }> = [];

      if (useGoogle && googleEvents.length > 0) {
        for (const event of googleEvents) {
          const { start, end } = parseEventDate(event);
          const isAllDay = !event.start?.dateTime;
          
          if (!includeAllDay && isAllDay) continue;

          allEvents.push({
            id: event.id,
            title: event.summary || "Untitled Event",
            description: event.description || "",
            location: event.location || "",
            start_time: start,
            end_time: end,
            is_all_day: isAllDay,
            provider: "google",
            external_link: event.htmlLink || "",
            attendees: (event.attendees || []).map((a) => ({
              email: a.email,
              name: a.displayName || a.email,
              status: a.responseStatus || "pending",
            })),
          });
        }
      }

      if (localEvents && localEvents.length > 0) {
        for (const event of localEvents) {
          if (!includeAllDay && event.is_all_day) continue;
          
          // Skip if already added from Google (by external_id match)
          if (event.external_id && useGoogle) {
            const exists = allEvents.some(e => e.id === event.external_id);
            if (exists) continue;
          }

          allEvents.push({
            id: event.id,
            title: event.title,
            description: event.description || "",
            location: event.location || "",
            start_time: event.start_time,
            end_time: event.end_time,
            is_all_day: event.is_all_day || false,
            provider: event.provider || "local",
            external_link: event.external_link || "",
            color: event.color || "#3B82F6",
            attendees: event.user_calendar_attendees || [],
          });
        }
      }

      // Sort by start time
      allEvents.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

      // Limit results
      const limitedEvents = allEvents.slice(0, maxResults);

      // Generate summary
      const todayCount = allEvents.filter(e => {
        const start = new Date(e.start_time);
        return start.toDateString() === now.toDateString();
      }).length;

      const summary = {
        total: limitedEvents.length,
        today: todayCount,
        period: args.period || (args.days ? `${args.days} days` : "7 days"),
        has_more: allEvents.length > maxResults,
      };

      return JSON.stringify({
        status: "success",
        events: limitedEvents,
        summary,
      });
    } catch (err: unknown) {
      log.error("[Calendar] get_upcoming_events error:", err instanceof Error ? err : new Error(String(err)));
      return JSON.stringify({
        status: "error",
        message: "Failed to fetch calendar events",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});