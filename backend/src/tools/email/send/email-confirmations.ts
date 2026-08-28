// Email confirmations: persistent confirmation management via Supabase.

import { supabase } from "../../../config/supabase.config.js";
import { logger } from "../../../utils/logger.js";

const CONFIRMATION_TTL = 5 * 60_000;
const MIN_CONFIRMATION_AGE_MS = 30_000;

export interface PendingConfirmationDB {
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

export async function cleanupExpiredConfirmationsDB(): Promise<void> {
  try {
    await supabase
      .from('email_confirmations')
      .delete()
      .lt('expires_at', new Date().toISOString());
  } catch (error) {
    logger.error('[Email] Error cleaning expired confirmations', { error });
  }
}

export async function saveConfirmationDB(data: {
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

export async function getConfirmationDB(confirmationId: string, userId: string): Promise<PendingConfirmationDB | null> {
  const { data, error } = await supabase
    .from('email_confirmations')
    .select('*')
    .eq('id', confirmationId)
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !data) return null;

  if (data.created_at) {
    const age = Date.now() - new Date(data.created_at).getTime();
    if (age < MIN_CONFIRMATION_AGE_MS) {
      logger.warn('[Email] Confirmation rejected — created too recently', { confirmationId, ageMs: age });
      return null;
    }
  }

  return data as PendingConfirmationDB;
}

export async function deleteConfirmationDB(confirmationId: string): Promise<void> {
  await supabase.from('email_confirmations').delete().eq('id', confirmationId);
}

export async function markConfirmationUsedDB(confirmationId: string): Promise<void> {
  await supabase
    .from('email_confirmations')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('id', confirmationId);
}
