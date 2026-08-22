/**
 * Standardized Error Handler
 * معالج أخطاء موحد
 * 
 * Provides consistent error handling patterns across the application
 * Standardizes error responses, logging, and error types
 */

import { Request, Response, NextFunction } from "express";
import { createLogger } from './logger.js';

const log = createLogger('error-handler');

export enum ErrorCode {
  // Authentication & Authorization
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_TOKEN = 'INVALID_TOKEN',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  
  // Validation
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  
  // Resources
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // External Services
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  AI_PROVIDER_ERROR = 'AI_PROVIDER_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  REDIS_ERROR = 'REDIS_ERROR',
  EMBEDDING_MODEL_LOAD_FAILED = 'EMBEDDING_MODEL_LOAD_FAILED',
  
  // Business Logic
  INVALID_OPERATION = 'INVALID_OPERATION',
  OPERATION_TIMEOUT = 'OPERATION_TIMEOUT',
  
  // Generic
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    statusCode: number = 500,
    isOperational: boolean = true,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Create a standardized error response object
 */
export function createErrorResponse(error: Error | AppError) {
  if (error instanceof AppError) {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
        context: error.context,
      },
    };
  }

  // Handle unknown errors
  log.error('Unhandled error', { error: error.message, stack: error.stack });
  
  return {
    success: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
      statusCode: 500,
    },
  };
}

/**
 * Central error logging
 */
export function logError(error: Error | AppError, context?: Record<string, unknown>): void {
  if (error instanceof AppError) {
    if (error.isOperational) {
      log.warn(`Operational error: ${error.code}`, { 
        message: error.message, 
        context: { ...error.context, ...context } 
      });
    } else {
      log.error(`Non-operational error: ${error.code}`, { 
        message: error.message, 
        stack: error.stack,
        context: { ...error.context, ...context } 
      });
    }
  } else {
    log.error('Unknown error', { 
      message: error.message, 
      stack: error.stack,
      context 
    });
  }
}

/**
 * Specific error constructors for common cases
 */
export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, ErrorCode.VALIDATION_ERROR, 400, true, context);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      `${resource}${id ? ` with id ${id}` : ''} not found`,
      ErrorCode.NOT_FOUND,
      404,
      true,
      { resource, id }
    );
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized access') {
    super(message, ErrorCode.UNAUTHORIZED, 401, true);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Access forbidden') {
    super(message, ErrorCode.FORBIDDEN, 403, true);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, ErrorCode.RATE_LIMIT_EXCEEDED, 429, true);
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, originalError?: Error) {
    super(
      `External service ${service} failed`,
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      503,
      true,
      { service, originalError: originalError?.message }
    );
  }
}

export class TimeoutError extends AppError {
  constructor(operation: string, timeoutMs: number) {
    super(
      `Operation ${operation} timed out after ${timeoutMs}ms`,
      ErrorCode.OPERATION_TIMEOUT,
      504,
      true,
      { operation, timeoutMs }
    );
  }
}