/**
 * Log Level Configuration
 * تكوين مستويات السجلات
 * 
 * Standardizes log levels across the application for consistent
 * and predictable logging behavior.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogLevelConfig {
  default: LogLevel;
  moduleOverrides: Record<string, LogLevel>;
}

/**
 * Default log level configuration
 * Can be overridden via LOG_LEVEL environment variable
 */
const ENV_LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;

export const logLevelConfig: LogLevelConfig = {
  default: (ENV_LOG_LEVEL === 'debug' || ENV_LOG_LEVEL === 'info' || ENV_LOG_LEVEL === 'warn' || ENV_LOG_LEVEL === 'error' || ENV_LOG_LEVEL === 'fatal') 
    ? ENV_LOG_LEVEL 
    : 'info',
  moduleOverrides: {
    // Verbose modules for debugging
    'bm25': 'debug',
    'memory-config': 'debug',
    'config-validator': 'debug',
    
    // Critical modules - always warn or higher
    'auth': 'warn',
    'rate-limiter': 'warn',
    'error-handler': 'error',
  },
};

/**
 * Get the log level for a specific module
 */
export function getModuleLogLevel(moduleName: string): LogLevel {
  return logLevelConfig.moduleOverrides[moduleName] || logLevelConfig.default;
}