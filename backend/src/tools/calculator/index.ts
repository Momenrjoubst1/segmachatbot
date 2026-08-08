import { z } from "zod";
import { registerTool } from "../tool-registry.js";
import { evaluate } from "mathjs";

registerTool("calculator", {
  description: "Execute complex mathematical operations. Use this tool for mathematical calculations and arithmetic operations.",
  inputSchema: z.object({
    expression: z.string().describe("The mathematical expression to evaluate (e.g., '2 + 2', 'sqrt(16)', '3 * 4 + 5')"),
  }),
  execute: async ({ expression }: { expression: string }) => {
    try {
      const result = evaluate(expression);
      return JSON.stringify({ status: "success", expression, result });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "Failed to evaluate expression", error: err instanceof Error ? err.message : String(err) });
    }
  },
});
