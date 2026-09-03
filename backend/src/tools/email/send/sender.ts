// Email sender: main orchestration module.

import { z } from "zod";
import * as crypto from "crypto";
import { supabase } from "../../../config/supabase.config.js";
import { logger } from "../../../utils/logger.js";
import { findContactsByName } from "../email-contacts/index.js";
import { getDefaultSignature, formatSignatureForEmail, EmailSignature } from "./signatures.js";
import { saveEmailBodyToStorage, loadEmailBodyFromStorage } from "./email-storage.js";
import { checkRedisRateLimit } from "./email-rate-limit.js";
import { cleanupExpiredConfirmationsDB, saveConfirmationDB, getConfirmationDB, deleteConfirmationDB, markConfirmationUsedDB } from "./email-confirmations.js";
import { buildHtmlEmail, buildTemplateEmail } from "./email-templates.js";
import { sendEmailViaProvider } from "./email-providers.js";
import { logEmailToDB, createEmailJob, updateJobStatus, getEmailHistory, getEmailDetails, deleteEmailFromHistory, resendEmail, getEmailStats } from "./email-history.js";
import { autoSaveContact } from "./contact-helpers.js";

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

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

// EmailTemplate is a type — re-exporting it as a value crashes ESM at
// runtime (tsc silently elides the name, tsx/node does not).
export type { EmailTemplate } from "./email-templates.js";
export { escapeHtml, buildHtmlEmail, buildTemplateEmail } from "./email-templates.js";
export { logEmailToDB, updateJobStatus, getEmailHistory, getEmailDetails, deleteEmailFromHistory, resendEmail, getEmailStats } from "./email-history.js";

export const sendEmailSchema = z.object({
  to: z.string().describe("Recipient email address OR contact name (e.g., 'John', 'Sarah'). If a name is provided, the system will search for matching contacts."),
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
  cleanupExpiredConfirmationsDB();

  const { to, subject, body, html, cc, bcc, confirm, confirmationId, attachments, template, templateData, signatureId, useSignature, scheduledAt, priority } = args;
  const userUuid = userId.includes('-') ? userId : undefined;

  if (scheduledAt && userUuid) {
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

  let toAddress = to;
  if (!isValidEmail(to) && userUuid) {
    const contacts = await findContactsByName(userUuid, to);
    if (contacts.length > 0) {
      if (contacts.length === 1) {
        toAddress = contacts[0].email_address;
        logger.info('[Email] Found contact by name', { name: to, email: toAddress });
      } else {
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
      return JSON.stringify({
        status: "contact_not_found",
        message: `No contact found with name "${to}". Please provide the full email address, or save this contact first using save_email_contact.`,
      });
    }
  }

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

    await deleteConfirmationDB(confirmationId);

    if (userUuid) {
      const ropts = await checkRedisRateLimit(userUuid);
      if (!ropts.allowed) {
        return JSON.stringify({ status: "rate_limited", message: `Email rate limit exceeded. Try again in ${Math.ceil((ropts.retryAfterMs || 0) / 1000)}s.` });
      }
    }

    const payload = typeof pending.payload === 'string' ? JSON.parse(pending.payload) : pending.payload;
    const toAddress = pending.to_address ?? payload.to_address ?? '';
    const emailSubject = pending.subject ?? payload.subject ?? '';
    const emailBody = pending.body ?? payload.body ?? '';

    if (!toAddress || !emailSubject) {
      return JSON.stringify({ status: 'error', message: 'Invalid confirmation payload.' });
    }

    let provider: string | undefined;
    if (process.env.SMTP_USER) provider = 'smtp';
    else if (process.env.SENDGRID_API_KEY) provider = 'sendgrid';

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
        await autoSaveContact(userUuid, toAddress);
        return JSON.stringify({ status: "success", message: "Email sent successfully.", jobId, provider: result.provider });
      } else {
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
        if (result.error?.includes('Invalid login') || result.error?.includes('Authentication')) {
          return JSON.stringify({ status: "error", message: "Email service configuration error. Please contact support." });
        }
        return JSON.stringify({ status: "error", message: "Failed to send email. It will be retried automatically.", jobId, error: result.error });
      }
    }

    const result = await sendEmailViaProvider(
      toAddress,
      emailSubject,
      emailBody,
      payload.html,
      payload.cc_addresses,
      payload.bcc_addresses
    );

    if (result.success) {
      if (userUuid) {
        await autoSaveContact(userUuid, toAddress);
      }
      return JSON.stringify({ status: "success", message: "Email sent successfully.", provider: result.provider });
    }
    return JSON.stringify({ status: "error", message: "Failed to send email.", error: result.error });
  }

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

  let finalBody = body;
  let finalHtml = html || (template ? buildTemplateEmail(template, templateData || {}, subject) : undefined);

  if (useSignature !== false && userUuid) {
    let signature: EmailSignature | null = null;
    
    if (signatureId) {
      const { data } = await supabase
        .from('email_signatures')
        .select('*')
        .eq('id', signatureId)
        .eq('user_id', userUuid)
        .single();
      signature = data as EmailSignature | null;
    } else {
      signature = await getDefaultSignature(userUuid);
    }
    
    if (signature) {
      finalBody = finalBody + formatSignatureForEmail(signature);
    }
  }

  const priorityHeader = priority === 'high' ? '[HIGH] ' : priority === 'low' ? '[LOW] ' : '';
  const finalSubject = priorityHeader + subject;

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
