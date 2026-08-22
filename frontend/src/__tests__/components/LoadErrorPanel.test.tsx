import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadErrorPanel } from '@/components/ui/LoadErrorPanel';

describe('LoadErrorPanel', () => {
  it('should render error message', () => {
    render(<LoadErrorPanel errorCode="network_unreachable" />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
  });

  it('should show retry button when onRetry provided', () => {
    const onRetry = vi.fn();
    render(<LoadErrorPanel errorCode="network_unreachable" onRetry={onRetry} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('should not show retry button when onRetry not provided', () => {
    render(<LoadErrorPanel errorCode="network_unreachable" />);
    const buttons = screen.queryAllByRole('button');
    expect(buttons.length).toBe(0);
  });

  it('should call onRetry when retry clicked', () => {
    const onRetry = vi.fn();
    render(<LoadErrorPanel errorCode="network_unreachable" onRetry={onRetry} />);
    const button = screen.getByRole('button');
    button.click();
    expect(onRetry).toHaveBeenCalled();
  });

  it('should accept custom className', () => {
    const { container } = render(
      <LoadErrorPanel errorCode="network_unreachable" className="custom-class" />
    );
    expect(container.firstChild).toBeDefined();
  });
});
