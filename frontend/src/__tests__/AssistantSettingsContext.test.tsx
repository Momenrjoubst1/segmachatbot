import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { type ReactNode } from 'react';

import { AssistantSettingsProvider, useAssistantSettings } from '@/features/ai-assistant/context/AssistantSettingsContext';

function wrapper({ children }: { children: ReactNode }) {
  return <AssistantSettingsProvider>{children}</AssistantSettingsProvider>;
}

describe('AssistantSettingsContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('provides default disable3D as false', () => {
    const { result } = renderHook(() => useAssistantSettings(), { wrapper });
    expect(result.current.disable3D).toBe(false);
  });

  it('provides toggle3D function', () => {
    const { result } = renderHook(() => useAssistantSettings(), { wrapper });
    expect(typeof result.current.toggle3D).toBe('function');
  });

  it('toggle3D toggles disable3D', () => {
    const { result } = renderHook(() => useAssistantSettings(), { wrapper });
    expect(result.current.disable3D).toBe(false);
    act(() => {
      result.current.toggle3D();
    });
    expect(result.current.disable3D).toBe(true);
    act(() => {
      result.current.toggle3D();
    });
    expect(result.current.disable3D).toBe(false);
  });

  it('persists disable3D to localStorage', () => {
    const { result } = renderHook(() => useAssistantSettings(), { wrapper });
    act(() => {
      result.current.toggle3D();
    });
    expect(localStorage.getItem('assistant_disable_3d')).toBe('true');
  });

  it('reads initial value from localStorage', () => {
    localStorage.setItem('assistant_disable_3d', 'true');
    const { result } = renderHook(() => useAssistantSettings(), { wrapper });
    expect(result.current.disable3D).toBe(true);
  });

  it('throws when used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      renderHook(() => useAssistantSettings());
    }).toThrow('useAssistantSettings must be used within AssistantSettingsProvider');
    consoleSpy.mockRestore();
  });
});
