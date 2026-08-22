import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { supabase } from "../../../services/rag/rag-supabase-client.js";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('email-to-meeting');

createToolMetadata("email_to_meeting", "Convert an email into a calendar meeting draft", {
  requiresUserId: true,
  category: "productivity",
  enabledByDefault: true,
});

// ============================================
// Helper: Extract meeting info using AI
// ============================================
async function extractMeetingWithAI(emailContent: string, emailSubject: string): Promise<MeetingData | null> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      log.warn('[Email-to-Meeting] OPENAI_API_KEY not found, falling back to regex');
      return extractMeetingFromEmail(emailContent, emailSubject);
    }

    const result = await streamText({
      model: openai('gpt-4o-mini'),
      prompt: `Extract meeting information from this email content. The email may be in Arabic or English.
      
Email Subject: ${emailSubject}
Email Content: ${emailContent}

Extract the following information:
- title: Meeting title (if not found, use the email subject)
- startTime: Start time in ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ)
- endTime: End time in ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ)
- description: Brief description of the meeting
- location: Physical location or virtual meeting link
- attendees: Array of email addresses
- confidence: Your confidence level (0.0 to 1.0)

If no clear meeting information is found, return null for all fields except confidence.`,
      temperature: 0.1,
    });

    const response = await result.text;
    const parsed = JSON.parse(response);

    if (!parsed.startTime || !parsed.endTime) {
      return null;
    }

    return {
      title: parsed.title || emailSubject || "Meeting from Email",
      startTime: new Date(parsed.startTime),
      endTime: new Date(parsed.endTime),
      description: parsed.description || "",
      location: parsed.location || "",
      attendees: Array.isArray(parsed.attendees) ? parsed.attendees : [],
      confidence: parsed.confidence || 0.7,
    };
  } catch (error) {
    log.error('[Email-to-Meeting] AI extraction failed, falling back to regex', error instanceof Error ? error : new Error(String(error)));
    return extractMeetingFromEmail(emailContent, emailSubject);
  }
}

// ============================================
// Helper: Parse natural language date/time (Fallback)
// ============================================
function parseNaturalDateTime(text: string): { startTime: Date; endTime: Date } | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Lowercase and normalize
  const normalized = text.toLowerCase().trim();

  // Day names
  const days: Record<string, number> = {
    sunday: 0, sun: 0,
    monday: 1, mon: 1,
    tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4, thurs: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6,
  };

  // Check for day name
  for (const [dayName, dayIndex] of Object.entries(days)) {
    if (normalized.includes(dayName)) {
      const currentDay = now.getDay();
      let daysUntil = dayIndex - currentDay;
      if (daysUntil <= 0) daysUntil += 7; // Next occurrence
      
      const targetDate = new Date(today.getTime() + daysUntil * 24 * 60 * 60 * 1000);
      return extractTimeFromText(normalized, targetDate);
    }
  }

  // Check for "today", "tomorrow"
  if (normalized.includes("today")) {
    return extractTimeFromText(normalized, today);
  }
  if (normalized.includes("tomorrow")) {
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    return extractTimeFromText(normalized, tomorrow);
  }

  // Check for date patterns (e.g., "June 15", "15 June", "06/15", etc.)
  const datePatterns = [
    /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/, // MM/DD or DD/MM
    /(\w+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/, // Month DD, YYYY
    /(\d{1,2})\s+(\w+)(?:,?\s*(\d{4}))?/, // DD Month YYYY
  ];

  for (const pattern of datePatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const parsedDate = new Date(match[0]);
      if (!isNaN(parsedDate.getTime())) {
        return extractTimeFromText(normalized, parsedDate);
      }
    }
  }

  // No date found - use today with time extraction
  return extractTimeFromText(normalized, today);
}

