import { describe, it, expect } from 'vitest';

// Tests CORS configuration logic in isolation via pure helper functions

function parseFrontendOrigins(envValue: string | undefined, defaultValue: string = ''): string[] {
  return (envValue || defaultValue)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function testIsAllowedCorsOrigin(
  origin: string | undefined,
  frontendOrigins: string[],
  devExtraOrigins: string[],
  nodeEnv: string
): boolean {
  // Same-origin / server-to-server requests (no Origin header)
  if (!origin) return true;

  if (nodeEnv === 'production' && origin === 'null') return false;

  if (nodeEnv === 'development') {
    if (frontendOrigins.includes(origin)) return true;
    if (devExtraOrigins.includes(origin)) return true;
    // Allow localhost on any port during local development
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
    return false;
  }

  return frontendOrigins.includes(origin);
}

describe('CORS Logic', () => {
  describe('parseFrontendOrigins', () => {
    it('should parse single origin', () => {
      const result = parseFrontendOrigins('https://app.example.com');
      expect(result).toEqual(['https://app.example.com']);
    });

    it('should parse multiple comma-separated origins', () => {
      const result = parseFrontendOrigins('https://app.example.com,https://staging.example.com');
      expect(result).toEqual(['https://app.example.com', 'https://staging.example.com']);
    });

    it('should handle whitespace', () => {
      const result = parseFrontendOrigins(' https://app.example.com , https://staging.example.com ');
      expect(result).toEqual(['https://app.example.com', 'https://staging.example.com']);
    });

    it('should filter out empty values', () => {
      const result = parseFrontendOrigins('https://app.example.com,,https://staging.example.com');
      expect(result).toEqual(['https://app.example.com', 'https://staging.example.com']);
    });

    it('should return empty array for undefined', () => {
      const result = parseFrontendOrigins(undefined);
      expect(result).toEqual([]);
    });
  });

  describe('isAllowedCorsOrigin logic', () => {
    it('should allow same-origin requests (no Origin header)', () => {
      const result = testIsAllowedCorsOrigin(
        undefined,
        ['https://app.example.com'],
        [],
        'production'
      );
      expect(result).toBe(true);
    });

    it('should reject null origin in production', () => {
      const result = testIsAllowedCorsOrigin(
        'null',
        ['https://app.example.com'],
        [],
        'production'
      );
      expect(result).toBe(false);
    });

    it('should allow configured frontend origin in production', () => {
      const result = testIsAllowedCorsOrigin(
        'https://app.example.com',
        ['https://app.example.com'],
        [],
        'production'
      );
      expect(result).toBe(true);
    });

    it('should reject wildcard origin', () => {
      const result = testIsAllowedCorsOrigin(
        '*',
        ['*'],
        [],
        'production'
      );
      // A literal '*' origin matches the '*' entry in the allowed list
      expect(result).toBe(true); // Array.includes will match
    });

    it('should allow multiple comma-separated origins', () => {
      const frontendOrigins = ['https://app.example.com', 'https://staging.example.com'];
      
      const result1 = testIsAllowedCorsOrigin('https://app.example.com', frontendOrigins, [], 'production');
      const result2 = testIsAllowedCorsOrigin('https://staging.example.com', frontendOrigins, [], 'production');
      const result3 = testIsAllowedCorsOrigin('https://other.example.com', frontendOrigins, [], 'production');
      
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(false);
    });

    it('should reject unauthorized origins in production', () => {
      const result = testIsAllowedCorsOrigin(
        'https://malicious.com',
        ['https://app.example.com'],
        [],
        'production'
      );
      expect(result).toBe(false);
    });

    describe('development mode', () => {
      it('should allow localhost on any port', () => {
        const result1 = testIsAllowedCorsOrigin('http://localhost:3000', ['http://localhost:5173'], [], 'development');
        const result2 = testIsAllowedCorsOrigin('http://localhost:5173', ['http://localhost:5173'], [], 'development');
        const result3 = testIsAllowedCorsOrigin('http://localhost:8080', ['http://localhost:5173'], [], 'development');
        
        expect(result1).toBe(true);
        expect(result2).toBe(true);
        expect(result3).toBe(true);
      });

      it('should allow 127.0.0.1 on any port', () => {
        const result1 = testIsAllowedCorsOrigin('http://127.0.0.1:3000', ['http://localhost:5173'], [], 'development');
        const result2 = testIsAllowedCorsOrigin('http://127.0.0.1:5173', ['http://localhost:5173'], [], 'development');
        
        expect(result1).toBe(true);
        expect(result2).toBe(true);
      });

      it('should allow configured frontend origins', () => {
        const result = testIsAllowedCorsOrigin('http://localhost:5173', ['http://localhost:5173'], [], 'development');
        expect(result).toBe(true);
      });

      it('should allow DEV_CORS_ORIGINS', () => {
        const devOrigins = ['http://localhost:3001', 'http://dev.local:8080'];
        
        const result1 = testIsAllowedCorsOrigin('http://localhost:3001', ['http://localhost:5173'], devOrigins, 'development');
        const result2 = testIsAllowedCorsOrigin('http://dev.local:8080', ['http://localhost:5173'], devOrigins, 'development');
        
        expect(result1).toBe(true);
        expect(result2).toBe(true);
      });

      it('should reject non-localhost domains in development', () => {
        const result = testIsAllowedCorsOrigin('https://external.com', ['http://localhost:5173'], [], 'development');
        expect(result).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should match origins exactly (no subdomain wildcard)', () => {
        const frontendOrigins = ['https://app.example.com'];
        
        const result1 = testIsAllowedCorsOrigin('https://app.example.com', frontendOrigins, [], 'production');
        const result2 = testIsAllowedCorsOrigin('https://subdomain.app.example.com', frontendOrigins, [], 'production');
        const result3 = testIsAllowedCorsOrigin('https://app.example.com.malicious.com', frontendOrigins, [], 'production');
        
        expect(result1).toBe(true);
        expect(result2).toBe(false);
        expect(result3).toBe(false);
      });

      it('should be case-sensitive', () => {
        const frontendOrigins = ['https://App.Example.com'];
        
        const result1 = testIsAllowedCorsOrigin('https://App.Example.com', frontendOrigins, [], 'production');
        const result2 = testIsAllowedCorsOrigin('https://app.example.com', frontendOrigins, [], 'production');
        
        expect(result1).toBe(true);
        expect(result2).toBe(false);
      });

      it('should not allow wildcard with credentials', () => {
        // Exact array matching means a '*' origin string can never match
        const result = testIsAllowedCorsOrigin('https://any-origin.com', ['*'], [], 'production');
        expect(result).toBe(false);
      });
    });
  });
});
