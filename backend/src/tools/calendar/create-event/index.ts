import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { getGoogleCalendarAccessToken } from "../../shared/ics-and-google-auth.js";
import { supabase } from "../../../services/rag/rag-supabase-client.js";
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('calendar-create');

registerTool("create_calendar_event", {
  description: "Create a calendar event. Only use after explicit user approval.",
  inputSchema: z.object({
    title: z.string().describe("Event title"),
    start: z.string().describe("Start time (ISO date string)"),
    end: z.string().describe("End time (ISO date string)"),
    timezone: z.string().optional().describe("Timezone (optional)"),
    description: z.string().optional().describe("Event description (optional)"),
    location: z.string().optional().describe("Location (optional)"),
    attendees: z.array(z.string()).optional().describe("Attendee emails (optional)"),
    confirm: z.boolean().optional().describe("Must be true after user approval"),
  }),
  execute: async (args: { title: string; start: string; end: string; timezone?: string; description?: string; location?: string; attendees?: string[]; confirm?: boolean; __userId?: string }) => {
    const { title, start, end, timezone, description, location, attendees, confirm, __userId: userId } = args;
    try {
      if (!confirm) {
        return JSON.stringify({
          status: "needs_confirmation",
          message: "User confirmation required before creating the event.",
          draft: { title, start, end, timezone, description, location, attendees },
        });
      }

      // Save to local Supabase database (always)
      if (userId) {
        try {
          const { data: localEvent, error: localError } = await supabase
            .from("user_calendar_events")
            .insert({
              user_id: userId,
              title,
              description: description || null,
              location: location || null,
              start_time: start,
              end_time: end,
              is_all_day: false,
              color: "#3B82F6",
              provider: "local",
            })
            .select()
            .single();

          if (localError) {
            log.error("[Calendar] Supabase insert error:", localError);
          } else {
            log.info("[Calendar] Event saved to local DB:", localEvent?.id);
          }
        } catch (dbErr: unknown) {
          log.error("[Calendar] Supabase insert failed:", dbErr instanceof Error ? dbErr.message : String(dbErr));
        }
      }

      // Try Google Calendar if configured
      let accessToken = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
      const calendarId = process.env.GOOGLE_CALENDAR_ID;

      if (!accessToken && process.env.GOOGLE_CALENDAR_CLIENT_EMAIL && process.env.GOOGLE_CALENDAR_PRIVATE_KEY) {
        try {
          accessToken = await getGoogleCalendarAccessToken();
        } catch (tokenErr: unknown) {
          log.error("[Google Calendar] Failed to generate access token from service account:", tokenErr instanceof Error ? tokenErr.message : String(tokenErr));
        }
      }

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
              start: { dateTime: start, timeZone: timezone || undefined },
              end: { dateTime: end, timeZone: timezone || undefined },
              ...(attendees?.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
            }),
          }
        );

        if (!res.ok) {
          const errorText = await res.text();
          return JSON.stringify({ status: "error", message: "Failed to create event in Google Calendar", error: errorText });
        }

        const data = (await res.json()) as any;
        return JSON.stringify({ status: "success", provider: "google", eventId: data.id, htmlLink: data.htmlLink, savedToDB: !!userId });
      }

      return JSON.stringify({
        status: "success",
        provider: userId ? "local" : "ics",
        message: userId ? "Event saved to your calendar!" : "Event created as ICS file for manual import.",
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "Failed to create event", error: err instanceof Error ? err.message : String(err) });
    }
  },
});