// ============================================
// Helper: Extract time from text (Fallback)
// ============================================
function extractTimeFromText(text: string, baseDate: Date): { startTime: Date; endTime: Date } | null {
  // Time patterns
  const timePatterns = [
    /(\d{1,2}):(\d{2})\s*(am|pm)?/i, // 2:30 PM or 14:30
    /(\d{1,2})\s*(am|pm)/i, // 2 PM
  ];

  let hour = 9; // Default start hour
  let minute = 0;
  let duration = 60; // Default 1 hour

  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      hour = parseInt(match[1], 10);
      if (match[2]) minute = parseInt(match[2], 10);
      
      // Convert to 24-hour format
      if (match[3]) {
        const period = match[3].toLowerCase();
        if (period === "pm" && hour < 12) hour += 12;
        if (period === "am" && hour === 12) hour = 0;
      }
      break;
    }
  }

  // Check for duration keywords
  if (text.includes("hour") || text.includes("ساعة")) {
    const hourMatch = text.match(/(\d+)\s*hour/i);
    if (hourMatch) duration = parseInt(hourMatch[1], 10) * 60;
  }
  if (text.includes("minute") || text.includes("دقيقة")) {
    const minMatch = text.match(/(\d+)\s*minute/i);
    if (minMatch) duration = parseInt(minMatch[1], 10);
  }
  if (text.includes("half hour") || text.includes("نصف ساعة")) {
    duration = 30;
  }

  // Set start time
  const startTime = new Date(baseDate);
  startTime.setHours(hour, minute, 0, 0);

  // Set end time
  const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

  return { startTime, endTime };
}

// ============================================
// Helper: Extract meeting details from email content
// ============================================
interface MeetingData {
  title: string;
  startTime: Date;
  endTime: Date;
  description: string;
  location: string;
  attendees: string[];
  confidence: number;
}

function extractMeetingFromEmail(emailContent: string, emailSubject: string): MeetingData | null {
  const text = emailContent + " " + emailSubject;
  
  // Try to extract meeting info
  const parsed = parseNaturalDateTime(text);
  if (!parsed) return null;

  // Extract title
  let title = "Meeting from Email";
  const titlePatterns = [
    /(?:meeting|call|conference|session|appointment|event|scheduled)\s*(?:with|for|on)?\s*[:-]?\s*(.+?)(?:\.|,|$)/i,
    /(?:invitation|invite|invited)\s*(?:to|:)\s*(.+?)(?:\.|,|$)/i,
  ];

  for (const pattern of titlePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      title = match[1].trim();
      if (title.length > 5) break;
    }
  }

  // Use email subject as fallback
  if (title === "Meeting from Email" && emailSubject) {
    const cleanSubject = emailSubject
      .replace(/^(?:re:|fw:|fwd:)\s*/i, "")
      .replace(/^(?:invitation|invite):\s*/i, "")
      .trim();
    if (cleanSubject.length > 2) {
      title = cleanSubject;
    }
  }

  // Extract attendees
  const attendeeRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
  const matches = text.match(attendeeRegex) || [];
  const attendees = [...new Set(matches)].slice(0, 10);

  // Extract location
  let location = "";
  const locationPatterns = [
    /(?:location|room|place|at)\s*:?\s*(.+?)(?:\.|,|$)/i,
    /(?:zoom|teams|meet|webex|room)\s*(?:link|meeting)?\s*:?\s*(https?:\/\/[^\s]+)/i,
    /(?:building|floor|office)\s*:?\s*(.+?)(?:\.|,|$)/i,
  ];

  for (const pattern of locationPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      location = match[1].trim();
      break;
    }
  }

  // Calculate confidence based on how much we extracted
  let confidence = 0.5;
  if (title !== "Meeting from Email") confidence += 0.15;
  if (attendees.length > 0) confidence += 0.1;
  if (location) confidence += 0.1;
  if (text.includes("confirm") || text.includes("confirm")) confidence += 0.05;
  if (text.includes("please join") || text.includes("join")) confidence += 0.1;

  return {
    title,
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    description: `Extracted from email: ${emailSubject.substring(0, 200)}`,
    location,
    attendees,
    confidence: Math.min(confidence, 1),
  };
}

