import { z } from "zod";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDefinition {
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  // Using ZodRawShape inference to preserve type safety at the call site
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (args: any) => Promise<string>;
}
