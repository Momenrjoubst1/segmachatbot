import { z } from "zod";
import { registerTool } from "../../tool-registry.js";

registerTool("get_course_info", {
  description: "احصل على معلومات عن مادة دراسية مسجل فيها المستخدم. استخدم عندما يسأل عن مادة معينة أو محتواها.",
  inputSchema: z.object({
    courseName: z.string().describe("اسم المادة الدراسية (مثال: 'رياضيات', 'برمجة', 'هندسة برمجيات')"),
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
        return JSON.stringify({ status: "no_results", message: `لا توجد معلومات عن '${courseName}' في قاعدة المعرفة` });
      }
      return JSON.stringify({
        status: "success",
        course: courseName,
        documents: data.map((d: { content: string; metadata?: Record<string, unknown> }) => ({
          content: d.content.substring(0, 500),
          source: d.metadata?.source || "غير معروف",
        })),
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "فشل في جلب معلومات المادة", error: err instanceof Error ? err.message : String(err) });
    }
  },
});
