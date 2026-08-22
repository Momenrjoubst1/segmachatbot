import { z } from "zod";
import { registerTool } from "../tool-registry.js";
import { createToolMetadata } from "../tool-metadata.js";
import { supabase } from "../../services/rag/rag-supabase-client.js";
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tasks-list');

createToolMetadata("get_tasks", "List the user's tasks with optional filters", {
  requiresUserId: true,
  category: "productivity",
  enabledByDefault: true,
});

// ============================================
// Tool: get_tasks
// ============================================
registerTool("get_tasks", {
  description: "List the user's tasks. By default returns open (pending/in_progress) tasks ordered by due date. Use to answer questions like 'what tasks do I have?' or check before creating a duplicate.",
  inputSchema: z.object({
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional().describe("Filter by exact status"),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Filter by priority"),
    due_before: z.string().optional().describe("Only tasks due before this ISO datetime"),
    include_completed: z.boolean().optional().describe("Include completed/cancelled tasks (default: false)"),
    limit: z.number().optional().describe("Maximum number of tasks (default: 25)"),
  }),
  execute: async (args: {
    status?: "pending" | "in_progress" | "completed" | "cancelled";
    priority?: "low" | "medium" | "high" | "urgent";
    due_before?: string;
    include_completed?: boolean;
    limit?: number;
    __userId?: string;
  }) => {
    try {
      const userId = args.__userId;
      if (!userId) {
        return JSON.stringify({ status: "error", message: "User not authenticated" });
      }

      const limit = Math.min(args.limit || 25, 100);

      let query = supabase
        .from("user_tasks")
        .select("*")
        .eq("user_id", userId);

      if (args.status) {
        query = query.eq("status", args.status);
      } else if (!args.include_completed) {
        query = query.in("status", ["pending", "in_progress"]);
      }

      if (args.priority) {
        query = query.eq("priority", args.priority);
      }

      if (args.due_before) {
        const parsed = new Date(args.due_before);
        if (!Number.isNaN(parsed.getTime())) {
          query = query.lt("due_date", parsed.toISOString());
        }
      }

      // Open tasks first by due date; completed ones most recent first.
      const { data: tasks, error } = await query
        .order("status", { ascending: true })
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        log.error("[Tasks] Supabase list error:", error);
        return JSON.stringify({
          status: "error",
          message: "Failed to fetch tasks",
          error: error.message,
        });
      }

      const now = new Date();
      const overdueCount = (tasks || []).filter(
        (t: { due_date?: string | null; status?: string }) =>
          t.due_date && new Date(t.due_date) < now && t.status !== "completed"
      ).length;

      return JSON.stringify({
        status: "success",
        tasks: tasks || [],
        summary: {
          total: tasks?.length ?? 0,
          overdue: overdueCount,
          filters: {
            status: args.status || (args.include_completed ? "all" : "open"),
            priority: args.priority || "any",
          },
        },
      });
    } catch (err: unknown) {
      log.error("[Tasks] get_tasks error:", err instanceof Error ? err : new Error(String(err)));
      return JSON.stringify({
        status: "error",
        message: "Failed to fetch tasks",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
