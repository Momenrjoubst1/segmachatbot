import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ConnectionContext, useConnectionContext } from '../context/ConnectionContext';

describe('ConnectionContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ConnectionContext.Provider value={{ retryMessage: vi.fn(), sendApprovalDecision: vi.fn() }}>
      {children}
    </ConnectionContext.Provider>
  );

  it('should provide context values', () => {
    const { result } = renderHook(() => useConnectionContext(), { wrapper });
    expect(result.current.retryMessage).toBeDefined();
    expect(result.current.sendApprovalDecision).toBeDefined();
  });

  it('should have default retryMessage as noop', () => {
    const { result } = renderHook(() => useConnectionContext());
    expect(typeof result.current.retryMessage).toBe('function');
  });
});
