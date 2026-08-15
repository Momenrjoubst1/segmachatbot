import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { authFetch } from "@/lib/auth";
import { BACKEND_URL } from "@/lib/config";

export interface Textbook {
  id: string;
  file_name: string;
  file_url: string;
  status: "pending" | "processing" | "completed" | "failed";
  total_pages: number | null;
  course_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TextbookStatus {
  textbook_id: string;
  status: string;
  progress: { stage: string; pages_done: number; total_pages: number } | null;
  error: string | null;
  total_pages: number | null;
  has_structure_tree: boolean;
}

export function useTextbooks() {
  const [textbooks, setTextbooks] = useState<Textbook[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTextbooks = useCallback(async () => {
    try {
      const res = await authFetch(`${BACKEND_URL}/api/textbooks`);
      if (!res.ok) throw new Error("Failed to fetch textbooks");
      const data = await res.json();
      setTextbooks(data.textbooks || []);
    } catch (err) {
      console.error("[useTextbooks] Fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTextbooks();
  }, [fetchTextbooks]);

  const uploadTextbook = useCallback(
    async (file: File, courseId?: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Upload PDF to Supabase Storage
      const filePath = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("course-attachments")
        .upload(filePath, file, {
          upsert: true,
          contentType: "application/pdf",
        });

      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

      const {
        data: { publicUrl },
      } = supabase.storage.from("course-attachments").getPublicUrl(filePath);

      // Call backend to create textbook record + enqueue processing
      const res = await authFetch(`${BACKEND_URL}/api/textbooks/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: file.name,
          file_url: publicUrl,
          file_size_bytes: file.size,
          course_id: courseId || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }

      const result = await res.json();
      await fetchTextbooks();
      return result;
    },
    [fetchTextbooks]
  );

  const getStatus = useCallback(async (textbookId: string): Promise<TextbookStatus | null> => {
    try {
      const res = await authFetch(`${BACKEND_URL}/api/textbooks/${textbookId}/status`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  const deleteTextbook = useCallback(
    async (textbookId: string) => {
      const res = await authFetch(`${BACKEND_URL}/api/textbooks/${textbookId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      await fetchTextbooks();
    },
    [fetchTextbooks]
  );

  return {
    textbooks,
    isLoading,
    uploadTextbook,
    getStatus,
    deleteTextbook,
    refetch: fetchTextbooks,
  };
}
