import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TopLoadingBar } from '@/components/ui/TopLoadingBar';

describe('TopLoadingBar', () => {
  it('renders a progressbar element', () => {
    render(<TopLoadingBar />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toBeInTheDocument();
  });

  it('has aria-valuetext "Loading messages"', () => {
    render(<TopLoadingBar />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuetext', 'Loading messages');
  });

  it('has absolute positioning at top', () => {
    render(<TopLoadingBar />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.className).toContain('absolute');
    expect(progressbar.className).toContain('top-0');
  });

  it('contains an inner animated bar', () => {
    const { container } = render(<TopLoadingBar />);
    const innerDiv = container.querySelector('.origin-left');
    expect(innerDiv).toBeInTheDocument();
  });

  it('has animation style on inner bar', () => {
    const { container } = render(<TopLoadingBar />);
    const innerDiv = container.querySelector('.origin-left');
    expect(innerDiv).toHaveStyle({ animation: 'loading-bar 1.5s ease-in-out infinite' });
  });
});
