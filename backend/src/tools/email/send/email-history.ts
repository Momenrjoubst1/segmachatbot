// Email history and management: tracking, details, deletion, resend, stats.

import { supabase } from "../../../config/supabase.config.js";
import { logger } from "../../../utils/logger.js";
import { loadEmailBodyFromStorage } from "./email-storage.js";
import { saveEmailBodyToStorage } from "./email-storage.js";
import { checkRedisRateLimit } from "./email-rate-limit.js";
import { sendEmailViaProvider } from "./email-providers.js";

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
  
  let storagePath: string | null = null;
  if (log.fullBody) {
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

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS = [30_000, 300_000, 900_000];

export async function createEmailJob(data: {
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

  const { data: currentJob } = await supabase
    .from('email_jobs')
    .select('attempts')
    .eq('id', jobId)
    .single();

  const currentAttempts = currentJob?.attempts || 0;

  if (incrementAttempt) {
    updates.attempts = currentAttempts + 1;
  }

  if (status === 'failed') {
    const attempts = currentAttempts + 1;
    if (attempts < MAX_RETRY_ATTEMPTS) {
      updates.status = 'pending';
      updates.next_retry_at = new Date(Date.now() + (RETRY_DELAYS[attempts - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1])).toISOString();
    }
  }

  await supabase.from('email_jobs').update(updates).eq('id', jobId);
}

export async function getEmailHistory(
  userId: string,
  options?: {
    limit?: number;
    status?: 'sent' | 'failed';
    includeDeleted?: boolean;
    searchQuery?: string;
  }
): Promise<Array<Record<string, unknown>>> {
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

  if (data.storage_path) {
    const fullBody = await loadEmailBodyFromStorage(data.storage_path);
    if (fullBody) {
      data.full_body = fullBody;
    }
  }

  return data;
}

export async function deleteEmailFromHistory(emailId: string, userId: string): Promise<boolean> {
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

export async function resendEmail(emailId: string, userId: string): Promise<string> {
  const email = await getEmailDetails(emailId, userId);
  
  if (!email) {
    return JSON.stringify({ status: "error", message: "Email not found." });
  }

  if (email.status !== 'sent') {
    return JSON.stringify({ status: "error", message: "Can only resend successfully sent emails." });
  }

  const ropts = await checkRedisRateLimit(userId);
  if (!ropts.allowed) {
    return JSON.stringify({ 
      status: "rate_limited", 
      message: `Email rate limit exceeded. Try again in ${Math.ceil((ropts.retryAfterMs || 0) / 1000)}s.` 
    });
  }

  const to = email.recipients[0];
  const cc = email.cc?.length > 0 ? email.cc : undefined;
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

export async function getEmailStats(userId: string): Promise<Record<string, unknown>> {
  const { data: stats } = await supabase
    .from('email_audit_logs')
    .select('status, created_at')
    .eq('user_id', userId)
    .or('is_deleted.is.null,is_deleted.eq.false');

  if (!stats) return {} as Record<string, unknown>;

  const total = stats.length;
  const sent = stats.filter(s => s.status === 'sent').length;
  const failed = stats.filter(s => s.status === 'failed').length;
  
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
