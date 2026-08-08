import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { knowledgeSupabase as supabase } from "../../../config/supabase.config.js";

// ========================================
// Helper: Extract name from email
// ========================================
function extractNameFromEmail(email: string): { baseName: string; suffix: string } {
  // Extract the part before @
  const localPart = email.split('@')[0];
  
  // Extract trailing numbers (suffix)
  const match = localPart.match(/(\d+)$/);
  const suffix = match ? match[1] : '';
  
  // Remove numbers, dots, underscores, and special characters
  const cleaned = localPart
    .replace(/[0-9._-]/g, ' ')
    .replace(/[^a-zA-Z\u0600-\u06FF\s]/g, '')
    .trim();
  
  // If empty, use the full email
  if (!cleaned) {
    return { baseName: email, suffix: '' };
  }
  
  // Capitalize first letter
  const baseName = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  
  return { baseName, suffix };
}

// ========================================
// Helper: Generate unique display name
// ========================================
async function generateDisplayName(userId: string, baseName: string, emailSuffix: string = ''): Promise<string> {
  // If email has a suffix (number), use it directly
  if (emailSuffix) {
    const displayName = `${baseName} ${emailSuffix}`;
    // Check if this exact display name already exists
    const { data: exactMatch } = await supabase
      .from('email_contacts')
      .select('display_name')
      .eq('user_id', userId)
      .eq('display_name', displayName)
      .single();

    if (!exactMatch) {
      return displayName;
    }
  }

  // Check if base name already exists
  const { data: existing } = await supabase
    .from('email_contacts')
    .select('display_name')
    .eq('user_id', userId)
    .ilike('display_name', `${baseName}%`)
    .order('created_at', { ascending: false });

  if (!existing || existing.length === 0) {
    return baseName;
  }

  // Count how many have this base name
  const count = existing.filter(c => c.display_name.startsWith(baseName)).length;

  // Generate numbered name using English numbers
  const suffix = count === 0 ? '' : ` ${count + 1}`;

  return `${baseName}${suffix}`;
}

// ========================================
// Helper: Search contacts by name
// ========================================
async function searchContactsByName(userId: string, query: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('email_contacts')
    .select('*')
    .eq('user_id', userId)
    .ilike('display_name', `%${query}%`)
    .order('email_count', { ascending: false });
  
  if (error) return [];
  return data || [];
}

// ========================================
// SAVE EMAIL CONTACT
// ========================================
registerTool("save_email_contact", {
  description: "Save an email address to the user's contact list with a display name. The display name is automatically generated from the email address (e.g., 'أحمد واحد', 'أحمد اثنين'). Use this when the user provides an email address and wants to save it for future use.",
  inputSchema: z.object({
    email: z.string().describe("The email address to save"),
    notes: z.string().optional().describe("Optional notes about this contact"),
    isFavorite: z.boolean().optional().describe("Mark as favorite contact"),
  }),
  execute: async (args: any) => {
    const userId = args.__userId;
    if (!userId) {
      return JSON.stringify({ status: "error", message: "User authentication required." });
    }

    const { email, notes, isFavorite } = args;

    // Validate email
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!emailRegex.test(email)) {
      return JSON.stringify({ status: "error", message: "Invalid email address." });
    }

    // Check if email already exists
    const { data: existing } = await supabase
      .from('email_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('email_address', email)
      .single();

    if (existing) {
      return JSON.stringify({
        status: "exists",
        message: "This email is already in your contacts.",
        contact: {
          id: existing.id,
          email: existing.email_address,
          displayName: existing.display_name,
          notes: existing.notes,
          isFavorite: existing.is_favorite,
        },
      });
    }

    // Extract base name from email
    const { baseName, suffix } = extractNameFromEmail(email);
    
    // Generate unique display name
    const displayName = await generateDisplayName(userId, baseName, suffix);

    // Save contact
    const { data: contact, error } = await supabase
      .from('email_contacts')
      .insert({
        user_id: userId,
        email_address: email,
        display_name: displayName,
        notes: notes || null,
        is_favorite: isFavorite || false,
      })
      .select()
      .single();

    if (error) {
      return JSON.stringify({ status: "error", message: "Failed to save contact.", error: error.message });
    }

    return JSON.stringify({
      status: "success",
      message: `Contact saved as "${displayName}"`,
      contact: {
        id: contact.id,
        email: contact.email_address,
        displayName: contact.display_name,
        notes: contact.notes,
        isFavorite: contact.is_favorite,
      },
    });
  },
});

// ========================================
// GET EMAIL CONTACTS
// ========================================
registerTool("get_email_contacts", {
  description: "Get the user's saved email contacts. Can filter by search query to find contacts by name. Returns all contacts with their display names and email addresses.",
  inputSchema: z.object({
    searchQuery: z.string().optional().describe("Search contacts by display name (e.g., 'أحمد', 'محمد')"),
    favoritesOnly: z.boolean().optional().describe("Only show favorite contacts"),
    limit: z.number().optional().describe("Maximum number of contacts to return (default: 50)"),
  }),
  execute: async (args: any) => {
    const userId = args.__userId;
    if (!userId) {
      return JSON.stringify({ status: "error", message: "User authentication required." });
    }

    const { searchQuery, favoritesOnly, limit } = args;

    let query = supabase
      .from('email_contacts')
      .select('*')
      .eq('user_id', userId);

    if (searchQuery) {
      query = query.ilike('display_name', `%${searchQuery}%`);
    }

    if (favoritesOnly) {
      query = query.eq('is_favorite', true);
    }

    query = query.order('email_count', { ascending: false }).limit(limit || 50);

    const { data, error } = await query;

    if (error) {
      return JSON.stringify({ status: "error", message: "Failed to fetch contacts.", error: error.message });
    }

    return JSON.stringify({
      status: "success",
      count: data?.length || 0,
      contacts: data?.map(c => ({
        id: c.id,
        email: c.email_address,
        displayName: c.display_name,
        notes: c.notes,
        isFavorite: c.is_favorite,
        emailCount: c.email_count,
        source: c.source,
        createdAt: c.created_at,
      })) || [],
    });
  },
});

// ========================================
// DELETE EMAIL CONTACT
// ========================================
registerTool("delete_email_contact", {
  description: "Delete an email contact from the user's contact list.",
  inputSchema: z.object({
    contactId: z.string().describe("The ID of the contact to delete"),
  }),
  execute: async (args: any) => {
    const userId = args.__userId;
    if (!userId) {
      return JSON.stringify({ status: "error", message: "User authentication required." });
    }

    const { contactId } = args;

    const { error } = await supabase
      .from('email_contacts')
      .delete()
      .eq('id', contactId)
      .eq('user_id', userId);

    if (error) {
      return JSON.stringify({ status: "error", message: "Failed to delete contact.", error: error.message });
    }

    return JSON.stringify({
      status: "success",
      message: "Contact deleted successfully.",
    });
  },
});

// ========================================
// SEARCH CONTACTS BY NAME (for send_email)
// ========================================
export async function findContactsByName(userId: string, name: string): Promise<any[]> {
  return await searchContactsByName(userId, name);
}

export { extractNameFromEmail, generateDisplayName };
