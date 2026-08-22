import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SendStateProvider, useSendState } from '../context/SendStateContext';

// Mock the bridge
vi.mock('../context/sendStateBridge', () => ({
  registerSendStateBridge: vi.fn(),
  unregisterSendStateBridge: vi.fn(),
}));

describe('SendStateContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SendStateProvider>{children}</SendStateProvider>
  );

  it('should start with idle state', () => {
    const { result } = renderHook(() => useSendState(), { wrapper });
    expect(result.current.sendState).toBe('idle');
  });

  it('should set submitting state', () => {
    const { result } = renderHook(() => useSendState(), { wrapper });
    act(() => {
      result.current.setSubmitting();
    });
    expect(result.current.sendState).toBe('submitting');
  });

  it('should set streaming state', () => {
    const { result } = renderHook(() => useSendState(), { wrapper });
    act(() => {
      result.current.setStreaming();
    });
    expect(result.current.sendState).toBe('streaming');
  });

  it('should set idle state from submitting', () => {
    const { result } = renderHook(() => useSendState(), { wrapper });
    act(() => {
      result.current.setSubmitting();
    });
    expect(result.current.sendState).toBe('submitting');
    act(() => {
      result.current.setIdle();
    });
    expect(result.current.sendState).toBe('idle');
  });

  it('should throw when used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      renderHook(() => useSendState());
    }).toThrow('useSendState must be used within SendStateProvider');
    consoleSpy.mockRestore();
  });
});
