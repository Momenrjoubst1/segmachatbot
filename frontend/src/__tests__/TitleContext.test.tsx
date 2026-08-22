import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TitleProvider, useTitle } from '../context/TitleContext';

describe('TitleContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TitleProvider>{children}</TitleProvider>
  );

  it('should provide default title "Sigma AI"', () => {
    const { result } = renderHook(() => useTitle(), { wrapper });
    expect(result.current.baseTitle).toBe('Sigma AI');
  });

  it('should update title', () => {
    const { result } = renderHook(() => useTitle(), { wrapper });
    act(() => {
      result.current.setBaseTitle('New Title');
    });
    expect(result.current.baseTitle).toBe('New Title');
  });

  it('should throw when used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      renderHook(() => useTitle());
    }).toThrow('useTitle must be used within TitleProvider');
    consoleSpy.mockRestore();
  });
});
