import { describe, it, expect } from 'vitest';
import {
  PermanentJobError,
  TransientJobError,
  sanitizeErrorMessage,
  userFacingError,
} from '../services/textbook/errors.js';

describe('PermanentJobError', () => {
  it('is an instance of Error', () => {
    const err = new PermanentJobError('corrupt PDF');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name "PermanentJobError"', () => {
    const err = new PermanentJobError('bad file');
    expect(err.name).toBe('PermanentJobError');
  });

  it('stores message', () => {
    const err = new PermanentJobError('missing source');
    expect(err.message).toBe('missing source');
  });

  it('stores optional userMessage', () => {
    const err = new PermanentJobError('internal', 'Please upload a valid file');
    expect(err.userMessage).toBe('Please upload a valid file');
  });

  it('userMessage is undefined when not provided', () => {
    const err = new PermanentJobError('fail');
    expect(err.userMessage).toBeUndefined();
  });
});

describe('TransientJobError', () => {
  it('is an instance of Error', () => {
    const err = new TransientJobError('timeout');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name "TransientJobError"', () => {
    const err = new TransientJobError('network blip');
    expect(err.name).toBe('TransientJobError');
  });

  it('stores message', () => {
    const err = new TransientJobError('500 from server');
    expect(err.message).toBe('500 from server');
  });
});

describe('sanitizeErrorMessage', () => {
  it('returns message from Error instances', () => {
    expect(sanitizeErrorMessage(new Error('something broke'))).toBe('something broke');
  });

  it('converts non-Error to string', () => {
    expect(sanitizeErrorMessage('raw string')).toBe('raw string');
  });

  it('converts number to string', () => {
    expect(sanitizeErrorMessage(42)).toBe('42');
  });

  it('replaces Windows paths with [path]', () => {
    const msg = 'File not found at C:\\Users\\test\\file.txt';
    expect(sanitizeErrorMessage(new Error(msg))).toContain('[path]');
  });

  it('replaces POSIX paths with [path]', () => {
    const msg = 'File not found at /home/user/file.txt';
    expect(sanitizeErrorMessage(new Error(msg))).toContain('[path]');
  });

  it('strips "Error: " prefix', () => {
    const msg = 'Error: something went wrong';
    expect(sanitizeErrorMessage(new Error(msg))).toBe('something went wrong');
  });

  it('truncates to 200 characters', () => {
    const longMsg = 'x'.repeat(300);
    expect(sanitizeErrorMessage(new Error(longMsg)).length).toBe(200);
  });
});

describe('userFacingError', () => {
  it('returns userMessage when present on PermanentJobError', () => {
    const err = new PermanentJobError('internal', 'Please check your file');
    expect(userFacingError(err)).toBe('Please check your file');
  });

  it('falls back to sanitized message when no userMessage', () => {
    const err = new PermanentJobError('corrupt data');
    expect(userFacingError(err)).toBe('corrupt data');
  });

  it('returns sanitized message for TransientJobError', () => {
    const err = new TransientJobError('timeout');
    expect(userFacingError(err)).toBe('timeout');
  });

  it('returns sanitized message for plain Error', () => {
    const err = new Error('generic error');
    expect(userFacingError(err)).toBe('generic error');
  });

  it('returns sanitized string for non-Error values', () => {
    expect(userFacingError('something')).toBe('something');
  });
});
