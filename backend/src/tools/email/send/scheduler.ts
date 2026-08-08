import { z } from "zod";
import { knowledgeSupabase as supabase } from "../../../config/supabase.config.js";
import { logger } from "../../../utils/logger.js";

// ========================================
// TYPES
// ========================================

export interface ScheduledEmail {
  id: string;
  user_id: string;
  to_address: string;
  subject: string;
  body: string;
  html?: string;
  cc_addresses: string[];
  bcc_addresses: string[];
  scheduled_at: string;
  status: 'pending' | 'processing' | 'completed' | 'cancelled' | 'failed';
  provider?: string;
  job_id?: string;
  error?: string;
  attempts: number;
  created_at: string;
  updated_at: string;
  sent_at?: string;
}

// ========================================
// SCHEMA
// ========================================

export const scheduleEmailSchema = z.object({
  to: z.string().describe("Recipient email address"),
  subject: z.string().describe("Email subject line"),
  body: z.string().describe("Email body text (plain text)"),
  html: z.string().optional().describe("Optional HTML version"),
  cc: z.array(z.string()).optional().describe("CC recipients"),
  bcc: z.array(z.string()).optional().describe("BCC recipients"),
  scheduledAt: z.string().describe("ISO 8601 date/time string for when to send (e.g., '2025-01-15T10:00:00Z')"),
});

// ========================================
// SCHEDULE EMAIL
// ========================================

export async function scheduleEmail(
  args: z.infer<typeof scheduleEmailSchema>,
  userId: string
): Promise<string> {
  const { to, subject, body, html, cc, bcc, scheduledAt } = args;

  // Validate scheduled time is in the future
  const scheduledDate = new Date(scheduledAt);
  const now = new Date();
  
  if (scheduledDate <= now) {
    return JSON.stringify({
      status: "error",
      message: "Scheduled time must be in the future.",
    });
  }

  // Validate email format
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!emailRegex.test(to)) {
    return JSON.stringify({
      status: "error",
      message: `Invalid recipient email: "${to}"`,
    });
  }

  // Validate CC/BCC emails
  if (cc?.length) {
    for (const email of cc) {
      if (!emailRegex.test(email)) {
        return JSON.stringify({ status: "error", message: `Invalid CC email: "${email}"` });
      }
    }
  }
  if (bcc?.length) {
    for (const email of bcc) {
      if (!emailRegex.test(email)) {
        return JSON.stringify({ status: "error", message: `Invalid BCC email: "${email}"` });
      }
    }
  }

  // Determine provider
  let provider: string | undefined;
  if (process.env.SMTP_USER) provider = 'smtp';
  else if (process.env.SENDGRID_API_KEY) provider = 'sendgrid';

  // Save to database
  const { data, error } = await supabase
    .from('email_schedules')
    .insert({
      user_id: userId,
      to_address: to,
      subject,
      body,
      html,
      cc_addresses: cc || [],
      bcc_addresses: bcc || [],
      scheduled_at: scheduledDate.toISOString(),
      status: 'pending',
      provider,
    })
    .select('id')
    .single();

  if (error) {
    logger.error('[EmailScheduler] Failed to schedule email', { error });
    return JSON.stringify({
      status: "error",
      message: "Failed to schedule email.",
      error: error.message,
    });
  }

  // Calculate time until send
  const timeUntilSend = scheduledDate.getTime() - now.getTime();
  const minutes = Math.floor(timeUntilSend / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let timeDescription = '';
  if (days > 0) timeDescription = `${days} day(s)`;
  else if (hours > 0) timeDescription = `${hours} hour(s)`;
  else timeDescription = `${minutes} minute(s)`;

  return JSON.stringify({
    status: "success",
    message: `Email scheduled successfully for ${scheduledDate.toLocaleString()} (${timeDescription} from now)`,
    scheduleId: data.id,
    scheduledAt: scheduledDate.toISOString(),
    recipient: to,
    subject,
  });
}

// ========================================
// GET SCHEDULED EMAILS
// ========================================


