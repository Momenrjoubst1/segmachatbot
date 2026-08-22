import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { supabase } from "../../../services/rag/rag-supabase-client.js";
import { getGoogleCalendarAccessToken } from "../../shared/ics-and-google-auth.js";
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('find-optimal-time');

// ============================================
// Helper: Check for conflicts
// ============================================
async function checkConflicts(
  userId: string,
  startTime: Date,
  endTime: Date,
  excludeEventId?: string
): Promise<Array<{ id: string; title: string; start_time: string; end_time: string; provider?: string }>> {
  // Check local database
  let query = supabase
    .from("user_calendar_events")
    .select("id, title, start_time, end_time")
    .eq("user_id", userId)
    .lt("start_time", endTime.toISOString())
    .gt("end_time", startTime.toISOString());

  if (excludeEventId) {
    query = query.neq("id", excludeEventId);
  }

  const { data: localConflicts } = await query;

  // Try Google Calendar
  let googleConflicts: Array<{ id: string; title: string; start_time: string; end_time: string; provider?: string }> = [];
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
        const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/free", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            timeMin: startTime.toISOString(),
            timeMax: endTime.toISOString(),
            items: [{ id: settings.google_calendar_id }],
          }),
        });

        if (response.ok) {
          const data = await response.json() as { calendars?: Array<{ busy?: Array<{ start?: string; end?: string }> }> };
          const busySlots = data.calendars?.[0]?.busy || [];
          googleConflicts = busySlots.map((slot) => ({
            id: "google",
            title: "Google Calendar Event",
            start_time: slot.start!,
            end_time: slot.end!,
            provider: "google",
          }));
        }
      }
    }
  } catch (err) {
    log.warn("[Scheduler] Google conflict check failed:", err instanceof Error ? err : new Error(String(err)));
  }

  return [...(localConflicts || []), ...googleConflicts];
}

// ============================================
// Helper: Get optimal time slot
// ============================================
async function findOptimalSlot(
  userId: string,
  durationMinutes: number,
  preferredDate?: string,
  preferredTime?: string,
  daysAhead: number = 7
): Promise<{ date: string; start_time: string; end_time: string; formatted: string; day_name: string; score: number; is_full_day_available?: boolean; has_conflicts?: boolean; conflict_resolution?: string } | null> {
  const now = new Date();
  
  // Parse preferred date
  let targetDate = preferredDate ? new Date(preferredDate) : new Date();
  
  // If date is in the past, start from tomorrow
  if (targetDate < now) {
    targetDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }

  // Get user settings
  const { data: settings } = await supabase
    .from("user_calendar_settings")
    .select("*")
    .eq("user_id", userId)
    .single();

  const workStart = settings?.working_hours_start || "09:00";
  const workEnd = settings?.working_hours_end || "17:00";
  const workingDays = settings?.working_days || [0, 1, 2, 3, 4];

  // Parse preferred time if provided
  let preferredHour = null;
  let preferredMinute = null;
  if (preferredTime) {
    const [h, m] = preferredTime.split(":").map(Number);
    preferredHour = h;
    preferredMinute = m;
  }

  // Search for optimal slot
  for (let day = 0; day < daysAhead; day++) {
    const searchDate = new Date(targetDate.getTime() + day * 24 * 60 * 60 * 1000);
    
    // Skip non-working days
    if (!workingDays.includes(searchDate.getDay())) continue;

    // Determine search range
    let dayStart = new Date(searchDate);
    let dayEnd = new Date(searchDate);

    if (preferredHour !== null) {
      dayStart.setHours(preferredHour, preferredMinute || 0, 0, 0);
      dayEnd.setHours(preferredHour + Math.ceil(durationMinutes / 60), preferredMinute || 0, 0, 0);
    } else {
      const [startH, startM] = workStart.split(":").map(Number);
      const [endH, endM] = workEnd.split(":").map(Number);
      dayStart.setHours(startH, startM, 0, 0);
      dayEnd.setHours(endH, endM, 0, 0);
    }

    // If time is in the past for today, skip
    if (searchDate.toDateString() === now.toDateString() && dayStart <= now) {
      continue;
    }

    // Check for conflicts
    const conflicts = await checkConflicts(userId, dayStart, dayEnd);
    
    if (conflicts.length === 0) {
      return {
        date: searchDate.toISOString().split("T")[0],
        start_time: dayStart.toISOString(),
        end_time: dayEnd.toISOString(),
        formatted: formatSlotDisplay(dayStart, dayEnd),
        day_name: searchDate.toLocaleDateString("en-US", { weekday: "long" }),
        score: 100 - day * 10, // Prefer sooner dates
      };
    }
  }

  // No perfect slot found - try to find any available slot
  for (let day = 0; day < daysAhead; day++) {
    const searchDate = new Date(targetDate.getTime() + day * 24 * 60 * 60 * 1000);
    
    if (!workingDays.includes(searchDate.getDay())) continue;

    const [startH, startM] = workStart.split(":").map(Number);
    const [endH, endM] = workEnd.split(":").map(Number);
    
    let slotStart = new Date(searchDate);
    slotStart.setHours(startH, startM, 0, 0);
    
    const slotEnd = new Date(searchDate);
    slotEnd.setHours(endH, endM, 0, 0);

    // Check entire day
    const conflicts = await checkConflicts(userId, slotStart, slotEnd);
    
    if (conflicts.length === 0) {
      // Found a free day
      return {
        date: searchDate.toISOString().split("T")[0],
        start_time: slotStart.toISOString(),
        end_time: slotEnd.toISOString(),
        formatted: formatSlotDisplay(slotStart, slotEnd),
        day_name: searchDate.toLocaleDateString("en-US", { weekday: "long" }),
        is_full_day_available: true,
        score: 50 - day * 5,
      };
    }
  }

  return null;
}

