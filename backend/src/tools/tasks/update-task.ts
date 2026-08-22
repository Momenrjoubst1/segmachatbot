import { z } from "zod";
import { registerTool } from "../tool-registry.js";
import { createToolMetadata } from "../tool-metadata.js";
import { supabase } from "../../services/rag/rag-supabase-client.js";
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tasks-update');

createToolMetadata("update_task", "Update/re-schedule an existing task", {
  requiresUserId: true,
  category: "productivity",
  enabledByDefault: true,
});

// ============================================
// Tool: update_task
// ============================================
registerTool("update_task", {
  description: "Update an existing task: change title, details, due date or priority.",
  inputSchema: z.object({
    task_id: z.string().uuid().describe("ID of the task to update"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    due_date: z.string().optional().describe("New due date/time (ISO string)"),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("New priority"),
    linked_event_id: z.string().uuid().nullable().optional().describe("Link/unlink a calendar event (pass null to unlink)"),
  }),
  execute: async (args: {
    task_id: string;
    title?: string;
    description?: string;
    due_date?: string;
    priority?: "low" | "medium" | "high" | "urgent";
    linked_event_id?: string | null;
    __userId?: string;
  }) => {
    try {
      const userId = args.__userId;
      if (!userId) {
        return JSON.stringify({ status: "error", message: "User not authenticated" });
      }

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (args.title !== undefined) updates.title = args.title;
      if (args.description !== undefined) updates.description = args.description;
      if (args.priority !== undefined) updates.priority = args.priority;
      if (args.linked_event_id !== undefined) updates.linked_event_id = args.linked_event_id;
      if (args.due_date !== undefined) {
        if (args.due_date === null || args.due_date === "") {
          updates.due_date = null;
        } else {
          const parsed = new Date(args.due_date);
          if (Number.isNaN(parsed.getTime())) {
            return JSON.stringify({ status: "error", message: "Invalid due_date. Use an ISO date string." });
          }
          updates.due_date = parsed.toISOString();
        }
      }

      const { data: task, error } = await supabase
        .from("user_tasks")
        .update(updates)
        .eq("id", args.task_id)
        .eq("user_id", userId)
        .select()
        .single();

      if (error || !task) {
        log.error("[Tasks] Supabase update error:", error);
        return JSON.stringify({
          status: "error",
          message: "Failed to update the task (not found or not yours)",
          error: error?.message ?? "unknown database error",
        });
      }

      return JSON.stringify({
        status: "success",
        task,
        message: `Task "${task.title}" updated!`,
      });
    } catch (err: unknown) {
      log.error("[Tasks] update_task error:", err instanceof Error ? err : new Error(String(err)));
      return JSON.stringify({
        status: "error",
        message: "Failed to update task",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
