import { supabase } from "../../../config/supabase.config.js";

// ========================================
// TYPES
// ========================================

export interface EmailSignature {
  id: string;
  user_id: string;
  name: string;
  content: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// ========================================
// GET DEFAULT SIGNATURE
// ========================================

export async function getDefaultSignature(userId: string): Promise<EmailSignature | null> {
  const { data, error } = await supabase
    .from('email_signatures')
    .select('*')
    .eq('user_id', userId)
    .eq('is_default', true)
    .single();

  if (error || !data) return null;
  return data as EmailSignature;
}

// ========================================
// FORMAT SIGNATURE FOR EMAIL
// ========================================

export function formatSignatureForEmail(signature: EmailSignature): string {
  // Check if content is HTML
  const isHtml = signature.content.includes('<') && signature.content.includes('>');
  
  if (isHtml) {
    return `\n\n--\n${signature.content}`;
  }
  
  // Plain text signature
  return `\n\n--\n${signature.content.replace(/\n/g, '\n')}`;
}
