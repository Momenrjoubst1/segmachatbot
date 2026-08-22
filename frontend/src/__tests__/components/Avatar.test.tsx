import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/cn', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@radix-ui/react-avatar', () => {
  const React = require('react');
  return {
    Root: React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement('div', { ref, 'data-testid': 'avatar-root', ...props }, children)),
    Image: React.forwardRef(({ src, alt, ...props }: any, ref: any) => React.createElement('img', { ref, 'data-testid': 'avatar-image', src, alt, ...props })),
    Fallback: React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement('span', { ref, 'data-testid': 'avatar-fallback', ...props }, children)),
  };
});

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

describe('Avatar components', () => {
  it('Avatar renders as root container', () => {
    render(
      <Avatar>
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>
    );
    expect(screen.getByTestId('avatar-root')).toBeInTheDocument();
  });

  it('AvatarImage renders an img element', () => {
    render(
      <Avatar>
        <AvatarImage src="https://example.com/avatar.png" alt="User avatar" />
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>
    );
    const img = screen.getByTestId('avatar-image');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.png');
    expect(img).toHaveAttribute('alt', 'User avatar');
  });

  it('AvatarFallback renders fallback text', () => {
    render(
      <Avatar>
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>
    );
    expect(screen.getByTestId('avatar-fallback')).toHaveTextContent('JD');
  });

  it('all components compose together', () => {
    render(
      <Avatar>
        <AvatarImage src="https://example.com/pic.jpg" alt="Profile" />
        <AvatarFallback>U</AvatarFallback>
      </Avatar>
    );
    expect(screen.getByTestId('avatar-root')).toBeInTheDocument();
    expect(screen.getByTestId('avatar-image')).toHaveAttribute('src', 'https://example.com/pic.jpg');
    expect(screen.getByTestId('avatar-fallback')).toHaveTextContent('U');
  });

  it('Avatar accepts custom className', () => {
    render(
      <Avatar className="custom-class">
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>
    );
    expect(screen.getByTestId('avatar-root').className).toContain('custom-class');
  });

  it('AvatarImage accepts custom className', () => {
    render(
      <Avatar>
        <AvatarImage src="test.jpg" alt="test" className="img-custom" />
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>
    );
    expect(screen.getByTestId('avatar-image').className).toContain('img-custom');
  });

  it('AvatarFallback accepts custom className', () => {
    render(
      <Avatar>
        <AvatarFallback className="fb-custom">AB</AvatarFallback>
      </Avatar>
    );
    expect(screen.getByTestId('avatar-fallback').className).toContain('fb-custom');
  });
});
