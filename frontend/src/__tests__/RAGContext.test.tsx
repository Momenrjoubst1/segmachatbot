import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RAGProvider, useRAGContext } from '../context/RAGContext';

describe('RAGContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RAGProvider>{children}</RAGProvider>
  );

  beforeEach(() => {
    localStorage.clear();
  });

  it('should provide default ragEnabled = true', () => {
    const { result } = renderHook(() => useRAGContext(), { wrapper });
    expect(result.current.ragEnabled).toBe(true);
  });

  it('should set ragEnabled to false', () => {
    const { result } = renderHook(() => useRAGContext(), { wrapper });
    act(() => {
      result.current.setRagEnabled(false);
    });
    expect(result.current.ragEnabled).toBe(false);
  });

  it('should toggle rag state', () => {
    const { result } = renderHook(() => useRAGContext(), { wrapper });
    expect(result.current.ragEnabled).toBe(true);
    act(() => {
      result.current.toggleRag();
    });
    expect(result.current.ragEnabled).toBe(false);
    act(() => {
      result.current.toggleRag();
    });
    expect(result.current.ragEnabled).toBe(true);
  });

  it('should persist to localStorage', () => {
    const { result } = renderHook(() => useRAGContext(), { wrapper });
    act(() => {
      result.current.setRagEnabled(false);
    });
    expect(localStorage.getItem('sigma_rag_enabled')).toBe('false');
  });

  it('should restore from localStorage', () => {
    localStorage.setItem('sigma_rag_enabled', 'false');
    const { result } = renderHook(() => useRAGContext(), { wrapper });
    expect(result.current.ragEnabled).toBe(false);
  });
});
