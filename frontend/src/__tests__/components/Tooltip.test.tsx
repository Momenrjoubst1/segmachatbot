import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/cn', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@radix-ui/react-tooltip', () => {
  const React = require('react');
  return {
    Provider: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'tooltip-provider', ...props }, children),
    Root: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'tooltip-root', ...props }, children),
    Trigger: React.forwardRef((props: any, ref: any) => React.createElement('button', { ref, 'data-testid': 'tooltip-trigger', ...props })),
    Portal: ({ children }: any) => React.createElement('div', { 'data-testid': 'tooltip-portal' }, children),
    Content: React.forwardRef(({ children, sideOffset, ...props }: any, ref: any) => React.createElement('div', { ref, 'data-testid': 'tooltip-content', ...props }, children)),
  };
});

import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

describe('Tooltip components', () => {
  it('TooltipProvider renders as container', () => {
    render(
      <TooltipProvider>
        <div data-testid="child">content</div>
      </TooltipProvider>
    );
    expect(screen.getByTestId('tooltip-provider')).toBeInTheDocument();
  });

  it('Tooltip renders as root container', () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <div data-testid="child">content</div>
        </Tooltip>
      </TooltipProvider>
    );
    expect(screen.getByTestId('tooltip-root')).toBeInTheDocument();
  });

  it('TooltipTrigger renders a button', () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
        </Tooltip>
      </TooltipProvider>
    );
    expect(screen.getByTestId('tooltip-trigger')).toHaveTextContent('Hover me');
  });

  it('TooltipContent renders content', () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    expect(screen.getByTestId('tooltip-content')).toHaveTextContent('Tooltip text');
  });

  it('all components compose together', () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Trigger</TooltipTrigger>
          <TooltipContent>Helpful tip</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    expect(screen.getByTestId('tooltip-provider')).toBeInTheDocument();
    expect(screen.getByTestId('tooltip-trigger')).toHaveTextContent('Trigger');
    expect(screen.getByTestId('tooltip-content')).toHaveTextContent('Helpful tip');
  });
});
