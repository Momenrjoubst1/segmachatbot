import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoadErrorPanel } from '@/components/ui/LoadErrorPanel';
import { LoadingAnnouncer } from '@/components/ui/LoadingAnnouncer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'errors:messages_load_failed': 'Failed to load messages',
        'errors:threads_load_failed': 'Failed to load conversations',
        'errors:courses_load_failed': 'Failed to load courses',
        'errors:courses_unexpected': 'Unexpected error loading courses',
        'errors:network_unreachable': 'Cannot reach server',
        'common:retry': 'Retry',
      };
      return translations[key] ?? key;
    },
  }),
}));

describe('LoadErrorPanel', () => {
  it('renders error message for messages_load_failed', () => {
    render(<LoadErrorPanel errorCode="messages_load_failed" />);
    expect(screen.getByText('Failed to load messages')).toBeInTheDocument();
  });

  it('renders error message for network_unreachable', () => {
    render(<LoadErrorPanel errorCode="network_unreachable" />);
    expect(screen.getByText('Cannot reach server')).toBeInTheDocument();
  });

  it('has role=alert', () => {
    const { container } = render(<LoadErrorPanel errorCode="messages_load_failed" />);
    expect(container.firstChild).toHaveAttribute('role', 'alert');
  });

  it('renders retry button when onRetry provided', () => {
    const onRetry = vi.fn();
    render(<LoadErrorPanel errorCode="messages_load_failed" onRetry={onRetry} />);
    const button = screen.getByText('Retry');
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render retry button when onRetry not provided', () => {
    render(<LoadErrorPanel errorCode="messages_load_failed" />);
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<LoadErrorPanel errorCode="messages_load_failed" className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });
});

describe('LoadingAnnouncer', () => {
  it('renders empty when not busy', () => {
    const { container } = render(<LoadingAnnouncer busy={false} label="Loading content" />);
    expect(container.textContent).toBe('');
  });

  it('renders label when busy', () => {
    render(<LoadingAnnouncer busy={true} label="Loading content" />);
    expect(screen.getByText('Loading content')).toBeInTheDocument();
  });

  it('has aria-live=polite', () => {
    const { container } = render(<LoadingAnnouncer busy={true} label="Loading" />);
    expect(container.firstChild).toHaveAttribute('aria-live', 'polite');
  });

  it('has aria-atomic=true', () => {
    const { container } = render(<LoadingAnnouncer busy={true} label="Loading" />);
    expect(container.firstChild).toHaveAttribute('aria-atomic', 'true');
  });

  it('is visually hidden (sr-only)', () => {
    const { container } = render(<LoadingAnnouncer busy={true} label="Loading" />);
    expect(container.firstChild).toHaveClass('sr-only');
  });
});
