import type { ToolDefinition } from "./shared/types.js";

const tools: Record<string, ToolDefinition> = {};

export function registerTool(name: string, def: ToolDefinition): void {
  tools[name] = def;
}

export function getToolSchemas(): Record<string, ToolDefinition> {
  const schemas: Record<string, ToolDefinition> = {};
  for (const [name, def] of Object.entries(tools)) {
    schemas[name] = {
      description: def.description,
      inputSchema: def.inputSchema,
      execute: def.execute,
    };
  }
  return schemas;
}
