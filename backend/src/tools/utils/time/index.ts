import { z } from "zod";
import { registerTool } from "../../tool-registry.js";

registerTool("get_time", {
  description: "Get the current time and date. Use when the user asks about the time or date.",
  inputSchema: z.object({
    timezone: z.string().optional().describe("Time zone (e.g. 'Asia/Amman', 'America/New_York'). Defaults to the local zone."),
  }),
  execute: async ({ timezone }: { timezone?: string }) => {
    try {
      const options: Intl.DateTimeFormatOptions = {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      };
      if (timezone) options.timeZone = timezone;
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("ar-JO", options).format(now);
      const iso = now.toISOString();
      return JSON.stringify({ status: "success", formatted, iso, timezone: timezone || "local" });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "Failed to get the time", error: err instanceof Error ? err.message : String(err) });
    }
  },
});
