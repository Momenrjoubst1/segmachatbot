import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register keydown listener', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    renderHook(() => useKeyboardShortcuts({ 'ctrl+k': vi.fn() }));
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    addSpy.mockRestore();
  });

  it('should clean up listener on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useKeyboardShortcuts({ 'ctrl+k': vi.fn() }));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    removeSpy.mockRestore();
  });

  it('should call handler on matching key combo', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts({ 'ctrl+k': handler }));

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
    });
    document.dispatchEvent(event);

    expect(handler).toHaveBeenCalled();
  });

  it('should not call handler for non-matching key', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts({ 'ctrl+k': handler }));

    const event = new KeyboardEvent('keydown', {
      key: 'j',
      ctrlKey: true,
    });
    document.dispatchEvent(event);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should handle shift modifier', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts({ 'ctrl+shift+c': handler }));

    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      shiftKey: true,
    });
    document.dispatchEvent(event);

    expect(handler).toHaveBeenCalled();
  });

  it('should not trigger in input fields', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts({ 'ctrl+k': handler }));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
    });
    input.dispatchEvent(event);

    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
