import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { supabase } from "../../../services/rag/rag-supabase-client.js";
import { getGoogleCalendarAccessToken } from "../../shared/ics-and-google-auth.js";
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('calendar-delete');

createToolMetadata("delete_calendar_event", "Delete a calendar event for the user", {
  requiresUserId: true,
  category: "productivity",
  enabledByDefault: true,
});

createToolMetadata("update_calendar_event", "Update/reschedule a calendar event for the user", {
  requiresUserId: true,
  category: "productivity",
  enabledByDefault: true,
});

// ============================================
// Tool: delete_calendar_event
// ============================================
registerTool("delete_calendar_event", {
  description: "Delete a calendar event. Removes it from local storage and, if synced, from Google Calendar too. Requires event ID or event details for identification.",
  inputSchema: z.object({
    event_id: z.string().optional().describe("Local event ID (UUID)"),
    google_event_id: z.string().optional().describe("Google Calendar event ID"),
  }),
  execute: async (args: {
    event_id?: string;
    google_event_id?: string;
    __userId?: string;
  }) => {
    try {
      const userId = args.__userId;
      if (!userId) {
        return JSON.stringify({ status: "error", message: "User not authenticated" });
      }

      const results: { deleted: Array<Record<string, unknown>>; failed: Array<Record<string, unknown>> } = {
        deleted: [],
        failed: [],
      };

      // Delete from local database
      if (args.event_id) {
        // First verify ownership
        const { data: event } = await supabase
          .from("user_calendar_events")
          .select("id, title, provider, external_id")
          .eq("id", args.event_id)
          .eq("user_id", userId)
          .single();

        if (event) {
          // Delete attendees first
          await supabase
            .from("user_calendar_attendees")
            .delete()
            .eq("event_id", args.event_id);

          // Delete the event
          const { error } = await supabase
            .from("user_calendar_events")
            .delete()
            .eq("id", args.event_id)
            .eq("user_id", userId);

          if (error) {
            results.failed.push({
              type: "local",
              id: args.event_id,
              error: error.message,
            });
          } else {
            results.deleted.push({
              type: "local",
              id: args.event_id,
              title: event.title,
              provider: event.provider,
            });

            // If it was synced with Google, delete from Google too
            if (event.external_id && event.provider === "google") {
              try {
                const settingsQuery = await supabase
                  .from("user_calendar_settings")
                  .select("google_calendar_id")
                  .eq("user_id", userId)
                  .single();
                const settings = settingsQuery.data;

                if (settings?.google_calendar_id) {
                  const accessToken = await getGoogleCalendarAccessToken();
                  if (accessToken) {
                    const googleResponse = await fetch(
                      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(settings.google_calendar_id)}/events/${event.external_id}`,
                      {
                        method: "DELETE",
                        headers: { Authorization: `Bearer ${accessToken}` },
                      }
                    );

                    if (googleResponse.ok || googleResponse.status === 404) {
                      results.deleted.push({
                        type: "google",
                        id: event.external_id,
                        synced: true,
                      });
                    }
                  }
                }
              } catch (googleErr: unknown) {
                log.warn("[Calendar] Failed to delete Google event:", googleErr instanceof Error ? googleErr : new Error(String(googleErr)));
                results.failed.push({
                  type: "google",
                  id: event.external_id,
                  warning: "Local event deleted, but Google sync failed. The event may still exist in Google Calendar.",
                });
              }
            }
          }
        } else {
          results.failed.push({
            type: "local",
            id: args.event_id,
            error: "Event not found or you don't have permission to delete it",
          });
        }
      }

      // Delete from Google Calendar directly (if google_event_id provided)
      if (args.google_event_id && !args.event_id) {
        try {
          const settingsQuery = await supabase
            .from("user_calendar_settings")
            .select("google_calendar_id")
            .eq("user_id", userId)
            .single();
          const settings = settingsQuery.data;

          if (settings?.google_calendar_id) {
            const accessToken = await getGoogleCalendarAccessToken();
            if (accessToken) {
              const response = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(settings.google_calendar_id)}/events/${args.google_event_id}`,
                {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${accessToken}` },
                }
              );

              if (response.ok || response.status === 404) {
                results.deleted.push({
                  type: "google",
                  id: args.google_event_id,
                });
              } else {
                results.failed.push({
                  type: "google",
                  id: args.google_event_id,
                  error: `Google API returned ${response.status}`,
                });
              }
            }
          }
        } catch (googleErr: unknown) {
          results.failed.push({
            type: "google",
            id: args.google_event_id,
            error: googleErr instanceof Error ? googleErr.message : String(googleErr),
          });
        }
      }

      // Summary
      const allSucceeded = results.deleted.length > 0 && results.failed.length === 0;

      return JSON.stringify({
        status: allSucceeded ? "success" : results.deleted.length > 0 ? "partial" : "failed",
        message: allSucceeded
          ? `Successfully deleted ${results.deleted.length} event(s)`
          : `Deleted ${results.deleted.length} event(s), ${results.failed.length} failed`,
        results,
      });
    } catch (err: unknown) {
      log.error("[Calendar] delete_calendar_event error:", err instanceof Error ? err : new Error(String(err)));
      return JSON.stringify({
        status: "error",
        message: "Failed to delete calendar event",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});

// ============================================
// Tool: update_calendar_event
// ============================================
registerTool("update_calendar_event", {
  description: "Update an existing calendar event. Modify title, time, location, attendees, or other properties. Use to reschedule or edit events.",
  inputSchema: z.object({
    event_id: z.string().describe("Event ID to update"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    location: z.string().optional().describe("New location"),
    start_time: z.string().optional().describe("New start time (ISO format)"),
    end_time: z.string().optional().describe("New end time (ISO format)"),
    is_all_day: z.boolean().optional().describe("Mark as all-day event"),
    color: z.string().optional().describe("Event color (hex code)"),
    attendees: z.array(z.object({
      email: z.string(),
      status: z.enum(["pending", "accepted", "declined", "tentative"]).optional(),
    })).optional().describe("Update attendees"),
  }),
  execute: async (args: {
    event_id: string;
    title?: string;
    description?: string;
    location?: string;
    start_time?: string;
    end_time?: string;
    is_all_day?: boolean;
    color?: string;
    attendees?: { email: string; status?: string }[];
    __userId?: string;
  }) => {
    try {
      const userId = args.__userId;
      if (!userId) {
        return JSON.stringify({ status: "error", message: "User not authenticated" });
      }

      // Build update object
      const updates: { updated_at: string; title?: string; [key: string]: unknown } = { updated_at: new Date().toISOString() };
      if (args.title !== undefined) updates.title = args.title;
      if (args.description !== undefined) updates.description = args.description;
      if (args.location !== undefined) updates.location = args.location;
      if (args.start_time !== undefined) updates.start_time = args.start_time;
      if (args.end_time !== undefined) updates.end_time = args.end_time;
      if (args.is_all_day !== undefined) updates.is_all_day = args.is_all_day;
      if (args.color !== undefined) updates.color = args.color;

      // Update event
      const { data: updatedEvent, error } = await supabase
        .from("user_calendar_events")
        .update(updates)
        .eq("id", args.event_id)
        .eq("user_id", userId)
        .select()
        .single();

      if (error) {
        log.error("[Calendar] Failed to update event:", error);
        return JSON.stringify({
          status: "error",
          message: "Failed to update calendar event",
          error: error.message,
        });
      }

      // Update attendees if provided
      if (args.attendees) {
        // Delete existing attendees
        await supabase
          .from("user_calendar_attendees")
          .delete()
          .eq("event_id", args.event_id);

        // Insert new attendees
        const attendeeRecords = args.attendees.map(a => ({
          event_id: args.event_id,
          email: a.email,
          status: a.status || "pending",
        }));

        await supabase
          .from("user_calendar_attendees")
          .insert(attendeeRecords);
      }

      // Best-effort Google sync when the event is linked to Google Calendar.
      let googleSynced = false;
      if (updatedEvent.external_id) {
        try {
          const settingsQuery = await supabase
            .from("user_calendar_settings")
            .select("google_calendar_id")
            .eq("user_id", userId)
            .single();
          const accessToken = await getGoogleCalendarAccessToken();
          const calendarId = settingsQuery.data?.google_calendar_id || process.env.GOOGLE_CALENDAR_ID;

          if (accessToken && calendarId) {
            const googleUpdates: Record<string, unknown> = {};
            if (args.title !== undefined) googleUpdates.summary = args.title;
            if (args.description !== undefined) googleUpdates.description = args.description;
            if (args.location !== undefined) googleUpdates.location = args.location;
            if (args.start_time !== undefined) googleUpdates.start = { dateTime: args.start_time };
            if (args.end_time !== undefined) googleUpdates.end = { dateTime: args.end_time };

            if (Object.keys(googleUpdates).length > 0) {
              const res = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(updatedEvent.external_id)}`,
                {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                  body: JSON.stringify(googleUpdates),
                }
              );
              googleSynced = res.ok;
            } else {
              googleSynced = true;
            }
          }
        } catch (googleErr: unknown) {
          log.warn("[Calendar] Google sync on update failed (local update kept):", googleErr instanceof Error ? googleErr.message : String(googleErr));
        }
      }

      return JSON.stringify({
        status: "success",
        event: {
          id: updatedEvent.id,
          title: updatedEvent.title,
          start_time: updatedEvent.start_time,
          end_time: updatedEvent.end_time,
          location: updatedEvent.location,
        },
        google_synced: googleSynced,
        message: "Calendar event updated successfully!",
      });
    } catch (err: unknown) {
      log.error("[Calendar] update_calendar_event error:", err instanceof Error ? err : new Error(String(err)));
      return JSON.stringify({
        status: "error",
        message: "Failed to update calendar event",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});