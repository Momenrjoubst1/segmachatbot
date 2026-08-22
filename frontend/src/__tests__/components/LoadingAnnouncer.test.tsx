import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LoadingAnnouncer } from '@/components/ui/LoadingAnnouncer';

describe('LoadingAnnouncer', () => {
  it('should render with sr-only class when busy', () => {
    const { container } = render(<LoadingAnnouncer busy={true} label="Loading content" />);
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toBeDefined();
  });

  it('should show label when busy', () => {
    const { container } = render(<LoadingAnnouncer busy={true} label="Loading content" />);
    const region = container.querySelector('[aria-live="polite"]');
    expect(region?.textContent).toBe('Loading content');
  });

  it('should show empty when not busy', () => {
    const { container } = render(<LoadingAnnouncer busy={false} label="Loading content" />);
    const region = container.querySelector('[aria-live="polite"]');
    expect(region?.textContent).toBe('');
  });

  it('should have aria-atomic attribute', () => {
    const { container } = render(<LoadingAnnouncer busy={true} label="Loading" />);
    const region = container.querySelector('[aria-atomic="true"]');
    expect(region).toBeDefined();
  });

  it('should have sr-only class', () => {
    const { container } = render(<LoadingAnnouncer busy={true} label="Loading" />);
    const region = container.querySelector('.sr-only');
    expect(region).toBeDefined();
  });
});
