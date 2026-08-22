import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/cn', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

import { ChatIcon } from '@/components/ui/chat-icon';

describe('ChatIcon', () => {
  it('renders an svg element', () => {
    const { container } = render(<ChatIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('has correct viewBox attribute', () => {
    const { container } = render(<ChatIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it('renders three circle elements for chat dots', () => {
    const { container } = render(<ChatIcon />);
    const circles = container.querySelectorAll('circle');
    expect(circles).toHaveLength(3);
  });

  it('renders the chat bubble path', () => {
    const { container } = render(<ChatIcon />);
    const path = container.querySelector('path');
    expect(path).toBeInTheDocument();
    expect(path).toHaveAttribute('stroke', 'black');
  });

  it('applies animated class when animated prop is true', () => {
    const { container } = render(<ChatIcon animated />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('chat-icon-float');
  });

  it('does not apply animated class when animated prop is false', () => {
    const { container } = render(<ChatIcon animated={false} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).not.toContain('chat-icon-float');
  });

  it('does not apply animated class by default', () => {
    const { container } = render(<ChatIcon />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).not.toContain('chat-icon-float');
  });

  it('accepts custom className', () => {
    const { container } = render(<ChatIcon className="my-icon" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('my-icon');
  });

  it('forwards additional SVG props', () => {
    render(<ChatIcon data-testid="custom-chat-icon" width={32} height={32} />);
    const svg = screen.getByTestId('custom-chat-icon');
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
  });

  it('combines animated and custom className', () => {
    const { container } = render(<ChatIcon animated className="extra" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('chat-icon-float');
    expect(svg?.getAttribute('class')).toContain('extra');
  });
});
