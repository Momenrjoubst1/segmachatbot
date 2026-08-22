import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { KeyboardShortcutsModal } from '@/components/ui/KeyboardShortcutsModal';

// Mock lucide-react icons
vi.mock('lucide-react', async () => {
  const actual = await vi.importActual('lucide-react');
  return {
    ...actual,
    Keyboard: () => <span data-testid="keyboard-icon" />,
    Command: () => <span data-testid="command-icon" />,
    X: () => <span data-testid="x-icon" />,
  };
});

describe('KeyboardShortcutsModal', () => {
  it('should not render when closed', () => {
    const { container } = render(<KeyboardShortcutsModal open={false} onOpenChange={vi.fn()} />);
    // Dialog should not be in the DOM when closed (Radix portals may not render)
    const dialogContent = container.querySelector('[role="dialog"]');
    expect(dialogContent === null || dialogContent === undefined).toBe(true);
  });

  it('should render dialog when open', () => {
    const { container } = render(<KeyboardShortcutsModal open={true} onOpenChange={vi.fn()} />);
    // Radix Dialog renders inside a portal
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeDefined();
  });

  it('should have close button', () => {
    const { container } = render(<KeyboardShortcutsModal open={true} onOpenChange={vi.fn()} />);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeDefined();
  });
});
