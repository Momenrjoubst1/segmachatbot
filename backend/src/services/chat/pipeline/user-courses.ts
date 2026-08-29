// Fetches enrolled courses from Supabase and renders a Redis-cached block for the system prompt.

import redis from "../../../config/redis/client.js";
import { createLogger } from "../../../utils/logger.js";
const log = createLogger("pipeline:user-courses");

const CACHE_TTL_SECONDS = 600;
const PROGRESS_CACHE_TTL_SECONDS = 300; // shorter TTL for progress

interface StudentCourse {
  course_name: string;
  credit_hours: number;
  id: string;
}

export async function fetchUserCoursesContext(userId: string): Promise<string> {
  const cacheKey = `user:courses:${userId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return cached;

    const { supabase } = await import("../../rag/rag-supabase-client.js");
    const { data: courses } = await supabase
      .from("student_courses")
      .select("id, course_name, credit_hours")
      .eq("user_id", userId);

    if (!courses || courses.length === 0) return "";

    const coursesList = (courses as StudentCourse[])
      .map((c) => `- ${c.course_name} (${c.credit_hours} ساعات)`)
      .join("\n");

    let context = `\n**معلومات الطالب الحالي (Student Info):**\nأنا أعلم أن الطالب مسجل في المواد التالية حالياً. لا تطلب منه إدخال مواده مرة أخرى، بل استخدم هذه القائمة:\n${coursesList}\n`;

    await redis.set(cacheKey, context, "EX", CACHE_TTL_SECONDS);
    return context;
  } catch (err) {
    log.warn("Failed to fetch user courses", {
      error: (err as Error)?.message,
    });
    return "";
  }
}

// Fetches the study-progress weak-topics block, cached separately with a shorter TTL.
export async function fetchStudyProgressContext(userId: string): Promise<string> {
  const cacheKey = `user:progress:${userId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return cached;

    const { buildProgressContext } = await import("../../study/progress.service.js");
    const context = await buildProgressContext(userId);

    if (context) {
      await redis.set(cacheKey, context, "EX", PROGRESS_CACHE_TTL_SECONDS);
    }
    return context;
  } catch (err) {
    log.warn("Failed to fetch study progress", {
      error: (err as Error)?.message,
    });
    return "";
  }
}

// Fetches the study profile (grade/major/exam countdown/daily goal), cached like courses.
export async function fetchStudyProfileContext(userId: string): Promise<string> {
  const cacheKey = `user:profile:${userId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return cached;

    const { buildProfileContext } = await import("../../study/profile.service.js");
    const context = await buildProfileContext(userId);

    if (context) {
      await redis.set(cacheKey, context, "EX", CACHE_TTL_SECONDS);
    }
    return context;
  } catch (err) {
    log.warn("Failed to fetch study profile", {
      error: (err as Error)?.message,
    });
    return "";
  }
}

/** Combined context for system prompt: profile + courses + weak topics */
export async function fetchCombinedUserContext(userId: string): Promise<string> {
  const [profileCtx, coursesCtx, progressCtx] = await Promise.all([
    fetchStudyProfileContext(userId),
    fetchUserCoursesContext(userId),
    fetchStudyProgressContext(userId),
  ]);

  if (!profileCtx && !coursesCtx && !progressCtx) return "";
  return [profileCtx, coursesCtx, progressCtx].filter(Boolean).join("\n\n");
}