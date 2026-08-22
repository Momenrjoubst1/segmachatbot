import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('lucide-react', () => {
  const React = require('react');
  return {
    ArrowRight: (props: any) => React.createElement('svg', { 'data-testid': 'arrow-right', ...props }),
  };
});

import { FlowButton } from '@/components/ui/flow-button';

describe('FlowButton', () => {
  it('renders a button element', () => {
    render(<FlowButton />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('displays default text when no text prop provided', () => {
    render(<FlowButton />);
    expect(screen.getByRole('button')).toHaveTextContent('Modern Button');
  });

  it('displays custom text when text prop provided', () => {
    render(<FlowButton text="Get Started" />);
    expect(screen.getByRole('button')).toHaveTextContent('Get Started');
  });

  it('renders two ArrowRight icons', () => {
    render(<FlowButton />);
    const arrows = screen.getAllByTestId('arrow-right');
    expect(arrows).toHaveLength(2);
  });

  it('has the group class for hover animations', () => {
    render(<FlowButton />);
    const button = screen.getByRole('button');
    expect(button.className).toContain('group');
  });

  it('has cursor-pointer class', () => {
    render(<FlowButton />);
    const button = screen.getByRole('button');
    expect(button.className).toContain('cursor-pointer');
  });

  it('accepts empty string text', () => {
    render(<FlowButton text="" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
