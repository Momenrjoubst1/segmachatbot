import { z } from "zod";
import { registerTool } from "../../tool-registry.js";

registerTool("get_course_info", {
  description: "Get information about a course the user is enrolled in. Use when they ask about a specific course or its content.",
  inputSchema: z.object({
    courseName: z.string().describe("Name of the course (e.g. 'Mathematics', 'Programming', 'Software Engineering')"),
  }),
  execute: async ({ courseName }: { courseName: string }) => {
    try {
      const { supabase } = await import("../../../config/supabase.config.js");
      const { data, error } = await supabase
        .from("documents")
        .select("content, metadata")
        .ilike("metadata->>source", `%${courseName}%`)
        .limit(5);
      if (error || !data || data.length === 0) {
        return JSON.stringify({ status: "no_results", message: `No information about '${courseName}' was found in the knowledge base` });
      }
      return JSON.stringify({
        status: "success",
        course: courseName,
        documents: data.map((d: { content: string; metadata?: Record<string, unknown> }) => ({
          content: d.content.substring(0, 500),
          source: d.metadata?.source || "Unknown",
        })),
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "Failed to fetch course information", error: err instanceof Error ? err.message : String(err) });
    }
  },
});
