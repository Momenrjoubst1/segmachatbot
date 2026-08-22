import { describe, it, expect, vi } from 'vitest';

describe('config', () => {
  it('BACKEND_URL defaults to localhost:3004 when env var is empty', async () => {
    vi.stubEnv('VITE_BACKEND_URL', '');
    vi.resetModules();
    const { BACKEND_URL } = await import('@/lib/config');
    expect(BACKEND_URL).toBe('http://localhost:3004');
    vi.unstubAllEnvs();
  });

  it('BACKEND_URL reads from VITE_BACKEND_URL env var', async () => {
    vi.stubEnv('VITE_BACKEND_URL', 'https://custom-backend.example.com');
    vi.resetModules();
    const { BACKEND_URL } = await import('@/lib/config');
    expect(BACKEND_URL).toBe('https://custom-backend.example.com');
    vi.unstubAllEnvs();
  });

  it('PYTHON_BACKEND_URL defaults to localhost:8000 when env var is empty', async () => {
    vi.stubEnv('VITE_PYTHON_BACKEND_URL', '');
    vi.resetModules();
    const { PYTHON_BACKEND_URL } = await import('@/lib/config');
    expect(PYTHON_BACKEND_URL).toBe('http://localhost:8000');
    vi.unstubAllEnvs();
  });

  it('PYTHON_BACKEND_URL reads from VITE_PYTHON_BACKEND_URL env var', async () => {
    vi.stubEnv('VITE_PYTHON_BACKEND_URL', 'https://custom-python.example.com');
    vi.resetModules();
    const { PYTHON_BACKEND_URL } = await import('@/lib/config');
    expect(PYTHON_BACKEND_URL).toBe('https://custom-python.example.com');
    vi.unstubAllEnvs();
  });
});
