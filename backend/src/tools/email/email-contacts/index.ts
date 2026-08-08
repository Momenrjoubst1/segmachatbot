import { knowledgeSupabase as supabase } from "../../../config/supabase.config.js";

interface Contact {
  id: string;
  display_name: string;
  email_address: string;
  email_count: number;
}

export async function findContactsByName(
  name: string,
  userId: string
): Promise<Contact[]> {
  const { data, error } = await supabase
    .from("email_contacts")
    .select("id, display_name, email_address, email_count")
    .eq("user_id", userId)
    .ilike("display_name", `%${name}%`)
    .order("email_count", { ascending: false })
    .limit(10);

  if (error) throw error;
  return (data || []) as Contact[];
}

export function extractNameFromEmail(email: string): { baseName: string; suffix: string } {
  const localPart = email.split("@")[0];
  const lastDotIndex = localPart.lastIndexOf(".");
  const baseName = lastDotIndex > 0 ? localPart.substring(0, lastDotIndex) : localPart;
  const suffix = lastDotIndex > 0 ? localPart.substring(lastDotIndex + 1) : "";
  return { baseName, suffix };
}

export async function generateDisplayName(
  _userId: string,
  baseName: string,
  suffix?: string
): Promise<string> {
  const cleanedName = baseName
    .replace(/[._-]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

  if (suffix) {
    return `${cleanedName} (${suffix.toUpperCase()})`;
  }
  return cleanedName;
}
