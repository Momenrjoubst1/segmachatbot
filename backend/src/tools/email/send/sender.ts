import { z } from "zod";
import * as crypto from "crypto";
import { supabase } from "../../../config/supabase.config.js";
import redis from "../../../config/redis/client.js";
import { logger } from "../../../utils/logger.js";
import { findContactsByName, extractNameFromEmail, generateDisplayName } from "../email-contacts/index.js";
import { getDefaultSignature, formatSignatureForEmail, EmailSignature } from "./signatures.js";

// Reuse existing Supabase client for storage operations
const storageClient = supabase;

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// ========================================
// Helper: Save email body to Supabase Storage
// ========================================
async function saveEmailBodyToStorage(userId: string, emailId: string, body: string): Promise<string | null> {
  try {
    const fileName = `email_bodies/${userId}/${emailId}.txt`;
    const { data: _data, error } = await storageClient
      .storage
      .from('email-bodies')
      .upload(fileName, body, {
        contentType: 'text/plain',
        upsert: true
      });

    if (error) {
      logger.error('[Email] Failed to save email body to storage', { error });
      return null;
    }

    return fileName;
  } catch (err: unknown) {
    logger.error('[Email] Exception in saveEmailBodyToStorage', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ========================================
// Helper: Load email body from Supabase Storage
// ========================================
async function loadEmailBodyFromStorage(storagePath: string): Promise<string | null> {
  if (!storagePath) {
    logger.warn('[Email] Storage path not available, skipping storage load');
    return null;
  }

  try {
    const { data, error } = await storageClient
      .storage
      .from('email-bodies')
      .download(storagePath);

    if (error) {
      logger.error('[Email] Failed to load email body from storage', { error });
      return null;
    }

    const text = await data.text();
    return text;
  } catch (err: unknown) {
    logger.error('[Email] Exception in loadEmailBodyFromStorage', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ========================================
// Helper: Auto-save contact from email
// ========================================
async function autoSaveContact(userId: string, email: string): Promise<void> {
  try {
    logger.info('[Email] autoSaveContact called', { userId, email });

    if (!userId) {
      logger.error('[Email] autoSaveContact: userId is null or undefined');
      return;
    }

    if (!email) {
      logger.error('[Email] autoSaveContact: email is null or undefined');
      return;
    }

    // Check if contact already exists
    const { data: existing, error: checkError } = await supabase
      .from('email_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('email_address', email)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      logger.error('[Email] Error checking existing contact', { error: checkError, email });
    }

    if (existing) {
      // Update email count
      await supabase
        .from('email_contacts')
        .update({ email_count: existing.email_count + 1 })
        .eq('id', existing.id);
      logger.info('[Email] Updated existing contact count', { email, count: existing.email_count + 1 });
      return;
    }

    // Extract base name from email
    const { baseName, suffix } = extractNameFromEmail(email);
    logger.info('[Email] Extracted base name', { email, baseName, suffix });
    
    // Generate unique display name
    const displayName = await generateDisplayName(userId, baseName, suffix);
    logger.info('[Email] Generated display name', { displayName });

    // Save contact as auto-saved
    const { error } = await supabase
      .from('email_contacts')
      .insert({
        user_id: userId,
        email_address: email,
        display_name: displayName,
        source: 'auto',
        email_count: 1,
      });

    if (error) {
      logger.error('[Email] Failed to auto-save contact', { error, email, userId, displayName });
    } else {
      logger.info('[Email] Auto-saved contact successfully', { email, displayName, userId });
    }
  } catch (err: unknown) {
    logger.error('[Email] Error in autoSaveContact', { error: err instanceof Error ? err.message : String(err), email, stack: err instanceof Error ? err.stack : undefined });
  }
}

// ========================================
// VALIDATION
// ========================================

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email) && email.length <= 254;
}

function validateEmails(emails: string[] | undefined): string | null {
  if (!emails?.length) return null;
  for (const email of emails) {
    if (!isValidEmail(email)) return `Invalid email address: "${email}"`;
  }
  return null;
}

// ========================================
// RATE LIMITING (Redis-based)
// ========================================

const EMAIL_RATE_LIMIT = 5;
const EMAIL_RATE_WINDOW = 60_000; // 1 minute

// In-memory fallback cache for rate limiting
const rateLimitCache = new Map<string, { timestamps: number[]; lastUpdate: number }>();

async function checkRedisRateLimit(userId: string): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  try {
    const key = `email:ratelimit:${userId}`;
    const now = Date.now();
    const windowStart = now - EMAIL_RATE_WINDOW;

    // Remove old entries
    await redis.zremrangebyscore(key, 0, windowStart);

    // Count recent emails
    const count = await redis.zcard(key);

    if (count >= EMAIL_RATE_LIMIT) {
      // Get oldest entry to calculate retry time
      const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const oldestTime = oldest.length >= 2 ? parseInt(oldest[1]) : now;
      return { allowed: false, retryAfterMs: EMAIL_RATE_WINDOW - (now - oldestTime) };
    }

    // Add current timestamp
    await redis.zadd(key, now, now.toString());
    await redis.expire(key, Math.ceil(EMAIL_RATE_WINDOW / 1000));

    return { allowed: true };
  } catch (error) {
    logger.error('[Email] Redis rate limit error, falling back to in-memory cache', { error });
    return checkInMemoryRateLimit(userId);
  }
}

// Fallback: In-memory rate limit check
function checkInMemoryRateLimit(userId: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const windowStart = now - EMAIL_RATE_WINDOW;
  const cached = rateLimitCache.get(userId);

  if (!cached) {
    // Initialize cache
    rateLimitCache.set(userId, { timestamps: [now], lastUpdate: now });
    return { allowed: true };
  }

  // Clean old timestamps
  cached.timestamps = cached.timestamps.filter(t => t > windowStart);

  if (cached.timestamps.length >= EMAIL_RATE_LIMIT) {
    // Calculate retry time based on oldest timestamp
    const oldest = Math.min(...cached.timestamps);
    return { allowed: false, retryAfterMs: EMAIL_RATE_WINDOW - (now - oldest) };
  }

  // Add current timestamp
  cached.timestamps.push(now);
  cached.lastUpdate = now;
  rateLimitCache.set(userId, cached);

  return { allowed: true };
}

// ========================================
// PERSISTENT CONFIRMATIONS (Supabase)
// ========================================

const CONFIRMATION_TTL = 5 * 60_000;
// Minimum age before a confirmation can be used — prevents the model from
// creating a confirmation and confirming it within the same tool cycle.
const MIN_CONFIRMATION_AGE_MS = 30_000;

interface PendingConfirmationDB {
  id: string;
  user_id: string;
  payload: string | {
    to_address?: string;
    subject?: string;
    body?: string;
    html?: string;
    cc_addresses?: string[];
    bcc_addresses?: string[];
  };
  expires_at: string;
  created_at: string;
  confirmed_at?: string;
  to_address?: string;
  subject?: string;
  body?: string;
}

async function cleanupExpiredConfirmationsDB(): Promise<void> {
  try {
    await supabase
      .from('email_confirmations')
      .delete()
      .lt('expires_at', new Date().toISOString());
  } catch (error) {
    logger.error('[Email] Error cleaning expired confirmations', { error });
  }
}

async function saveConfirmationDB(data: {
  id: string;
  userId: string;
  to: string;
  subject: string;
  body: string;
  html?: string;
  cc?: string[];
  bcc?: string[];
}): Promise<void> {
  await supabase.from('email_confirmations').insert({
    id: data.id,
    user_id: data.userId,
    payload: {
      to_address: data.to,
      subject: data.subject,
      body: data.body,
      html: data.html,
      cc_addresses: data.cc,
      bcc_addresses: data.bcc,
    },
    expires_at: new Date(Date.now() + CONFIRMATION_TTL).toISOString(),
  });
}

async function getConfirmationDB(confirmationId: string, userId: string): Promise<PendingConfirmationDB | null> {
  const { data, error } = await supabase
    .from('email_confirmations')
    .select('*')
    .eq('id', confirmationId)
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !data) return null;

  // Reject confirmations created too recently (same tool-cycle abuse)
  if (data.created_at) {
    const age = Date.now() - new Date(data.created_at).getTime();
    if (age < MIN_CONFIRMATION_AGE_MS) {
      logger.warn('[Email] Confirmation rejected — created too recently', { confirmationId, ageMs: age });
      return null;
    }
  }

  return data as PendingConfirmationDB;
}

async function deleteConfirmationDB(confirmationId: string): Promise<void> {
  await supabase.from('email_confirmations').delete().eq('id', confirmationId);
}

async function markConfirmationUsedDB(confirmationId: string): Promise<void> {
  await supabase
    .from('email_confirmations')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('id', confirmationId);
}

// ========================================
// PERSISTENT LOGS (Supabase)
// ========================================

export async function logEmailToDB(log: {
  userId: string;
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyPreview: string;
  fullBody?: string;
  provider: string;
  status: string;
  error?: string;
  jobId?: string;
}): Promise<string> {
  const logId = crypto.randomUUID();
  
  // Save full body to Supabase Storage if available
  let storagePath: string | null = null;
  if (log.fullBody && storageClient) {
    storagePath = await saveEmailBodyToStorage(log.userId, logId, log.fullBody);
  }

  await supabase.from('email_audit_logs').insert({
    id: logId,
    user_id: log.userId,
    recipients: log.recipients,
    cc: log.cc || [],
    bcc_count: log.bcc?.length || 0,
    subject: log.subject,
    body_preview: log.bodyPreview,
    storage_path: storagePath,
    provider: log.provider as 'smtp' | 'sendgrid',
    status: log.status as 'sent' | 'failed',
    error: log.error,
    recipient_count: log.recipients.length,
    delivery_mode: (log.bcc?.length || 0) > 0 ? 'bcc' : 'individual',
    job_id: log.jobId,
    read_count: 0,
    is_deleted: false,
  });
  return logId;
}

// ========================================
// RETRY QUEUE (Supabase)
// ========================================

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS = [30_000, 300_000, 900_000]; // 30s, 5min, 15min

async function createEmailJob(data: {
  userId: string;
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  html?: string;
  provider?: string;
}): Promise<string> {
  const { data: job, error } = await supabase
    .from('email_jobs')
    .insert({
      user_id: data.userId,
      to_address: data.to,
      cc_addresses: data.cc || [],
      bcc_addresses: data.bcc || [],
      subject: data.subject,
      body: data.body,
      html: data.html,
      provider: (data.provider as 'smtp' | 'sendgrid') || null,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    logger.error('[Email] Failed to create email job', { error });
    throw error;
  }
  return job.id;
}

export async function updateJobStatus(
  jobId: string,
  status: 'processing' | 'completed' | 'failed',
  error?: string,
  incrementAttempt = false
): Promise<void> {
  const updates: Record<string, any> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'failed') {
    updates.error = error;
    updates.last_attempt_at = new Date().toISOString();
  }

  if (status === 'completed') {
    updates.sent_at = new Date().toISOString();
  }

  // Fetch current attempts once for both increment and retry logic
  const { data: currentJob } = await supabase
    .from('email_jobs')
    .select('attempts')
    .eq('id', jobId)
    .single();

  const currentAttempts = currentJob?.attempts || 0;

  if (incrementAttempt) {
    updates.attempts = currentAttempts + 1;
  }

  // Calculate next retry time for failures
  if (status === 'failed') {
    const attempts = currentAttempts + 1;
    if (attempts < MAX_RETRY_ATTEMPTS) {
      updates.status = 'pending';
      updates.next_retry_at = new Date(Date.now() + (RETRY_DELAYS[attempts - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1])).toISOString();
    }
  }

  await supabase.from('email_jobs').update(updates).eq('id', jobId);
}

// ========================================
// SMTP TRANSPORT (Flexible)
// ========================================

let nodemailerTransport: any = null;

async function getSmtpTransport() {
  if (nodemailerTransport) return nodemailerTransport;

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) return null;

  const nodemailerModule = await import("nodemailer");
  const nodemailer = (nodemailerModule as any).default || nodemailerModule;

  // Flexible SMTP configuration
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const secure = process.env.SMTP_SECURE === 'true';

  if (host) {
    // Custom SMTP (Mailgun, SendGrid, Postmark, etc.)
    nodemailerTransport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
  } else {
    // Default Gmail
    nodemailerTransport = nodemailer.createTransport({
      service: "gmail",
      auth: { user: smtpUser, pass: smtpPass },
    });
  }

  return nodemailerTransport;
}

async function getSendGrid() {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return null;
  try {
    // @ts-ignore - Optional runtime dependency
    const sgMailModule = await import("@sendgrid/mail");
    const sgMail = (sgMailModule as any).default || sgMailModule;
    sgMail.setApiKey(apiKey);
    return sgMail;
  } catch (error) {
    console.error(`[Email] Failed to load @sendgrid/mail: ${error}`);
    return null;
  }
}

// ========================================
// EMAIL SENDER
// ========================================

const SENDER_NAME = process.env.EMAIL_SENDER_NAME || "Sigma";
const DEFAULT_FROM = process.env.SMTP_USER || process.env.SENDGRID_FROM_EMAIL || "noreply@sigma.ai";
const getFromAddress = () => `${SENDER_NAME} <${DEFAULT_FROM}>`;

export async function sendEmailViaProvider(
  to: string,
  subject: string,
  body: string,
  html?: string,
  cc?: string[],
  bcc?: string[],
  attachments?: Array<{ filename: string; content: string; contentType: string }>
): Promise<{ provider: string; success: boolean; error?: string }> {

  const from = getFromAddress();
  const mailOptions: any = { from, to, subject, text: body };
  
  // Only add HTML if explicitly provided
  if (html) {
    mailOptions.html = html;
  }

  if (cc?.length) mailOptions.cc = cc.join(', ');
  if (bcc?.length) mailOptions.bcc = bcc.join(', ');
  if (attachments?.length) {
    mailOptions.attachments = attachments.map(att => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType,
    }));
  }

  // Try SMTP first
  const transport = await getSmtpTransport();
  if (transport) {
    try {
      await transport.sendMail(mailOptions);
      return { provider: "smtp", success: true };
    } catch (err: unknown) {
      logger.error('[Email] SMTP failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Try SendGrid
  const sgMail = await getSendGrid();
  if (sgMail) {
    try {
      const sgOptions: any = { to, from, subject, text: body };
      
      // Only add HTML if explicitly provided
      if (html) {
        sgOptions.html = html;
      }
      
      if (cc?.length) sgOptions.cc = cc;
      if (bcc?.length) sgOptions.bcc = bcc;
      if (attachments?.length) sgOptions.attachments = attachments;
      await sgMail.send(sgOptions);
      return { provider: "sendgrid", success: true };
    } catch (err: unknown) {
      logger.error('[Email] SendGrid failed', { error: err instanceof Error ? err.message : String(err) });
      return { provider: "sendgrid", success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { provider: "none", success: false, error: "No email provider configured" };
}

// ========================================
// HTML TEMPLATES
// ========================================

export interface EmailTemplate {
  title?: string;
  headerText?: string;
  footerText?: string;
  brandColor?: string;
  accentColor?: string;
}

const defaultTemplate: EmailTemplate = {
  brandColor: '#6366f1',
  accentColor: '#8b5cf6',
  headerText: SENDER_NAME,
  footerText: `Sent by ${SENDER_NAME} AI`,
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildHtmlEmail(
  body: string,
  subject: string,
  template?: Partial<EmailTemplate>
): string {
  const t = { ...defaultTemplate, ...template };
  const safeSubject = escapeHtml(subject);
  const safeTitle = t.title ? escapeHtml(t.title) : '';
  const safeHeaderText = escapeHtml(t.headerText || SENDER_NAME);
  const safeFooterText = escapeHtml(t.footerText || `Sent by ${SENDER_NAME} AI`);
  const safeBody = escapeHtml(body).replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeSubject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:linear-gradient(135deg,${t.brandColor},${t.accentColor});padding:24px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">${safeHeaderText}</span>
                  </td>
                  <td align="right" style="color:rgba(255,255,255,0.7);font-size:12px;">
                    ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${safeTitle ? `<tr><td style="padding:16px 32px;background:#f9fafb;border-bottom:1px solid #e5e7eb;">
              <p style="margin:0;font-size:14px;color:#6b7280;font-weight:500;">${safeTitle}</p>
            </td></tr>` : ''}
          <tr>
            <td style="padding:32px;color:#374151;font-size:15px;line-height:1.7;">
              ${safeBody}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <span style="font-size:12px;color:#9ca3af;">${safeFooterText}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildTemplateEmail(
  template: 'welcome' | 'invoice' | 'notification' | 'reset' | 'custom',
  data: Record<string, any>,
  subject: string
): string {
  const templates: Record<string, { body: string; title?: string }> = {
    welcome: {
      title: 'Welcome!',
      body: `Hello ${data.name || 'there'}!\n\nWelcome to ${SENDER_NAME}. We're excited to have you on board.\n\nBest regards,\nThe ${SENDER_NAME} Team`,
    },
    invoice: {
      title: 'Invoice Details',
      body: `Invoice #${data.invoiceNumber || 'N/A'}\n\nAmount: ${data.amount || '$0.00'}\nDue Date: ${data.dueDate || 'N/A'}\n\n${data.notes || ''}`,
    },
    notification: {
      title: data.notificationTitle || 'Notification',
      body: `${data.message || 'You have a new notification.'}\n\n${data.actionText || ''}`,
    },
    reset: {
      title: 'Password Reset',
      body: `You requested a password reset.\n\nClick the link below to reset your password:\n${data.resetLink || '[link]'}\n\nIf you didn't request this, please ignore this email.`,
    },
    custom: {
      body: data.body || '',
    },
  };

  const t = templates[template] || templates.custom;
  return buildHtmlEmail(t.body, subject, { title: t.title });
}

// ========================================
// MAIN EXECUTE FUNCTION
// ========================================

export const sendEmailSchema = z.object({
  to: z.string().describe("Recipient email address OR contact name (e.g., 'أحمد', 'محمد'). If a name is provided, the system will search for matching contacts."),
  subject: z.string().describe("Email subject line"),
  body: z.string().describe("Email body text (plain text)"),
  html: z.string().optional().describe("Optional HTML version - ONLY use if user explicitly requests HTML formatting"),
  cc: z.array(z.string()).optional().describe("CC recipients"),
  bcc: z.array(z.string()).optional().describe("BCC recipients"),
  confirm: z.boolean().optional().describe("Confirm and send after user approval"),
  confirmationId: z.string().optional().describe("Confirmation ID"),
  attachments: z.array(z.object({
    filename: z.string(),
    content: z.string().describe("Base64 encoded content"),
    contentType: z.string(),
  })).optional().describe("Email attachments"),
  template: z.enum(['welcome', 'invoice', 'notification', 'reset', 'custom']).optional().describe("ONLY use if user explicitly requests a specific template design"),
  templateData: z.record(z.any()).optional().describe("Data for template rendering"),
  signatureId: z.string().optional().describe("Signature ID to use (uses default if not specified)"),
  useSignature: z.boolean().optional().describe("Whether to append signature to email (default: true)"),
  scheduledAt: z.string().optional().describe("Schedule email for later delivery (ISO 8601 format, e.g., '2025-01-15T10:00:00Z')"),
  priority: z.enum(['high', 'normal', 'low']).optional().describe("Email priority level (default: normal)"),
});

export async function executeSendEmail(args: z.infer<typeof sendEmailSchema>, userId: string): Promise<string> {
  // Cleanup expired confirmations periodically
  cleanupExpiredConfirmationsDB();

  const { to, subject, body, html, cc, bcc, confirm, confirmationId, attachments, template, templateData, signatureId, useSignature, scheduledAt, priority } = args;
  const userUuid = userId.includes('-') ? userId : undefined;

  // Handle scheduling
  if (scheduledAt && userUuid) {
    // Import dynamically to avoid circular dependencies
    const { scheduleEmail } = await import('./scheduler.js');
    return await scheduleEmail({
      to,
      subject,
      body,
      html,
      cc,
      bcc,
      scheduledAt,
    }, userUuid);
  } else if (scheduledAt && !userUuid) {
    return JSON.stringify({
      status: "error",
      message: "Scheduling requires valid user ID.",
    });
  }

  // Check if 'to' is a contact name (not an email)
  let toAddress = to;
  if (!isValidEmail(to) && userUuid) {
    const contacts = await findContactsByName(userUuid, to);
    if (contacts.length > 0) {
      if (contacts.length === 1) {
        toAddress = contacts[0].email_address;
        logger.info('[Email] Found contact by name', { name: to, email: toAddress });
      } else {
        // Multiple contacts found - return list for user to choose
        return JSON.stringify({
          status: "multiple_contacts",
          message: `Found ${contacts.length} contacts matching "${to}". Please specify which one:`,
          contacts: contacts.map((c: { id: string; display_name: string; email_address: string; email_count: number }) => ({
            id: c.id,
            displayName: c.display_name,
            email: c.email_address,
            emailCount: c.email_count,
          })),
        });
      }
    } else {
      // No contact found - suggest saving the email
      return JSON.stringify({
        status: "contact_not_found",
        message: `No contact found with name "${to}". Please provide the full email address, or save this contact first using save_email_contact.`,
      });
    }
  }

  // Handle confirmation flow
  if (confirm) {
    if (!confirmationId) {
      return JSON.stringify({
        status: "error",
        message: "Confirmation ID is required to confirm and send an email.",
      });
    }

    const pending = userUuid ? await getConfirmationDB(confirmationId, userUuid) : null;

    if (!pending) {
      return JSON.stringify({ status: "error", message: "Confirmation expired or invalid. Please request a new email." });
    }

    // Delete immediately to prevent double-send
    await deleteConfirmationDB(confirmationId);

    // Rate limit check
    if (userUuid) {
      const ropts = await checkRedisRateLimit(userUuid);
      if (!ropts.allowed) {
        return JSON.stringify({ status: "rate_limited", message: `Email rate limit exceeded. Try again in ${Math.ceil((ropts.retryAfterMs || 0) / 1000)}s.` });
      }
    }

    // Parse payload
    const payload = typeof pending.payload === 'string' ? JSON.parse(pending.payload) : pending.payload;
    const toAddress = pending.to_address ?? payload.to_address ?? '';
    const emailSubject = pending.subject ?? payload.subject ?? '';
    const emailBody = pending.body ?? payload.body ?? '';

    if (!toAddress || !emailSubject) {
      return JSON.stringify({ status: 'error', message: 'Invalid confirmation payload.' });
    }

    // Determine provider
    let provider: string | undefined;
    if (process.env.SMTP_USER) provider = 'smtp';
    else if (process.env.SENDGRID_API_KEY) provider = 'sendgrid';

    // Create job for async processing
    if (userUuid) {
      const jobId = await createEmailJob({
        userId: userUuid,
        to: toAddress,
        cc: payload.cc_addresses,
        bcc: payload.bcc_addresses,
        subject: emailSubject,
        body: emailBody,
        html: payload.html,
        provider,
      });

      // Try to send immediately (sync)
      const result = await sendEmailViaProvider(
        toAddress,
        emailSubject,
        emailBody,
        payload.html,
        payload.cc_addresses,
        payload.bcc_addresses
      );

      if (result.success) {
        await updateJobStatus(jobId, 'completed');
        await markConfirmationUsedDB(confirmationId);
        await logEmailToDB({
          userId: userUuid,
          recipients: [toAddress],
          cc: payload.cc_addresses,
          bcc: payload.bcc_addresses,
          subject: emailSubject,
          bodyPreview: emailBody.substring(0, 100),
          fullBody: emailBody,
          provider: result.provider,
          status: 'sent',
          jobId,
        });
        // Auto-save contact
        await autoSaveContact(userUuid, toAddress);
        return JSON.stringify({ status: "success", message: "Email sent successfully.", jobId, provider: result.provider });
      } else {
        // Will be retried asynchronously
        await logEmailToDB({
          userId: userUuid,
          recipients: [toAddress],
          cc: payload.cc_addresses,
          bcc: payload.bcc_addresses,
          subject: emailSubject,
          bodyPreview: emailBody.substring(0, 100),
          fullBody: emailBody,
          provider: result.provider,
          status: 'failed',
          error: result.error,
          jobId,
        });
        // Don't reveal the error detail in API response
        if (result.error?.includes('Invalid login') || result.error?.includes('Authentication')) {
          return JSON.stringify({ status: "error", message: "Email service configuration error. Please contact support." });
        }
        return JSON.stringify({ status: "error", message: "Failed to send email. It will be retried automatically.", jobId, error: result.error });
      }
    }

    // Fallback: send directly without database
    const result = await sendEmailViaProvider(
      toAddress,
      emailSubject,
      emailBody,
      payload.html,
      payload.cc_addresses,
      payload.bcc_addresses
    );

    if (result.success) {
      // Auto-save contact even in fallback mode
      if (userUuid) {
        await autoSaveContact(userUuid, toAddress);
      }
      return JSON.stringify({ status: "success", message: "Email sent successfully.", provider: result.provider });
    }
    return JSON.stringify({ status: "error", message: "Failed to send email.", error: result.error });
  }

  // Validation
  if (!to || !subject || !body) {
    return JSON.stringify({ status: "error", message: "Missing required fields: to, subject, body." });
  }
  if (!isValidEmail(to)) {
    return JSON.stringify({ status: "error", message: `Invalid recipient email: "${to}"` });
  }
  const ccError = validateEmails(cc);
  if (ccError) return JSON.stringify({ status: "error", message: ccError });
  const bccError = validateEmails(bcc);
  if (bccError) return JSON.stringify({ status: "error", message: bccError });

  // Build final body/html
  let finalBody = body;
  // Only generate HTML if explicitly requested via html parameter or template
  let finalHtml = html || (template ? buildTemplateEmail(template, templateData || {}, subject) : undefined);

  // Append signature if requested
  if (useSignature !== false && userUuid) {
    let signature: EmailSignature | null = null;
    
    if (signatureId) {
      // Get specific signature
      const { data } = await supabase
        .from('email_signatures')
        .select('*')
        .eq('id', signatureId)
        .eq('user_id', userUuid)
        .single();
      signature = data as EmailSignature | null;
    } else {
      // Get default signature
      signature = await getDefaultSignature(userUuid);
    }
    
    if (signature) {
      finalBody = finalBody + formatSignatureForEmail(signature);
    }
  }

  // Add priority header
  const priorityHeader = priority === 'high' ? '[HIGH] ' : priority === 'low' ? '[LOW] ' : '';
  const finalSubject = priorityHeader + subject;

  // Confirmation is mandatory for sending emails - never send directly without valid confirmation
  if (!userUuid) {
    return JSON.stringify({ status: "error", message: "Sending email requires a valid authenticated user ID." });
  }

  const cid = `email_${crypto.randomUUID().substring(0, 8)}`;
  await saveConfirmationDB({
    id: cid,
    userId: userUuid,
    to,
    subject: finalSubject,
    body: finalBody,
    html: finalHtml,
    cc,
    bcc,
  });

  return JSON.stringify({
    status: "needs_confirmation",
    message: "Please confirm before sending this email.",
    confirmationId: cid,
    draft: {
      to,
      subject: finalSubject,
      bodyPreview: finalBody.substring(0, 200) + (finalBody.length > 200 ? "..." : ""),
      cc: cc?.length ? cc : undefined,
      bcc: bcc?.length ? bcc : undefined,
      hasHtml: !!finalHtml,
      hasAttachments: attachments?.length ? true : false,
      priority: priority || 'normal',
    },
  });
}

export function isEmailAvailable(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS) || !!process.env.SENDGRID_API_KEY;
}

// ========================================
// EMAIL TRACKING & MANAGEMENT
// ========================================

/**
 * Get email history for a user with filtering options
 */
export async function getEmailHistory(
  userId: string,
  options?: {
    limit?: number;
    status?: 'sent' | 'failed';
    includeDeleted?: boolean;
    searchQuery?: string;
  }
): Promise<any[]> {
  const limit = options?.limit || 50;
  
  let query = supabase
    .from('email_audit_logs')
    .select('*')
    .eq('user_id', userId);

  if (!options?.includeDeleted) {
    query = query.or('is_deleted.is.null,is_deleted.eq.false');
  }

  if (options?.status) {
    query = query.eq('status', options.status);
  }

  if (options?.searchQuery) {
    // Sanitize query to prevent PostgREST .or() filter injection
    const sanitizedSearch = options.searchQuery
      .replace(/[,()\\%_]/g, ' ')
      .trim();
    if (sanitizedSearch) {
      query = query.or(`subject.ilike.%${sanitizedSearch}%,body_preview.ilike.%${sanitizedSearch}%`);
    }
  }

  query = query.order('created_at', { ascending: false }).limit(limit);

  const { data, error } = await query;
  
  if (error) {
    logger.error('[Email] Error fetching email history', { error });
    return [];
  }

  return data || [];
}

/**
 * Get detailed information about a specific email
 */
export async function getEmailDetails(emailId: string, userId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('email_audit_logs')
    .select('*')
    .eq('id', emailId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    logger.error('[Email] Error fetching email details', { error });
    return null;
  }

  // Load full body from storage if storage_path exists
  if (data.storage_path) {
    const fullBody = await loadEmailBodyFromStorage(data.storage_path);
    if (fullBody) {
      data.full_body = fullBody;
    }
  }

  return data;
}

/**
 * Soft delete an email from history
 */
export async function deleteEmailFromHistory(emailId: string, userId: string): Promise<boolean> {
  // Get email details before deleting
  const { data: emailData } = await supabase
    .from('email_audit_logs')
    .select('recipients')
    .eq('id', emailId)
    .eq('user_id', userId)
    .single();

  const { error } = await supabase
    .from('email_audit_logs')
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString()
    })
    .eq('id', emailId)
    .eq('user_id', userId);

  if (error) {
    logger.error('[Email] Error deleting email', { error });
    return false;
  }

  // Delete from contacts if auto-saved
  if (emailData && emailData.recipients && emailData.recipients.length > 0) {
    for (const email of emailData.recipients) {
      const { data: contact } = await supabase
        .from('email_contacts')
        .select('*')
        .eq('user_id', userId)
        .eq('email_address', email)
        .eq('source', 'auto')
        .single();

      if (contact) {
        await supabase
          .from('email_contacts')
          .delete()
          .eq('id', contact.id);
      }
    }
  }

  return true;
}

/**
 * Resend a previously sent email
 */
export async function resendEmail(emailId: string, userId: string): Promise<string> {
  const email = await getEmailDetails(emailId, userId);
  
  if (!email) {
    return JSON.stringify({ status: "error", message: "Email not found." });
  }

  if (email.status !== 'sent') {
    return JSON.stringify({ status: "error", message: "Can only resend successfully sent emails." });
  }

  // Rate limit check
  const ropts = await checkRedisRateLimit(userId);
  if (!ropts.allowed) {
    return JSON.stringify({ 
      status: "rate_limited", 
      message: `Email rate limit exceeded. Try again in ${Math.ceil((ropts.retryAfterMs || 0) / 1000)}s.` 
    });
  }

  // Resend to all original recipients
  const to = email.recipients[0]; // Primary recipient
  const cc = email.cc?.length > 0 ? email.cc : undefined;
  // Use full_body if available, otherwise fall back to body_preview
  const body = email.full_body || email.body_preview || email.body || '';

  const result = await sendEmailViaProvider(to, email.subject, body, undefined, cc);

  if (result.success) {
    await logEmailToDB({
      userId,
      recipients: email.recipients,
      cc: email.cc,
      subject: `[Resent] ${email.subject}`,
      bodyPreview: body.substring(0, 100),
      fullBody: body,
      provider: result.provider,
      status: 'sent',
    });
    return JSON.stringify({ 
      status: "success", 
      message: "Email resent successfully.", 
      provider: result.provider 
    });
  }

  return JSON.stringify({ 
    status: "error", 
    message: result.error || "Failed to resend email." 
  });
}

/**
 * Get email statistics for a user
 */
export async function getEmailStats(userId: string): Promise<any> {
  const { data: stats } = await supabase
    .from('email_audit_logs')
    .select('status, created_at')
    .eq('user_id', userId)
    .or('is_deleted.is.null,is_deleted.eq.false');

  if (!stats) return null;

  const total = stats.length;
  const sent = stats.filter(s => s.status === 'sent').length;
  const failed = stats.filter(s => s.status === 'failed').length;
  
  // Calculate emails sent in last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentEmails = stats.filter(s => new Date(s.created_at) > sevenDaysAgo).length;

  return {
    total,
    sent,
    failed,
    successRate: total > 0 ? ((sent / total) * 100).toFixed(1) : 0,
    recentEmails,
  };
}
