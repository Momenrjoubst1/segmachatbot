import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@radix-ui/react-collapsible', () => {
  const React = require('react');
  return {
    Root: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'collapsible-root', ...props }, children),
    CollapsibleTrigger: React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement('button', { ref, 'data-testid': 'collapsible-trigger', ...props }, children)),
    CollapsibleContent: React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement('div', { ref, 'data-testid': 'collapsible-content', ...props }, children)),
  };
});

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

describe('Collapsible components', () => {
  it('Collapsible renders as root container', () => {
    render(
      <Collapsible>
        <div data-testid="child">content</div>
      </Collapsible>
    );
    expect(screen.getByTestId('collapsible-root')).toBeInTheDocument();
  });

  it('CollapsibleTrigger renders a button', () => {
    render(
      <Collapsible>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
      </Collapsible>
    );
    expect(screen.getByTestId('collapsible-trigger')).toHaveTextContent('Toggle');
  });

  it('CollapsibleContent renders a div', () => {
    render(
      <Collapsible>
        <CollapsibleContent>
          <span>hidden content</span>
        </CollapsibleContent>
      </Collapsible>
    );
    expect(screen.getByTestId('collapsible-content')).toHaveTextContent('hidden content');
  });

  it('composes all components together', () => {
    render(
      <Collapsible>
        <CollapsibleTrigger>Show more</CollapsibleTrigger>
        <CollapsibleContent>
          <p>Extra details here</p>
        </CollapsibleContent>
      </Collapsible>
    );
    expect(screen.getByTestId('collapsible-root')).toBeInTheDocument();
    expect(screen.getByText('Show more')).toBeInTheDocument();
    expect(screen.getByText('Extra details here')).toBeInTheDocument();
  });

  it('accepts custom className on root', () => {
    render(
      <Collapsible className="my-custom-class">
        <div data-testid="child">content</div>
      </Collapsible>
    );
    expect(screen.getByTestId('collapsible-root')).toHaveAttribute('class');
  });

  it('accepts custom className on trigger', () => {
    render(
      <Collapsible>
        <CollapsibleTrigger className="trigger-class">Toggle</CollapsibleTrigger>
      </Collapsible>
    );
    expect(screen.getByTestId('collapsible-trigger')).toHaveAttribute('class');
  });

  it('accepts custom className on content', () => {
    render(
      <Collapsible>
        <CollapsibleContent className="content-class">Content</CollapsibleContent>
      </Collapsible>
    );
    expect(screen.getByTestId('collapsible-content')).toHaveAttribute('class');
  });
});