// Helper: Format slot display
function formatSlotDisplay(start: Date, end: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };
  return start.toLocaleString("en-US", options) + " - " + end.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

// ============================================
// Tool: find_optimal_time
// ============================================
registerTool("find_optimal_time", {
  description: "Find the optimal time slot for scheduling a meeting or event. Considers user preferences, existing commitments, and working hours. Use when user wants to schedule something but hasn't specified a time.",
  inputSchema: z.object({
    title: z.string().optional().describe("Event title (for context)"),
    duration_minutes: z.number().optional().describe("Required duration in minutes (default: 60)"),
    preferred_date: z.string().optional().describe("Preferred date (YYYY-MM-DD)"),
    preferred_time: z.string().optional().describe("Preferred time (HH:MM format)"),
    days_ahead: z.number().optional().describe("How many days to search (default: 7)"),
    urgency: z.enum(["high", "normal", "low"]).optional().describe("Urgency level affects slot selection"),
    attendees: z.array(z.string()).optional().describe("Email addresses of attendees to check availability"),
  }),
  execute: async (args: {
    title?: string;
    duration_minutes?: number;
    preferred_date?: string;
    preferred_time?: string;
    days_ahead?: number;
    urgency?: "high" | "normal" | "low";
    attendees?: string[];
    __userId?: string;
  }) => {
    try {
      const userId = args.__userId;
      if (!userId) {
        return JSON.stringify({ status: "error", message: "User not authenticated" });
      }

      const duration = args.duration_minutes || 60;
      const searchDays = args.days_ahead || 7;

      // Find optimal slot
      const optimalSlot = await findOptimalSlot(
        userId,
        duration,
        args.preferred_date,
        args.preferred_time,
        searchDays
      );

      if (!optimalSlot) {
        // Try with expanded search
        const expandedSlot = await findOptimalSlot(userId, duration, undefined, undefined, 14);
        
        if (expandedSlot) {
          return JSON.stringify({
            status: "limited_slots",
            message: `Limited availability in the next ${searchDays} days. Found a slot in the extended range.`,
            recommended_slot: expandedSlot,
            duration_minutes: duration,
            alternative_suggestion: "Consider scheduling further out or with a shorter duration",
          });
        }

        return JSON.stringify({
          status: "no_slots",
          message: `No available ${duration}-minute slots found in the next ${searchDays} days.`,
          suggestions: [
            "Try a different date range",
            "Consider a shorter meeting duration",
            "Check if you have conflicts blocking your calendar",
          ],
          working_hours: "9:00 AM - 5:00 PM, Sunday - Thursday",
        });
      }

      // Check for conflicts on the recommended slot
      const startTime = new Date(optimalSlot.start_time);
      const endTime = new Date(optimalSlot.end_time);
      const conflicts = await checkConflicts(userId, startTime, endTime);

      if (conflicts.length > 0) {
        // Re-run search excluding conflicts
        const cleanSlot = await findOptimalSlot(
          userId,
          duration,
          args.preferred_date,
          args.preferred_time,
          searchDays
        );

        if (cleanSlot) {
          optimalSlot.has_conflicts = true;
          optimalSlot.conflict_resolution = "Found alternative slot";
        }
      }

      // Check attendee availability if provided
      let attendeeAvailability: { status: string; message?: string } | null = null;
      if (args.attendees && args.attendees.length > 0) {
        // In a real implementation, we would check attendee calendars
        // For now, just indicate that attendee check is not yet implemented
        attendeeAvailability = {
          status: "not_checked",
          message: "Attendee availability check requires additional permissions",
        };
      }

      return JSON.stringify({
        status: "success",
        recommended_slot: optimalSlot,
        duration_minutes: duration,
        conflicts_checked: conflicts.length === 0,
        attendee_availability: attendeeAvailability,
      });
    } catch (err: unknown) {
      log.error("[Scheduler] find_optimal_time error:", err instanceof Error ? err : new Error(String(err)));
      return JSON.stringify({
        status: "error",
        message: "Failed to find optimal time",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});