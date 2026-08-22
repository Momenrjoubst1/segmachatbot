import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery } from '../hooks/useMediaQuery';

describe('useMediaQuery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return false when no match', () => {
    (window.matchMedia as any).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useMediaQuery('(min-width: 9999px)'));
    expect(result.current).toBe(false);
  });

  it('should return true when matches', () => {
    (window.matchMedia as any).mockImplementation((query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useMediaQuery('(min-width: 0px)'));
    expect(result.current).toBe(true);
  });

  it('should update when media query changes via addEventListener', () => {
    let changeCb: ((event: MediaQueryListEvent) => void) | undefined;
    (window.matchMedia as any).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn((event: string, cb: any) => {
        if (event === 'change') {
          changeCb = cb;
        }
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(false);

    // Simulate media query change
    act(() => {
      if (changeCb) {
        changeCb({ matches: true } as MediaQueryListEvent);
      }
    });
    expect(result.current).toBe(true);
  });
});
