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
    async (file: File, courseId?: string, onProgress?: (pct: number) => void) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Upload file directly to backend (bypasses Supabase Storage 50MB limit)
      const formData = new FormData();
      formData.append("file", file);
      if (courseId) formData.append("course_id", courseId);

      const xhr = new XMLHttpRequest();
      const result = await new Promise<{
        textbook_id: string;
        status: string;
        deduplicated: boolean;
        message?: string;
      }>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new Error(err.error || "Upload failed"));
            } catch {
              reject(new Error("Upload failed"));
            }
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Upload failed")));

        // Get auth token
        supabase.auth.getSession().then(({ data: { session } }) => {
          xhr.open("POST", `${BACKEND_URL}/api/textbooks/upload-file`);
          xhr.setRequestHeader("Authorization", `Bearer ${session?.access_token || ""}`);
          xhr.send(formData);
        });
      });

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
