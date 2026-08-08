/**
 * ════════════════════════════════════════════════════════════════════════════════
 * useCourseResources - Course Resource Management Hook
 *
 * Manages file resources for a specific course with full Supabase persistence.
 * - Fetches resources from `course_resources` table
 * - Uploads files to `course-attachments` storage bucket
 * - Inserts resource records after successful upload
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";

export interface CourseResource {
  id: string;
  course_id: string;
  file_name: string;
  file_url: string;
  created_at: string;
}

export function useCourseResources(courseId: string | null) {
  const [resources, setResources] = useState<CourseResource[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Fetch resources for the active course
  const fetchResources = useCallback(async () => {
    if (!courseId) {
      setResources([]);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("course_resources")
        .select("id, course_id, file_name, file_url, created_at")
        .eq("course_id", courseId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[useCourseResources] Fetch error:", error);
        return;
      }

      setResources(data ?? []);
    } catch (err) {
      console.error("[useCourseResources] Unexpected error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [courseId]);

  // Fetch on mount and when courseId changes
  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  // Upload a file and create a resource record
  const uploadFile = useCallback(
    async (file: File) => {
      if (!courseId) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      setIsUploading(true);
      try {
        // Build the storage path: userId/courseId/fileName
        const filePath = `${user.id}/${courseId}/${file.name}`;

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from("course-attachments")
          .upload(filePath, file, {
            upsert: true,
            contentType: file.type,
          });

        if (uploadError) {
          console.error("[useCourseResources] Storage upload error:", uploadError);
          return;
        }

        // Get the public URL
        const {
          data: { publicUrl },
        } = supabase.storage.from("course-attachments").getPublicUrl(filePath);

        // Insert a record into course_resources
        const { data, error: insertError } = await supabase
          .from("course_resources")
          .insert({
            course_id: courseId,
            file_name: file.name,
            file_url: publicUrl,
          })
          .select("id, course_id, file_name, file_url, created_at")
          .single();

        if (insertError) {
          console.error("[useCourseResources] DB insert error:", insertError);
          return;
        }

        // Add to local state
        setResources((prev) => [data, ...prev]);
      } catch (err) {
        console.error("[useCourseResources] Upload unexpected error:", err);
      } finally {
        setIsUploading(false);
      }
    },
    [courseId]
  );

  // Delete a resource and its file
  const deleteResource = useCallback(
    async (resourceId: string, fileUrl: string) => {
      try {
        // Extract the file path from the public URL
        const url = new URL(fileUrl);
        const pathParts = url.pathname.split("/course-attachments/");
        const filePath = pathParts[1];

        if (filePath) {
          // Remove from storage
          await supabase.storage.from("course-attachments").remove([filePath]);
        }

        // Remove from DB
        const { error } = await supabase
          .from("course_resources")
          .delete()
          .eq("id", resourceId);

        if (error) {
          console.error("[useCourseResources] Delete error:", error);
          return;
        }

        setResources((prev) => prev.filter((r) => r.id !== resourceId));
      } catch (err) {
        console.error("[useCourseResources] Delete unexpected error:", err);
      }
    },
    []
  );

  return {
    resources,
    isLoading,
    isUploading,
    uploadFile,
    deleteResource,
    refetch: fetchResources,
  };
}
