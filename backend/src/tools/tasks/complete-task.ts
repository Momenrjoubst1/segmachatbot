import { z } from "zod";
import { registerTool } from "../tool-registry.js";
import { createToolMetadata } from "../tool-metadata.js";
import { supabase } from "../../services/rag/rag-supabase-client.js";
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tasks-complete');

createToolMetadata("complete_task", "Mark a task as completed (or reopen it)", {
  requiresUserId: true,
  category: "productivity",
  enabledByDefault: true,
});

// ============================================
// Tool: complete_task
// ============================================
registerTool("complete_task", {
  description: "Mark a task as completed. Pass completed=false to reopen a completed task instead.",
  inputSchema: z.object({
    task_id: z.string().uuid().describe("ID of the task"),
    completed: z.boolean().optional().describe("true = mark completed (default), false = reopen"),
  }),
  execute: async (args: {
    task_id: string;
    completed?: boolean;
    __userId?: string;
  }) => {
    try {
      const userId = args.__userId;
      if (!userId) {
        return JSON.stringify({ status: "error", message: "User not authenticated" });
      }

      const isCompleted = args.completed !== false;

      const { data: task, error } = await supabase
        .from("user_tasks")
        .update({
          status: isCompleted ? "completed" : "in_progress",
          completed_at: isCompleted ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", args.task_id)
        .eq("user_id", userId)
        .select()
        .single();

      if (error || !task) {
        log.error("[Tasks] Supabase complete error:", error);
        return JSON.stringify({
          status: "error",
          message: "Failed to update the task (not found or not yours)",
          error: error?.message ?? "unknown database error",
        });
      }

      return JSON.stringify({
        status: "success",
        task,
        message: isCompleted ? `Task "${task.title}" completed! 🎉` : `Task "${task.title}" reopened.`,
      });
    } catch (err: unknown) {
      log.error("[Tasks] complete_task error:", err instanceof Error ? err : new Error(String(err)));
      return JSON.stringify({
        status: "error",
        message: "Failed to complete task",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
