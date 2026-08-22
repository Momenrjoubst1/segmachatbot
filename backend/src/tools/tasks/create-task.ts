import { z } from "zod";
import { registerTool } from "../tool-registry.js";
import { createToolMetadata } from "../tool-metadata.js";
import { supabase } from "../../services/rag/rag-supabase-client.js";
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tasks-create');

createToolMetadata("create_task", "Create a task/todo for the user", {
  requiresUserId: true,
  category: "productivity",
  enabledByDefault: true,
});

// ============================================
// Tool: create_task
// ============================================
registerTool("create_task", {
  description: "Create a task/todo on the user's task list. Executes immediately — no confirmation needed. Use linked_event_id to attach it to a calendar event when relevant.",
  inputSchema: z.object({
    title: z.string().describe("Task title"),
    description: z.string().optional().describe("Task details (optional)"),
    due_date: z.string().optional().describe("Due date/time (ISO date string, optional)"),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Priority (default: medium)"),
    linked_event_id: z.string().uuid().optional().describe("Link this task to a calendar event ID (optional)"),
  }),
  execute: async (args: {
    title: string;
    description?: string;
    due_date?: string;
    priority?: "low" | "medium" | "high" | "urgent";
    linked_event_id?: string;
    __userId?: string;
  }) => {
    try {
      const userId = args.__userId;
      if (!userId) {
        return JSON.stringify({ status: "error", message: "User not authenticated" });
      }

      let dueDateIso: string | null = null;
      if (args.due_date) {
        const parsed = new Date(args.due_date);
        if (Number.isNaN(parsed.getTime())) {
          return JSON.stringify({ status: "error", message: "Invalid due_date. Use an ISO date string." });
        }
        dueDateIso = parsed.toISOString();
      }

      const { data: task, error } = await supabase
        .from("user_tasks")
        .insert({
          user_id: userId,
          title: args.title,
          description: args.description || null,
          due_date: dueDateIso,
          priority: args.priority || "medium",
          linked_event_id: args.linked_event_id || null,
          status: "pending",
        })
        .select()
        .single();

      if (error || !task) {
        log.error("[Tasks] Supabase insert error:", error);
        return JSON.stringify({
          status: "error",
          message: "Failed to save the task",
          error: error?.message ?? "unknown database error",
        });
      }

      return JSON.stringify({
        status: "success",
        task,
        message: `Task "${task.title}" added!`,
      });
    } catch (err: unknown) {
      log.error("[Tasks] create_task error:", err instanceof Error ? err : new Error(String(err)));
      return JSON.stringify({
        status: "error",
        message: "Failed to create task",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
