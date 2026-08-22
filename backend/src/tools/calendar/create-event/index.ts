import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { getGoogleCalendarAccessToken } from "../../shared/ics-and-google-auth.js";
import { supabase } from "../../../services/rag/rag-supabase-client.js";
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('calendar-create');

createToolMetadata("create_calendar_event", "Create a calendar event/appointment for the user", {
  requiresUserId: true,
  category: "productivity",
  enabledByDefault: true,
});

registerTool("create_calendar_event", {
  description: "Create a calendar event on the user's calendar. Executes immediately — no confirmation needed.",
  inputSchema: z.object({
    title: z.string().describe("Event title"),
    start: z.string().describe("Start time (ISO date string)"),
    end: z.string().describe("End time (ISO date string)"),
    timezone: z.string().optional().describe("Timezone (optional)"),
    description: z.string().optional().describe("Event description (optional)"),
    location: z.string().optional().describe("Location (optional)"),
    attendees: z.array(z.string()).optional().describe("Attendee emails (optional)"),
    is_all_day: z.boolean().optional().describe("All-day event (default: false)"),
    color: z.string().optional().describe("Event color hex code (default #3B82F6)"),
  }),
  execute: async (args: { title: string; start: string; end: string; timezone?: string; description?: string; location?: string; attendees?: string[]; is_all_day?: boolean; color?: string; __userId?: string }) => {
    const { title, start, end, timezone, description, location, attendees, is_all_day, color, __userId: userId } = args;
    try {
      if (!userId) {
        return JSON.stringify({ status: "error", message: "User not authenticated" });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return JSON.stringify({ status: "error", message: "Invalid start or end date. Use ISO date strings." });
      }
      if (endDate <= startDate) {
        return JSON.stringify({ status: "error", message: "End time must be after start time." });
      }

      // 1. Local database is the source of truth — always save here first.
      const { data: localEvent, error: localError } = await supabase
        .from("user_calendar_events")
        .insert({
          user_id: userId,
          title,
          description: description || null,
          location: location || null,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          is_all_day: is_all_day || false,
          color: color || "#3B82F6",
          provider: "local",
        })
        .select()
        .single();

      if (localError || !localEvent) {
        log.error("[Calendar] Supabase insert error:", localError);
        return JSON.stringify({
          status: "error",
          message: "Failed to save the event to your calendar",
          error: localError?.message ?? "unknown database error",
        });
      }

      // Attendees are stored locally alongside the event.
      if (attendees?.length) {
        await supabase.from("user_calendar_attendees").insert(
          attendees.map((email) => ({ event_id: localEvent.id, email, status: "pending" }))
        );
      }

      // 2. Best-effort Google Calendar sync (non-fatal).
      let googleSynced = false;
      try {
        const settingsQuery = await supabase
          .from("user_calendar_settings")
          .select("google_calendar_id")
          .eq("user_id", userId)
          .single();

        let accessToken = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
        if (!accessToken && process.env.GOOGLE_CALENDAR_CLIENT_EMAIL && process.env.GOOGLE_CALENDAR_PRIVATE_KEY) {
          accessToken = await getGoogleCalendarAccessToken();
        }
        const calendarId = settingsQuery.data?.google_calendar_id || process.env.GOOGLE_CALENDAR_ID;

        if (accessToken && calendarId) {
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
              body: JSON.stringify({
                summary: title,
                description: description || undefined,
                location: location || undefined,
                start: { dateTime: startDate.toISOString(), timeZone: timezone || undefined },
                end: { dateTime: endDate.toISOString(), timeZone: timezone || undefined },
                ...(attendees?.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
              }),
            }
          );

          if (res.ok) {
            const data = (await res.json()) as { id?: string; htmlLink?: string };
            // Link the local row to its Google counterpart so future
            // update/delete operations stay in sync.
            await supabase
              .from("user_calendar_events")
              .update({ external_id: data.id ?? null, external_link: data.htmlLink ?? null })
              .eq("id", localEvent.id);
            googleSynced = true;
          } else {
            log.warn("[Calendar] Google sync failed:", { status: res.status, body: await res.text() });
          }
        }
      } catch (syncErr: unknown) {
        log.warn("[Calendar] Google sync error (event saved locally):", syncErr instanceof Error ? syncErr.message : String(syncErr));
      }

      return JSON.stringify({
        status: "success",
        eventId: localEvent.id,
        title: localEvent.title,
        start_time: localEvent.start_time,
        end_time: localEvent.end_time,
        google_synced: googleSynced,
        message: `Event "${title}" added to your calendar!`,
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "Failed to create event", error: err instanceof Error ? err.message : String(err) });
    }
  },
});
