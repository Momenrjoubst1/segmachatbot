import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/cn', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@radix-ui/react-dropdown-menu', () => {
  const React = require('react');
  return {
    Root: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'dropdown-root', ...props }, children),
    Trigger: React.forwardRef((props: any, ref: any) => React.createElement('button', { ref, 'data-testid': 'dropdown-trigger', ...props })),
    Portal: ({ children }: any) => React.createElement('div', { 'data-testid': 'dropdown-portal' }, children),
    Content: React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement('div', { ref, 'data-testid': 'dropdown-content', role: 'menu', ...props }, children)),
    Item: React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement('div', { ref, 'data-testid': 'dropdown-item', role: 'menuitem', ...props }, children)),
    Separator: React.forwardRef((props: any, ref: any) => React.createElement('div', { ref, 'data-testid': 'dropdown-separator', role: 'separator', ...props })),
  };
});

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

describe('DropdownMenu components', () => {
  it('DropdownMenu renders as root container', () => {
    render(
      <DropdownMenu>
        <div data-testid="child">content</div>
      </DropdownMenu>
    );
    expect(screen.getByTestId('dropdown-root')).toBeInTheDocument();
  });

  it('DropdownMenuTrigger renders a button', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
      </DropdownMenu>
    );
    expect(screen.getByTestId('dropdown-trigger')).toHaveTextContent('Menu');
  });

  it('DropdownMenuContent renders with role menu', () => {
    render(
      <DropdownMenu>
        <DropdownMenuContent>
          <span>content</span>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('DropdownMenuItem renders with role menuitem', () => {
    render(
      <DropdownMenu>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    expect(screen.getByRole('menuitem')).toHaveTextContent('Item 1');
  });

  it('DropdownMenuSeparator renders with role separator', () => {
    render(
      <DropdownMenu>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Item 2</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    expect(screen.getByTestId('dropdown-separator')).toBeInTheDocument();
  });

  it('renders portal wrapper around content', () => {
    render(
      <DropdownMenu>
        <DropdownMenuContent>content</DropdownMenuContent>
      </DropdownMenu>
    );
    expect(screen.getByTestId('dropdown-portal')).toBeInTheDocument();
  });

  it('accepts custom className on DropdownMenuContent', () => {
    render(
      <DropdownMenu>
        <DropdownMenuContent className="custom-menu">content</DropdownMenuContent>
      </DropdownMenu>
    );
    expect(screen.getByTestId('dropdown-content')).toHaveAttribute('class');
  });

  it('accepts custom className on DropdownMenuItem', () => {
    render(
      <DropdownMenu>
        <DropdownMenuContent>
          <DropdownMenuItem className="custom-item">Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    expect(screen.getByTestId('dropdown-item')).toHaveAttribute('class');
  });

  it('accepts inset prop on DropdownMenuItem', () => {
    render(
      <DropdownMenu>
        <DropdownMenuContent>
          <DropdownMenuItem inset>Inset Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    expect(screen.getByTestId('dropdown-item')).toHaveTextContent('Inset Item');
  });

  it('composes all components together', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Copy</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    expect(screen.getByTestId('dropdown-separator')).toBeInTheDocument();
  });
});
