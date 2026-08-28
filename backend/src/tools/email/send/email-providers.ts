// Email providers: SMTP and SendGrid integration.

import { logger } from "../../../utils/logger.js";

let nodemailerTransport: { sendMail: (opts: Record<string, unknown>) => Promise<unknown> } | null = null;

export async function getSmtpTransport() {
  if (nodemailerTransport) return nodemailerTransport;

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) return null;

  const nodemailerModule = await import("nodemailer");
  const nodemailer = (nodemailerModule as { default?: typeof import("nodemailer") }).default || nodemailerModule;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const secure = process.env.SMTP_SECURE === 'true';

  if (host) {
    nodemailerTransport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user: smtpUser, pass: smtpPass },
    });
  } else {
    nodemailerTransport = nodemailer.createTransport({
      service: "gmail",
      auth: { user: smtpUser, pass: smtpPass },
    });
  }

  return nodemailerTransport;
}

export async function getSendGrid() {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return null;
  try {
    const sgMailModule = await import("@sendgrid/mail");
    const sgMail = (sgMailModule as { default?: { setApiKey: (k: string) => void; send: (o: unknown) => Promise<unknown> } }).default || sgMailModule;
    sgMail.setApiKey(apiKey);
    return sgMail;
  } catch (error) {
    console.error(`[Email] Failed to load @sendgrid/mail: ${error}`);
    return null;
  }
}

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
  const mailOptions: { from: string; to: string; subject: string; text: string; html?: string; cc?: string; bcc?: string; attachments?: Array<{ filename: string; content: string; contentType: string }> } = { from, to, subject, text: body };
  
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

  const transport = await getSmtpTransport();
  if (transport) {
    try {
      await transport.sendMail(mailOptions);
      return { provider: "smtp", success: true };
    } catch (err: unknown) {
      logger.error('[Email] SMTP failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const sgMail = await getSendGrid();
  if (sgMail) {
    try {
      const sgOptions: { to: string; from: string; subject: string; text: string; html?: string; cc?: string[]; bcc?: string[]; attachments?: Array<{ filename: string; content: string; contentType: string }> } = { to, from, subject, text: body };
      
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
