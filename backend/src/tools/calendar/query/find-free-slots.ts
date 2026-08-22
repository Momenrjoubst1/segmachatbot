import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { getGoogleCalendarAccessToken } from "../../shared/ics-and-google-auth.js";
import { supabase } from "../../../services/rag/rag-supabase-client.js";
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('calendar-free-slots');

createToolMetadata("find_free_slots", "Find free time slots in the user's calendar", {
  requiresUserId: true,
  category: "productivity",
  enabledByDefault: true,
});

// ============================================
// Helper: Get user's calendar settings
// ============================================
async function getUserCalendarSettings(userId: string) {
  const { data } = await supabase
    .from("user_calendar_settings")
    .select("*")
    .eq("user_id", userId)
    .single();

  return data;
}

// ============================================
// Helper: Get busy slots from Google Calendar
// ============================================
async function getGoogleBusySlots(accessToken: string, calendarId: string, timeMin: string, timeMax: string) {
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/free", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Calendar Free/Busy API error: ${response.statusText}`);
  }

  const data = await response.json() as { calendars?: Array<{ busy?: Array<{ start?: string; end?: string }> }> };
  return data.calendars?.[0]?.busy || [];
}

// ============================================
// Tool: find_free_slots
// ============================================
registerTool("find_free_slots", {
  description: "Find available time slots for scheduling. Returns free slots based on user's calendar and working hours. Use this when user wants to schedule a meeting and needs to know when they're free.",
  inputSchema: z.object({
    date: z.string().optional().describe("Date to search (YYYY-MM-DD). Defaults to today."),
    duration_minutes: z.number().optional().describe("Required duration in minutes (default: 60)"),
    start_time: z.string().optional().describe("Earliest time to consider (HH:MM format)"),
    end_time: z.string().optional().describe("Latest time to consider (HH:MM format)"),
    days_ahead: z.number().optional().describe("Number of days to search ahead (default: 7)"),
    preferred_times: z.array(z.string()).optional().describe("Preferred time slots (e.g., ['09:00', '14:00'])"),
  }),
  execute: async (args: {
    date?: string;
    duration_minutes?: number;
    start_time?: string;
    end_time?: string;
    days_ahead?: number;
    preferred_times?: string[];
    __userId?: string;
  }) => {
    try {
      const userId = args.__userId;
      if (!userId) {
        return JSON.stringify({ status: "error", message: "User not authenticated" });
      }

      const duration = args.duration_minutes || 60;
      const daysAhead = args.days_ahead || 7;
      const preferredTimes = args.preferred_times || [];

      // Get user settings
      const settings = await getUserCalendarSettings(userId);
      
      // Default working hours
      const workStart = settings?.working_hours_start || "09:00";
      const workEnd = settings?.working_hours_end || "17:00";
      const workingDays = settings?.working_days || [0, 1, 2, 3, 4]; // Sun-Sat
      const timezone = settings?.timezone || "Asia/Amman";

      // Parse date or use today
      let searchDate = args.date ? new Date(args.date) : new Date();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find next working day to start search
      while (!workingDays.includes(searchDate.getDay()) || searchDate < today) {
        searchDate = new Date(searchDate.getTime() + 24 * 60 * 60 * 1000);
      }

      const freeSlots: Array<{ date: string; day_name: string; slots: Array<{ start: string; end: string; duration_minutes: number; formatted: string }> }> = [];

      // Search for available slots
      for (let day = 0; day < daysAhead; day++) {
        const currentDay = new Date(searchDate.getTime() + day * 24 * 60 * 60 * 1000);
        
        // Skip non-working days
        if (!workingDays.includes(currentDay.getDay())) continue;

        // Get start and end of search range
        let dayStart = new Date(currentDay);
        let dayEnd = new Date(currentDay);

        if (args.start_time) {
          const [startHour, startMin] = args.start_time.split(":").map(Number);
          dayStart.setHours(startHour, startMin, 0, 0);
        } else {
          const [workHour, workMin] = workStart.split(":").map(Number);
          dayStart.setHours(workHour, workMin, 0, 0);
        }

        if (args.end_time) {
          const [endHour, endMin] = args.end_time.split(":").map(Number);
          dayEnd.setHours(endHour, endMin, 0, 0);
        } else {
          const [workHour, workMin] = workEnd.split(":").map(Number);
          dayEnd.setHours(workHour, workMin, 0, 0);
        }

        // Skip if start is after end
        if (dayStart >= dayEnd) continue;

        // Fetch busy times for this day
        const timeMinISO = dayStart.toISOString();
        const timeMaxISO = dayEnd.toISOString();

        let busySlots: Array<{ start?: string; end?: string }> = [];

        // Try Google Calendar free/busy
        try {
          if (settings?.google_calendar_id) {
            const accessToken = await getGoogleCalendarAccessToken();
            if (accessToken) {
              busySlots = await getGoogleBusySlots(
                accessToken,
                settings.google_calendar_id,
                timeMinISO,
                timeMaxISO
              );
            }
          }
        } catch (googleErr) {
          log.warn("[Calendar] Google busy lookup failed:", googleErr instanceof Error ? googleErr : new Error(String(googleErr)));
        }

        // Fetch from local database
        const { data: localEvents } = await supabase
          .from("user_calendar_events")
          .select("start_time, end_time")
          .eq("user_id", userId)
          .gte("start_time", timeMinISO)
          .lte("end_time", timeMaxISO)
          .order("start_time", { ascending: true });

        // Convert busy times to comparable format
        const busy: { start: Date; end: Date }[] = [];

        for (const busySlot of busySlots) {
          if (busySlot.start && busySlot.end) {
            busy.push({
              start: new Date(busySlot.start),
              end: new Date(busySlot.end),
            });
          }
        }

        if (localEvents) {
          for (const event of localEvents) {
            busy.push({
              start: new Date(event.start_time),
              end: new Date(event.end_time),
            });
          }
        }

        // Find free slots
        const slots: any[] = [];
        let slotStart = new Date(dayStart);

        // Sort busy slots by start time
        busy.sort((a, b) => a.start.getTime() - b.start.getTime());

        for (const busySlot of busy) {
          // Check if there's a gap before this busy slot
          if (slotStart < busySlot.start) {
            const gapEnd = new Date(Math.min(busySlot.start.getTime(), dayEnd.getTime()));
            const gapDuration = (gapEnd.getTime() - slotStart.getTime()) / (60 * 1000);

            if (gapDuration >= duration) {
              slots.push({
                start: slotStart.toISOString(),
                end: gapEnd.toISOString(),
                duration_minutes: gapDuration,
                formatted: formatTimeSlot(slotStart, gapEnd),
              });
            }
          }
          // Move slot start to after busy slot
          slotStart = new Date(Math.max(slotStart.getTime(), busySlot.end.getTime()));
        }

        // Check remaining time after last busy slot
        if (slotStart < dayEnd) {
          const remainingDuration = (dayEnd.getTime() - slotStart.getTime()) / (60 * 1000);
          if (remainingDuration >= duration) {
            slots.push({
              start: slotStart.toISOString(),
              end: dayEnd.toISOString(),
              duration_minutes: remainingDuration,
              formatted: formatTimeSlot(slotStart, dayEnd),
            });
          }
        }

        // Filter by preferred times if specified
        let filteredSlots = slots;
        if (preferredTimes.length > 0) {
          filteredSlots = slots.filter(slot => {
            const slotHour = new Date(slot.start).getHours();
            return preferredTimes.some(pref => {
              const [prefHour] = pref.split(":").map(Number);
              return Math.abs(slotHour - prefHour) <= 1;
            });
          });
        }

        if (filteredSlots.length > 0) {
          freeSlots.push({
            date: currentDay.toISOString().split("T")[0],
            day_name: currentDay.toLocaleDateString("en-US", { weekday: "long" }),
            slots: filteredSlots.slice(0, 5), // Max 5 slots per day
          });
        }
      }

      // If no slots found, suggest alternative times
      if (freeSlots.length === 0) {
        return JSON.stringify({
          status: "no_slots",
          message: `No ${duration}-minute slots available in the next ${daysAhead} days matching your preferences.`,
          suggestions: [
            "Try expanding the time range",
            "Consider shorter meeting duration",
            "Check a different date range",
          ],
          working_hours: {
            start: workStart,
            end: workEnd,
            days: workingDays.map((d: number) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]),
          },
        });
      }

      return JSON.stringify({
        status: "success",
        duration_requested: duration,
        available_slots: freeSlots,
        total_slots: freeSlots.reduce((sum, d) => sum + d.slots.length, 0),
        timezone,
      });
    } catch (err: unknown) {
      log.error("[Calendar] find_free_slots error:", err instanceof Error ? err : new Error(String(err)));
      return JSON.stringify({
        status: "error",
        message: "Failed to find free slots",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});

// Helper function to format time slot
function formatTimeSlot(start: Date, end: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };
  const startStr = start.toLocaleTimeString("en-US", options);
  const endStr = end.toLocaleTimeString("en-US", options);
  return `${startStr} - ${endStr}`;
}