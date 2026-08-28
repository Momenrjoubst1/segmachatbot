// Email contact helpers: auto-save contacts from emails.

import { supabase } from "../../../config/supabase.config.js";
import { logger } from "../../../utils/logger.js";
import { extractNameFromEmail, generateDisplayName } from "../email-contacts/index.js";

export async function autoSaveContact(userId: string, email: string): Promise<void> {
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
      await supabase
        .from('email_contacts')
        .update({ email_count: existing.email_count + 1 })
        .eq('id', existing.id);
      logger.info('[Email] Updated existing contact count', { email, count: existing.email_count + 1 });
      return;
    }

    const { baseName, suffix } = extractNameFromEmail(email);
    logger.info('[Email] Extracted base name', { email, baseName, suffix });
    
    const displayName = await generateDisplayName(userId, baseName, suffix);
    logger.info('[Email] Generated display name', { displayName });

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
