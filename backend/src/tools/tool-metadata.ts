/**
 * Tool Metadata System
 * نظام البيانات الوصفية للأدوات
 * 
 * Automatic tool registration system that replaces manual tool lists.
 * Tools register themselves with metadata that can be scanned at startup.
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('tool-metadata');

export interface ToolMetadata {
  name: string;
  description: string;
  requiresUserId: boolean;
  category: 'communication' | 'productivity' | 'information' | 'education' | 'files' | 'other';
  enabledByDefault: boolean;
  requiresConfig?: string[]; // Required environment variables
  dangerous?: boolean; // Tools that can have significant side effects
}

// Registry for tool metadata
const toolRegistry = new Map<string, ToolMetadata>();

/**
 * Register a tool with its metadata
 * This should be called when the tool file is imported
 */
export function registerTool(metadata: ToolMetadata): void {
  if (toolRegistry.has(metadata.name)) {
    log.warn(`Tool ${metadata.name} is already registered, overwriting`);
  }
  
  toolRegistry.set(metadata.name, metadata);
  log.debug(`Tool registered: ${metadata.name}`, { category: metadata.category });
}

/**
 * Get all registered tools
 */
export function getAllTools(): ToolMetadata[] {
  return Array.from(toolRegistry.values());
}

/**
 * Get tools that require user ID
 */
export function getToolsRequiringUserId(): string[] {
  return Array.from(toolRegistry.values())
    .filter(tool => tool.requiresUserId)
    .map(tool => tool.name);
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: ToolMetadata['category']): ToolMetadata[] {
  return Array.from(toolRegistry.values())
    .filter(tool => tool.category === category);
}

/**
 * Get enabled tools (checking configuration requirements)
 */
export function getEnabledTools(): ToolMetadata[] {
  return Array.from(toolRegistry.values())
    .filter(tool => {
      // Check if tool is enabled by default
      if (!tool.enabledByDefault) return false;
      
      // Check if required configuration is available
      if (tool.requiresConfig) {
        const hasConfig = tool.requiresConfig.every(
          envVar => process.env[envVar] !== undefined
        );
        if (!hasConfig) {
          log.debug(`Tool ${tool.name} disabled: missing required configuration`, {
            missing: tool.requiresConfig.filter(env => !process.env[env])
          });
          return false;
        }
      }
      
      return true;
    });
}

/**
 * Get dangerous tools (for additional security checks)
 */
export function getDangerousTools(): string[] {
  return Array.from(toolRegistry.values())
    .filter(tool => tool.dangerous)
    .map(tool => tool.name);
}

/**
 * Validate tool registry
 * Called at startup to ensure tool system is healthy
 */
export function validateToolRegistry(): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // Check for duplicate names
  const names = Array.from(toolRegistry.keys());
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    issues.push(`Duplicate tool names: ${duplicates.join(', ')}`);
  }
  
  // Check for tools without descriptions
  const toolsWithoutDescription = Array.from(toolRegistry.values())
    .filter(tool => !tool.description || tool.description.trim().length === 0);
  if (toolsWithoutDescription.length > 0) {
    issues.push(`Tools without descriptions: ${toolsWithoutDescription.map(t => t.name).join(', ')}`);
  }
  
  // Check for dangerous tools that don't require user ID
  const dangerousWithoutAuth = Array.from(toolRegistry.values())
    .filter(tool => tool.dangerous && !tool.requiresUserId);
  if (dangerousWithoutAuth.length > 0) {
    issues.push(`Dangerous tools without user ID requirement: ${dangerousWithoutAuth.map(t => t.name).join(', ')}`);
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Decorator for automatic tool registration
 * Usage: @ToolDecorator({...})
 */
export function ToolDecorator(metadata: ToolMetadata) {
  return function(_target: object, _propertyKey: string, descriptor: PropertyDescriptor) {
    registerTool(metadata);
    return descriptor;
  };
}

/**
 * Helper function to create tool metadata
 * For use in tool files that can't use decorators.
 * Registers the metadata so getToolsRequiringUserId()/getEnabledTools()
 * see it — call sites invoke this at module top level.
 */
export function createToolMetadata(
  name: string,
  description: string,
  options: Partial<Omit<ToolMetadata, 'name' | 'description'>> = {}
): ToolMetadata {
  const metadata: ToolMetadata = {
    name,
    description,
    requiresUserId: options.requiresUserId ?? false,
    category: options.category ?? 'other',
    enabledByDefault: options.enabledByDefault ?? true,
    requiresConfig: options.requiresConfig,
    dangerous: options.dangerous ?? false,
  };
  registerTool(metadata);
  return metadata;
}