// ============================================
// Tool: email_to_meeting
// ============================================
registerTool("email_to_meeting", {
  description: "Extract meeting information from an email and create a draft event. Use when user receives an email invitation or wants to convert email content into a calendar event.",
  inputSchema: z.object({
    email_id: z.string().optional().describe("Email ID from the email history to extract meeting from"),
    email_content: z.string().optional().describe("Email content/body text to parse"),
    email_subject: z.string().optional().describe("Email subject line"),
    create_event: z.boolean().optional().describe("Whether to create the event (default: false, just return parsed data)"),
  }),
  execute: async (args: {
    email_id?: string;
    email_content?: string;
    email_subject?: string;
    create_event?: boolean;
    __userId?: string;
  }) => {
    try {
      const userId = args.__userId;
      if (!userId) {
        return JSON.stringify({ status: "error", message: "User not authenticated" });
      }

      let emailText = args.email_content || "";
      let emailSubject = args.email_subject || "";

      // Fetch email from history if ID provided
      if (args.email_id) {
        const { data: emailData } = await supabase
          .from("sent_emails")
          .select("subject, body")
          .eq("id", args.email_id)
          .eq("user_id", userId)
          .single();

        if (emailData) {
          emailText = emailData.body || "";
          emailSubject = emailData.subject || "";
        }
      }

      // Extract meeting data using AI (with regex fallback)
      const meetingData = await extractMeetingWithAI(emailText, emailSubject);

      if (!meetingData) {
        return JSON.stringify({
          status: "no_meeting_found",
          message: "Could not extract meeting information from the email. Please provide more details or create the event manually.",
          suggestions: [
            "Include the meeting date and time clearly in the email",
            "Mention the meeting duration",
            "Include attendee email addresses",
          ],
        });
      }

      // Return parsed data without creating if create_event is false
      if (!args.create_event) {
        return JSON.stringify({
          status: "parsed",
          meeting: {
            title: meetingData.title,
            start_time: meetingData.startTime.toISOString(),
            end_time: meetingData.endTime.toISOString(),
            duration_minutes: Math.round((meetingData.endTime.getTime() - meetingData.startTime.getTime()) / (60 * 1000)),
            description: meetingData.description,
            location: meetingData.location,
            attendees: meetingData.attendees,
          },
          confidence: meetingData.confidence,
          message: "Meeting information extracted. Confirm to create the event.",
        });
      }

      // Create the event
      const { data: createdEvent, error } = await supabase
        .from("user_calendar_events")
        .insert({
          user_id: userId,
          title: meetingData.title,
          description: meetingData.description,
          location: meetingData.location,
          start_time: meetingData.startTime.toISOString(),
          end_time: meetingData.endTime.toISOString(),
          provider: "email",
        })
        .select()
        .single();

      if (error) {
        log.error("[Scheduler] Failed to create event from email:", error);
        return JSON.stringify({
          status: "error",
          message: "Failed to create calendar event",
          error: error.message,
        });
      }

      // Add attendees if any
      if (meetingData.attendees.length > 0) {
        const attendeeRecords = meetingData.attendees.map(email => ({
          event_id: createdEvent.id,
          email,
          status: "pending",
        }));

        await supabase
          .from("user_calendar_attendees")
          .insert(attendeeRecords);
      }

      return JSON.stringify({
        status: "created",
        event: {
          id: createdEvent.id,
          title: createdEvent.title,
          start_time: createdEvent.start_time,
          end_time: createdEvent.end_time,
          location: createdEvent.location,
        },
        message: "Calendar event created from email successfully!",
      });
    } catch (err: unknown) {
      log.error("[Scheduler] email_to_meeting error:", err instanceof Error ? err : new Error(String(err)));
      return JSON.stringify({
        status: "error",
        message: "Failed to process email for meeting",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});