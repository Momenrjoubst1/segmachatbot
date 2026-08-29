// Student study profile — the onboarding data (grade, major, exam date, daily
// goal) the system historically never collected. Stored per user and injected
// into the system prompt so personalization is data-driven.

import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("study:profile");

export interface StudentProfileRow {
  user_id: string;
  grade_level: string | null;
  major: string | null;
  exam_date: string | null; // YYYY-MM-DD
  daily_goal: number;
  created_at: string;
  updated_at: string;
}

export interface StudyProfilePatch {
  gradeLevel?: string;
  major?: string;
  examDate?: string | null;
  dailyGoal?: number;
}

export async function getStudyProfile(userId: string): Promise<StudentProfileRow | null> {
  const { data, error } = await supabase
    .from("student_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    log.error("Failed to fetch study profile", { error: error.message, userId });
    throw new Error(error.message);
  }
  return (data as StudentProfileRow) || null;
}

export async function upsertStudyProfile(
  userId: string,
  patch: StudyProfilePatch
): Promise<StudentProfileRow> {
  const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.gradeLevel !== undefined) values.grade_level = patch.gradeLevel;
  if (patch.major !== undefined) values.major = patch.major;
  if (patch.examDate !== undefined) values.exam_date = patch.examDate;
  if (patch.dailyGoal !== undefined) values.daily_goal = patch.dailyGoal;

  const { data, error } = await supabase
    .from("student_profiles")
    .upsert({ user_id: userId, ...values })
    .select("*")
    .single();

  if (error) {
    log.error("Failed to save study profile", { error: error.message, userId });
    throw new Error(error.message);
  }
  return data as StudentProfileRow;
}

function examCountdown(examDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exam = new Date(`${examDate}T00:00:00`);
  const days = Math.round((exam.getTime() - today.getTime()) / 86_400_000);
  if (Number.isNaN(days)) return "";
  if (days < 0) return `(الامتحان انتهى قبل ${Math.abs(days)} يوم)`;
  if (days === 0) return "(الامتحان اليوم!)";
  return `(بعد ${days} يوم)`;
}

/** Build the Arabic study-profile block injected into the system prompt. */
export async function buildProfileContext(userId: string): Promise<string> {
  let profile: StudentProfileRow | null = null;
  try {
    profile = await getStudyProfile(userId);
  } catch {
    return "";
  }
  if (!profile) return "";

  const lines: string[] = [];
  if (profile.grade_level) lines.push(`- المرحلة/المستوى: ${profile.grade_level}`);
  if (profile.major) lines.push(`- التخصص: ${profile.major}`);
  if (profile.exam_date) {
    lines.push(`- تاريخ الامتحان القادم: ${profile.exam_date} ${examCountdown(profile.exam_date)} — اربط خطط المذاكرة والمراجعة بهذا العد التنازلي`);
  }
  if (profile.daily_goal) {
    lines.push(`- هدف المراجعة اليومي: ${profile.daily_goal} بطاقة — شجّع الطالب على إكماله`);
  }

  if (lines.length === 0) return "";
  return `\n**الملف الدراسي للطالب (Study Profile):**\n${lines.join("\n")}\n`;
}
