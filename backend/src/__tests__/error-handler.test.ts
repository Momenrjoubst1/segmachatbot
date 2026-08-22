import { describe, it, expect, vi } from 'vitest';
import {
  AppError,
  ErrorCode,
  createErrorResponse,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  ExternalServiceError,
  TimeoutError,
} from '../utils/error-handler.js';

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('Error Handler', () => {
  describe('AppError', () => {
    it('should create error with default code', () => {
      const error = new AppError('Something failed');
      expect(error.message).toBe('Something failed');
      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(true);
    });

    it('should create error with custom code and status', () => {
      const error = new AppError('Not found', ErrorCode.NOT_FOUND, 404);
      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.statusCode).toBe(404);
    });

    it('should store context', () => {
      const error = new AppError('Error', ErrorCode.VALIDATION_ERROR, 400, true, { field: 'email' });
      expect(error.context).toEqual({ field: 'email' });
    });

    it('should be an instance of Error', () => {
      const error = new AppError('test');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('createErrorResponse', () => {
    it('should create response for AppError', () => {
      const error = new AppError('test error', ErrorCode.NOT_FOUND, 404);
      const response = createErrorResponse(error);
      expect(response.success).toBe(false);
      expect(response.error.code).toBe(ErrorCode.NOT_FOUND);
      expect(response.error.message).toBe('test error');
      expect(response.error.statusCode).toBe(404);
    });

    it('should create response for regular Error', () => {
      const error = new Error('generic error');
      const response = createErrorResponse(error);
      expect(response.success).toBe(false);
      expect(response.error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(response.error.message).toBe('An unexpected error occurred');
      expect(response.error.statusCode).toBe(500);
    });
  });

  describe('Specific error classes', () => {
    it('ValidationError should have 400 status', () => {
      const error = new ValidationError('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('NotFoundError should have 404 status', () => {
      const error = new NotFoundError('User', '123');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.message).toContain('User');
      expect(error.message).toContain('123');
    });

    it('NotFoundError should work without id', () => {
      const error = new NotFoundError('User');
      expect(error.message).toContain('not found');
    });

    it('UnauthorizedError should have 401 status', () => {
      const error = new UnauthorizedError();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
    });

    it('ForbiddenError should have 403 status', () => {
      const error = new ForbiddenError();
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe(ErrorCode.FORBIDDEN);
    });

    it('RateLimitError should have 429 status', () => {
      const error = new RateLimitError();
      expect(error.statusCode).toBe(429);
      expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
    });

    it('ExternalServiceError should have 503 status', () => {
      const error = new ExternalServiceError('Stripe', new Error('timeout'));
      expect(error.statusCode).toBe(503);
      expect(error.code).toBe(ErrorCode.EXTERNAL_SERVICE_ERROR);
    });

    it('TimeoutError should have 504 status', () => {
      const error = new TimeoutError('embedding', 5000);
      expect(error.statusCode).toBe(504);
      expect(error.code).toBe(ErrorCode.OPERATION_TIMEOUT);
    });
  });
});
