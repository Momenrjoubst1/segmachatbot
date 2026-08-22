import { z } from "zod";
import { registerTool } from "../tool-registry.js";
import { createToolMetadata } from "../tool-metadata.js";
import { supabase } from "../../services/rag/rag-supabase-client.js";
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tasks-delete');

createToolMetadata("delete_task", "Delete a task permanently", {
  requiresUserId: true,
  category: "productivity",
  enabledByDefault: true,
});

// ============================================
// Tool: delete_task
// ============================================
registerTool("delete_task", {
  description: "Permanently delete a task from the user's task list.",
  inputSchema: z.object({
    task_id: z.string().uuid().describe("ID of the task to delete"),
  }),
  execute: async (args: {
    task_id: string;
    __userId?: string;
  }) => {
    try {
      const userId = args.__userId;
      if (!userId) {
        return JSON.stringify({ status: "error", message: "User not authenticated" });
      }

      const { data: task, error } = await supabase
        .from("user_tasks")
        .delete()
        .eq("id", args.task_id)
        .eq("user_id", userId)
        .select()
        .single();

      if (error || !task) {
        log.error("[Tasks] Supabase delete error:", error);
        return JSON.stringify({
          status: "error",
          message: "Failed to delete the task (not found or not yours)",
          error: error?.message ?? "unknown database error",
        });
      }

      return JSON.stringify({
        status: "success",
        deleted_task_id: task.id,
        title: task.title,
        message: `Task "${task.title}" deleted.`,
      });
    } catch (err: unknown) {
      log.error("[Tasks] delete_task error:", err instanceof Error ? err : new Error(String(err)));
      return JSON.stringify({
        status: "error",
        message: "Failed to delete task",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
