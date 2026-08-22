import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger('memory-store');

export interface MemoryEntry {
  id: string;
  user_id: string;
  key: string;
  value: unknown;
  category: string;
  source_thread_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomInstructions {
  id: string;
  user_id: string;
  instructions: string;
  created_at: string;
  updated_at: string;
}

export async function getMemory(userId: string): Promise<MemoryEntry[]> {
  const { data, error } = await supabase
    .from("user_memory")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    log.error("Error fetching memory", { error });
    return [];
  }
  return data || [];
}

export async function setMemory(
  userId: string,
  key: string,
  value: unknown,
  category: string = "fact",
  sourceThreadId?: string
): Promise<void> {
  const { error } = await supabase.from("user_memory").upsert(
    {
      user_id: userId,
      key,
      value,
      category,
      source_thread_id: sourceThreadId || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id, key" }
  );

  if (error) {
    log.error(`Error setting memory`, { key, error });
  }
}

export async function deleteMemory(userId: string, key: string): Promise<void> {
  const { error } = await supabase
    .from("user_memory")
    .delete()
    .eq("user_id", userId)
    .eq("key", key);

  if (error) {
    log.error(`Error deleting memory`, { key, error });
  }
}

export async function deleteMemoryById(userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from("user_memory")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);

  if (error) {
    log.error(`Error deleting memory by id`, { id, error });
  }
}

export async function clearAllMemory(userId: string): Promise<void> {
  const { error } = await supabase
    .from("user_memory")
    .delete()
    .eq("user_id", userId);

  if (error) {
    log.error("Error clearing memory", { error });
  }
}

export async function getCustomInstructions(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("custom_instructions")
    .select("instructions")
    .eq("user_id", userId)
    .single();

  if (error || !data) return "";
  return data.instructions;
}

export async function setCustomInstructions(userId: string, instructions: string): Promise<void> {
  const { error } = await supabase.from("custom_instructions").upsert(
    {
      user_id: userId,
      instructions,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    log.error("Error setting custom instructions", { error });
  }
}
