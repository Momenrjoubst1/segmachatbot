import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { registerTool, getToolSchemas } from '../tools/tool-registry.js';

// Schema-driven system contract: model-facing knowledge lives in the tool
// schemas, not in a prose system prompt. The registry appends per-tool usage
// notes and the general tool discipline to every description at delivery time.
describe('tool registry — schema-driven usage notes', () => {
  it('appends the usage note and general discipline to a noted tool', () => {
    registerTool('send_email', {
      description: 'Send an email.',
      inputSchema: z.object({}),
      execute: async () => 'ok',
    });

    const desc = getToolSchemas().send_email.description;
    expect(desc).toContain('Send an email.');
    expect(desc).toContain('Max 5 emails/minute');
    expect(desc).toContain('confirm=true');
    expect(desc).toContain('Tool calls are intermediate work');
  });

  it('appends only the general discipline to tools without a note', () => {
    registerTool('calculator', {
      description: 'Evaluate a math expression.',
      inputSchema: z.object({}),
      execute: async () => '1',
    });

    const desc = getToolSchemas().calculator.description;
    expect(desc).toContain('Evaluate a math expression.');
    expect(desc).toContain('Tool calls are intermediate work');
    expect(desc).not.toContain('Max 5 emails/minute');
  });

  it('preserves schema and execute while enriching the description', () => {
    registerTool('find_materials', {
      description: 'Search the student library.',
      inputSchema: z.object({ query: z.string() }),
      execute: async () => '[]',
    });

    const def = getToolSchemas().find_materials;
    expect(def.description).toContain('NEVER modify or invent material:// URLs');
    expect(def.inputSchema).toBeInstanceOf(z.ZodObject);
    expect(typeof def.execute).toBe('function');
  });
});
