/**
 * ════════════════════════════════════════════════════════════════════════════════
 * useCourses - Persistent Courses State Hook
 *
 * Manages the student's registered courses with full Supabase persistence.
 * - Fetches courses from `student_courses` on mount and auth state change
 * - Provides addCourse, removeCourse, replaceCourses functions
 * - Derives isOnboarded from whether the user has any courses
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { LoadErrorCode } from "@/lib/load-errors";

export interface AcademicCourse {
  id: string;
  course_name: string;
  credit_hours: number;
}

export function useCourses() {
  const [courses, setCourses] = useState<AcademicCourse[]>([]);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [isCoursesLoading, setIsCoursesLoading] = useState(true);
  const [coursesError, setCoursesError] = useState<LoadErrorCode | null>(null);

  // Fetch courses from Supabase
  const fetchCourses = useCallback(async () => {
    setCoursesError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setCourses([]);
        setIsOnboarded(false);
        setIsCoursesLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("student_courses")
        .select("id, course_name, credit_hours")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[useCourses] Fetch error:", error);
        setCoursesError("courses_load_failed");
        return;
      }

      setCourses(data ?? []);
      setIsOnboarded((data ?? []).length > 0);
      setCoursesError(null);
    } catch (err) {
      console.error("[useCourses] Unexpected error:", err);
      setCoursesError("courses_unexpected");
    } finally {
      setIsCoursesLoading(false);
    }
  }, []);

  // Initial fetch + auth state listener
  useEffect(() => {
    fetchCourses();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        fetchCourses();
      } else if (event === "SIGNED_OUT") {
        setCourses([]);
        setIsOnboarded(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchCourses]);

  // Add a single course
  const addCourse = useCallback(
    async (course_name: string, credit_hours: number) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("student_courses")
        .insert({ user_id: user.id, course_name, credit_hours })
        .select("id, course_name, credit_hours")
        .single();

      if (error) {
        console.error("[useCourses] Add error:", error);
        return;
      }

      setCourses((prev) => [...prev, data]);
      setIsOnboarded(true);
    },
    []
  );

  // Remove a course by id
  const removeCourse = useCallback(async (courseId: string) => {
    const { error } = await supabase
      .from("student_courses")
      .delete()
      .eq("id", courseId);

    if (error) {
      console.error("[useCourses] Remove error:", error);
      return;
    }

    setCourses((prev) => {
      const next = prev.filter((c) => c.id !== courseId);
      setIsOnboarded(next.length > 0);
      return next;
    });
  }, []);

  // Replace all courses (used by onboarding "confirm & save")
  const replaceCourses = useCallback(
    async (newCourses: { course_name: string; credit_hours: number }[]) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Delete all existing courses for this user
      const { error: deleteError } = await supabase
        .from("student_courses")
        .delete()
        .eq("user_id", user.id);

      if (deleteError) {
        console.error("[useCourses] Replace delete error:", deleteError);
        return;
      }

      if (newCourses.length === 0) {
        setCourses([]);
        setIsOnboarded(false);
        return;
      }

      const rows = newCourses.map((c) => ({
        user_id: user.id,
        course_name: c.course_name,
        credit_hours: c.credit_hours,
      }));

      const { data, error: insertError } = await supabase
        .from("student_courses")
        .insert(rows)
        .select("id, course_name, credit_hours");

      if (insertError) {
        console.error("[useCourses] Replace insert error:", insertError);
        return;
      }

      setCourses(data ?? []);
      setIsOnboarded((data ?? []).length > 0);
    },
    []
  );

  return {
    courses,
    isOnboarded,
    isCoursesLoading,
    coursesError,
    addCourse,
    removeCourse,
    replaceCourses,
    refetch: fetchCourses,
    retryCourses: fetchCourses,
  };
}
