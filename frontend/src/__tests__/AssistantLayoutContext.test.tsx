import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';

import { AssistantLayoutProvider, useAssistantLayout } from '@/features/ai-assistant/context/AssistantLayoutContext';

const defaultLayoutValue = {
  activeView: 'chat' as const,
  onToggleView: vi.fn(),
  artifactPanelOpen: false,
  setArtifactPanelOpen: vi.fn(),
  emailHistoryOpen: false,
  setEmailHistoryOpen: vi.fn(),
};

function createWrapper(overrides = {}) {
  const value = { ...defaultLayoutValue, ...overrides };
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AssistantLayoutProvider value={value}>{children}</AssistantLayoutProvider>;
  };
}

describe('AssistantLayoutContext', () => {
  it('provides context values via useAssistantLayout', () => {
    const { result } = renderHook(() => useAssistantLayout(), { wrapper: createWrapper() });
    expect(result.current.activeView).toBe('chat');
    expect(result.current.artifactPanelOpen).toBe(false);
    expect(result.current.emailHistoryOpen).toBe(false);
  });

  it('provides onToggleView function', () => {
    const { result } = renderHook(() => useAssistantLayout(), { wrapper: createWrapper() });
    expect(typeof result.current.onToggleView).toBe('function');
  });

  it('provides setArtifactPanelOpen function', () => {
    const { result } = renderHook(() => useAssistantLayout(), { wrapper: createWrapper() });
    expect(typeof result.current.setArtifactPanelOpen).toBe('function');
  });

  it('provides setEmailHistoryOpen function', () => {
    const { result } = renderHook(() => useAssistantLayout(), { wrapper: createWrapper() });
    expect(typeof result.current.setEmailHistoryOpen).toBe('function');
  });

  it('passes through custom value', () => {
    const { result } = renderHook(() => useAssistantLayout(), {
      wrapper: createWrapper({ activeView: 'calendar' as const, artifactPanelOpen: true }),
    });
    expect(result.current.activeView).toBe('calendar');
    expect(result.current.artifactPanelOpen).toBe(true);
  });

  it('throws when used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      renderHook(() => useAssistantLayout());
    }).toThrow('useAssistantLayout must be used within AssistantLayoutProvider');
    consoleSpy.mockRestore();
  });
});
