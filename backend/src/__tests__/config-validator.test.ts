/**
 * Configuration Validator Tests
 * اختبارات مدقق التكوين
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateConfiguration, validationRules } from '../config/config-validator.js';

describe('Configuration Validator', () => {
  beforeEach(() => {
    // Save original environment
    process.env.NODE_ENV = 'test';
    process.env.RUN_CONFIG_VALIDATION_IN_TESTS = 'true';
  });

  afterEach(() => {
    // Restore environment
    delete process.env.SUPABASE_URL;
    delete process.env.AUTH_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.AUTH_SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    delete process.env.ASSISTANT_DEFAULT_MODEL;
    delete process.env.AZURE_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.RUN_CONFIG_VALIDATION_IN_TESTS;
    delete process.env.MEMORY_MAX_MESSAGES;
    delete process.env.MEMORY_MIN_FOR_SUMMARY;
  });

  describe('validateConfiguration', () => {
    it('should pass validation with valid configuration', () => {
      process.env.NODE_ENV = 'test';
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.ASSISTANT_DEFAULT_MODEL = 'gpt-4';
      process.env.GROQ_API_KEY = 'test-groq-key';

      const result = validateConfiguration();
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when Supabase URL is missing', () => {
      process.env.NODE_ENV = 'test';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.ASSISTANT_DEFAULT_MODEL = 'gpt-4';
      process.env.GROQ_API_KEY = 'test-groq-key';

      const result = validateConfiguration();
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('SUPABASE_URL'))).toBe(true);
    });

    it('should fail when service role key is missing', () => {
      process.env.NODE_ENV = 'test';
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.ASSISTANT_DEFAULT_MODEL = 'gpt-4';
      process.env.GROQ_API_KEY = 'test-groq-key';

      const result = validateConfiguration();
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('SERVICE_ROLE_KEY'))).toBe(true);
    });

    it('should fail when no AI provider is configured', () => {
      process.env.NODE_ENV = 'test';
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.ASSISTANT_DEFAULT_MODEL = 'gpt-4';

      const result = validateConfiguration();
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('AI provider'))).toBe(true);
    });

    it('should fail when Redis configuration is missing', () => {
      process.env.NODE_ENV = 'test';
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
      process.env.ASSISTANT_DEFAULT_MODEL = 'gpt-4';
      process.env.GROQ_API_KEY = 'test-groq-key';

      const result = validateConfiguration();
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('REDIS'))).toBe(true);
    });

    it('should reject invalid Supabase URL', () => {
      process.env.NODE_ENV = 'test';
      process.env.SUPABASE_URL = 'not-a-valid-url';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.ASSISTANT_DEFAULT_MODEL = 'gpt-4';
      process.env.GROQ_API_KEY = 'test-groq-key';

      const result = validateConfiguration();
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('valid URL'))).toBe(true);
    });

    it('should reject dummy service role key in production', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalRunConfig = process.env.RUN_CONFIG_VALIDATION_IN_TESTS;
      
      // Set production mode and enable validation
      process.env.NODE_ENV = 'production';
      process.env.RUN_CONFIG_VALIDATION_IN_TESTS = 'true';
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-dev-service-role';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.ASSISTANT_DEFAULT_MODEL = 'gpt-4';
      process.env.GROQ_API_KEY = 'test-groq-key';

      const result = validateConfiguration();
      
      // Restore environment
      process.env.NODE_ENV = originalNodeEnv;
      process.env.RUN_CONFIG_VALIDATION_IN_TESTS = originalRunConfig;
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('dummy value'))).toBe(true);
    });

    it('should warn about invalid memory configuration', () => {
      process.env.NODE_ENV = 'test';
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.ASSISTANT_DEFAULT_MODEL = 'gpt-4';
      process.env.GROQ_API_KEY = 'test-groq-key';
      process.env.MEMORY_MAX_MESSAGES = '10';
      process.env.MEMORY_MIN_FOR_SUMMARY = '20'; // Invalid: min > max

      const result = validateConfiguration();
      
      expect(result.warnings.some(e => e.includes('MEMORY_MAX_MESSAGES'))).toBe(true);
    });
  });

  describe('validationRules', () => {
    it('should have all required validation rules', () => {
      const ruleNames = validationRules.map(rule => rule.name);
      
      expect(ruleNames).toContain('supabase-url');
      expect(ruleNames).toContain('supabase-service-key');
      expect(ruleNames).toContain('redis-connection');
      expect(ruleNames).toContain('ai-provider');
      expect(ruleNames).toContain('default-model');
      expect(ruleNames).toContain('cors-origins');
      expect(ruleNames).toContain('memory-config');
    });

    it('should have correct severity levels', () => {
      const criticalRules = validationRules.filter(rule => rule.severity === 'critical');
      const warningRules = validationRules.filter(rule => rule.severity === 'warning');
      
      expect(criticalRules.length).toBeGreaterThan(0);
      expect(warningRules.length).toBeGreaterThan(0);
    });
  });
});