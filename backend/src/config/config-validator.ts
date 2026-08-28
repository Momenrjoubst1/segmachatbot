// Startup validation of critical env vars and config; fails fast in production.

import { createLogger } from '../utils/logger.js';

const log = createLogger('config-validator');

interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface ConfigValidationRule {
  name: string;
  validate: () => { valid: boolean; error?: string };
  severity: 'critical' | 'warning';
}

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Rules checked against the environment at startup.

const validationRules: ConfigValidationRule[] = [
  // Supabase Configuration
  {
    name: 'supabase-url',
    validate: () => {
      const url = process.env.SUPABASE_URL || process.env.AUTH_SUPABASE_URL;
      if (!url) {
        return { valid: false, error: 'SUPABASE_URL or AUTH_SUPABASE_URL is required' };
      }
      try {
        new URL(url);
        return { valid: true };
      } catch {
        return { valid: false, error: 'SUPABASE_URL must be a valid URL' };
      }
    },
    severity: 'critical',
  },
  {
    name: 'supabase-service-key',
    validate: () => {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.AUTH_SUPABASE_SERVICE_ROLE_KEY;
      if (!key) {
        return { valid: false, error: 'SUPABASE_SERVICE_ROLE_KEY or AUTH_SUPABASE_SERVICE_ROLE_KEY is required' };
      }
      // Check production mode dynamically
      const isProduction = process.env.NODE_ENV === 'production';
      if (isProduction && key === 'dummy-dev-service-role') {
        return { valid: false, error: 'Service role key is set to dummy value in production' };
      }
      return { valid: true };
    },
    severity: 'critical',
  },

  // Redis Configuration
  {
    name: 'redis-connection',
    validate: () => {
      const redisUrl = process.env.REDIS_URL || process.env.REDIS_HOST;
      if (!redisUrl) {
        return { valid: false, error: 'REDIS_URL or REDIS_HOST is required' };
      }
      return { valid: true };
    },
    severity: 'critical',
  },

  // AI Provider Configuration
  {
    name: 'ai-provider',
    validate: () => {
      const hasProvider = !!(
        process.env.AZURE_API_KEY ||
        process.env.AZURE_OPENAI_API_KEY ||
        process.env.BIGMODEL_API_KEY ||
        process.env.GROQ_API_KEY ||
        process.env.GITHUB_TOKEN ||
        process.env.OPENROUTER_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.NVIDIA_API_KEY ||
        process.env.CEREBRAS_API_KEY ||
        process.env.NOVITA_API_KEY ||
        process.env.BAICHAT_API_KEY ||
        process.env.FIREWORKS_API_KEY
      );
      if (!hasProvider) {
        return { valid: false, error: 'At least one AI provider key is required (BIGMODEL_API_KEY, AZURE_API_KEY, GROQ_API_KEY, GITHUB_TOKEN, OPENROUTER_API_KEY, GEMINI_API_KEY, NVIDIA_API_KEY, CEREBRAS_API_KEY, NOVITA_API_KEY, BAICHAT_API_KEY, or FIREWORKS_API_KEY)' };
      }
      return { valid: true };
    },
    severity: 'critical',
  },

  // Default Model Configuration
  {
    name: 'default-model',
    validate: () => {
      const model = process.env.ASSISTANT_DEFAULT_MODEL;
      if (!model) {
        return { valid: false, error: 'ASSISTANT_DEFAULT_MODEL is required' };
      }
      return { valid: true };
    },
    severity: 'critical',
  },

  // Chat attachment media routing (optional tuning vars)
  {
    name: 'media-capabilities',
    validate: () => {
      const raw = process.env.MODEL_MEDIA_CAPABILITIES;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return { valid: false, error: 'MODEL_MEDIA_CAPABILITIES must be a JSON object mapping model patterns to ["video","audio"]' };
          }
        } catch {
          return { valid: false, error: 'MODEL_MEDIA_CAPABILITIES is not valid JSON' };
        }
      }
      for (const key of ['UPLOAD_DAILY_BYTES_LIMIT', 'MEDIA_DATA_URL_MAX_BYTES'] as const) {
        const value = process.env[key];
        if (!value) continue;
        if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
          return { valid: false, error: `${key} must be a positive number of bytes` };
        }
      }
      return { valid: true };
    },
    severity: 'warning',
  },

  // Server Configuration
  {
    name: 'port',
    validate: () => {
      const port = Number(process.env.PORT || 3004);
      if (isNaN(port) || port < 1 || port > 65535) {
        return { valid: false, error: 'PORT must be a valid port number (1-65535)' };
      }
      return { valid: true };
    },
    severity: 'warning',
  },

  // CORS Configuration
  {
    name: 'cors-origins',
    validate: () => {
      if (isProd) {
        const origins = process.env.FRONTEND_URL;
        if (!origins) {
          return { valid: false, error: 'FRONTEND_URL is required in production' };
        }
      }
      return { valid: true };
    },
    severity: 'critical',
  },

  // Memory Configuration
  {
    name: 'memory-config',
    validate: () => {
      const maxMessages = parseInt(process.env.MEMORY_MAX_MESSAGES || '500');
      const minMessages = parseInt(process.env.MEMORY_MIN_FOR_SUMMARY || '12');

      if (maxMessages < minMessages) {
        return { valid: false, error: 'MEMORY_MAX_MESSAGES must be >= MEMORY_MIN_FOR_SUMMARY' };
      }

      const keepFirst = parseInt(process.env.MEMORY_KEEP_FIRST || '5');
      const keepLast = parseInt(process.env.MEMORY_KEEP_LAST || '100');
      
      if (keepFirst + keepLast > maxMessages) {
        return { valid: false, error: 'MEMORY_KEEP_FIRST + MEMORY_KEEP_LAST must be <= MEMORY_MAX_MESSAGES' };
      }
      
      return { valid: true };
    },
    severity: 'warning',
  },
];

// Run all validation rules and report the combined result.

export function validateConfiguration(): ConfigValidationResult {
  const result: ConfigValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  // Skip validation in test environment unless explicitly requested
  if (isTest && process.env.RUN_CONFIG_VALIDATION_IN_TESTS !== 'true') {
    log.info('Skipping configuration validation in test environment');
    return result;
  }

  log.info('Running configuration validation...');

  for (const rule of validationRules) {
    try {
      const validation = rule.validate();
      
      if (!validation.valid) {
        const message = `[${rule.name}] ${validation.error || 'Validation failed'}`;
        
        if (rule.severity === 'critical') {
          result.errors.push(message);
          result.valid = false;
        } else {
          result.warnings.push(message);
        }
      }
    } catch (error) {
      const message = `[${rule.name}] Validation threw error: ${(error as Error).message}`;
      result.errors.push(message);
      result.valid = false;
    }
  }

  return result;
}

export function validateConfigurationOrExit(): void {
  const result = validateConfiguration();

  if (result.warnings.length > 0) {
    log.warn('Configuration warnings:', { warnings: result.warnings });
  }

  if (!result.valid) {
    log.error('Configuration validation failed - cannot start server', { 
      errors: result.errors 
    });
    
    // In production, exit immediately on critical config errors
    if (isProd) {
      console.error('\n❌ CRITICAL: Invalid configuration. Server cannot start.');
      console.error('Errors:');
      result.errors.forEach(error => console.error(`  - ${error}`));
      console.error('\nPlease fix the configuration and restart.\n');
      process.exit(1);
    } else {
      log.warn('Development mode: Continuing with invalid configuration (not recommended for production)');
    }
  } else {
    log.info('✅ Configuration validation passed');
  }
}

// Export for testing
export { validationRules };
