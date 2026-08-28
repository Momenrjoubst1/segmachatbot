// Email storage helpers: save/load email bodies to Supabase Storage.

import { supabase } from "../../../config/supabase.config.js";
import { logger } from "../../../utils/logger.js";

const storageClient = supabase;

export async function saveEmailBodyToStorage(userId: string, emailId: string, body: string): Promise<string | null> {
  try {
    const fileName = `email_bodies/${userId}/${emailId}.txt`;
    const { error } = await storageClient
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

export async function loadEmailBodyFromStorage(storagePath: string): Promise<string | null> {
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
