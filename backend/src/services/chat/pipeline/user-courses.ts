/**
 * Step 4 — User Courses Context
 *
 * Fetches the student's enrolled courses from Supabase and renders them
 * into a Markdown block that gets prepended to the system prompt.  The
 * result is cached in Redis for 10 minutes to avoid hammering the DB.
 */

import redis from "../../../config/redis/client.js";
import { createLogger } from "../../../utils/logger.js";
const log = createLogger("pipeline:user-courses");

const CACHE_TTL_SECONDS = 600;

interface StudentCourse {
  course_name: string;
  credit_hours: number;
}

export async function fetchUserCoursesContext(userId: string): Promise<string> {
  const cacheKey = `user:courses:${userId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return cached;

    const { supabase } = await import("../../rag/rag-supabase-client.js");
    const { data: courses } = await supabase
      .from("student_courses")
      .select("course_name, credit_hours")
      .eq("user_id", userId);

    if (!courses || courses.length === 0) return "";

    const coursesList = (courses as StudentCourse[])
      .map((c) => `- ${c.course_name} (${c.credit_hours} Ø³Ø§Ø¹Ø§Øª)`)
      .join("\n");

    const context = `\n**Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ø­Ø§Ù„ÙŠ (Student Info):**\nØ£Ù†Ø§ Ø£Ø¹Ù„Ù… Ø£Ù† Ø§Ù„Ø·Ø§Ù„Ø¨ Ù…Ø³Ø¬Ù„ ÙÙŠ Ø§Ù„Ù…ÙˆØ§Ø¯ Ø§Ù„ØªØ§Ù„ÙŠØ© Ø­Ø§Ù„ÙŠØ§Ù‹. Ù„Ø§ ØªØ·Ù„Ø¨ Ù…Ù†Ù‡ Ø¥Ø¯Ø®Ø§Ù„ Ù…ÙˆØ§Ø¯Ù‡ Ù…Ø±Ø© Ø£Ø®Ø±Ù‰ØŒ Ø¨Ù„ Ø§Ø³ØªØ®Ø¯Ù… Ù‡Ø°Ù‡ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©:\n${coursesList}\n`;

    await redis.set(cacheKey, context, "EX", CACHE_TTL_SECONDS);
    return context;
  } catch (err) {
    log.warn("Failed to fetch user courses", {
      error: (err as Error)?.message,
    });
    return "";
  }
}
