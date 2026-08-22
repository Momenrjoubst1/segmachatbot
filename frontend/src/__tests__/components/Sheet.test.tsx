import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/cn', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@radix-ui/react-dialog', () => {
  const React = require('react');
  return {
    Root: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'sheet-root', ...props }, children),
    Trigger: React.forwardRef((props: any, ref: any) => React.createElement('button', { ref, 'data-testid': 'sheet-trigger', ...props })),
    Portal: ({ children }: any) => React.createElement('div', { 'data-testid': 'sheet-portal' }, children),
    Overlay: React.forwardRef((props: any, ref: any) => React.createElement('div', { ref, 'data-testid': 'sheet-overlay', ...props })),
    Content: React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement('div', { ref, 'data-testid': 'sheet-content', role: 'dialog', ...props }, children)),
    Title: React.forwardRef((props: any, ref: any) => React.createElement('h2', { ref, 'data-testid': 'sheet-title', ...props })),
    Description: React.forwardRef((props: any, ref: any) => React.createElement('p', { ref, 'data-testid': 'sheet-description', ...props })),
    Close: React.forwardRef((props: any, ref: any) => React.createElement('button', { ref, 'data-testid': 'sheet-close', ...props })),
  };
});

vi.mock('lucide-react', () => {
  const React = require('react');
  return {
    X: (props: any) => React.createElement('svg', { 'data-testid': 'icon-x', ...props }),
  };
});

import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from '@/components/ui/sheet';

describe('Sheet components', () => {
  it('Sheet renders as root container', () => {
    render(
      <Sheet>
        <div data-testid="child">content</div>
      </Sheet>
    );
    expect(screen.getByTestId('sheet-root')).toBeInTheDocument();
  });

  it('SheetTrigger renders a button', () => {
    render(
      <Sheet>
        <SheetTrigger>Open Sheet</SheetTrigger>
      </Sheet>
    );
    expect(screen.getByTestId('sheet-trigger')).toHaveTextContent('Open Sheet');
  });

  it('SheetContent renders with role dialog', () => {
    render(
      <Sheet>
        <SheetContent>
          <span>sheet body</span>
        </SheetContent>
      </Sheet>
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('sheet body')).toBeInTheDocument();
  });

  it('SheetHeader renders a div', () => {
    render(
      <Sheet>
        <SheetContent>
          <SheetHeader data-testid="header">
            <span>header text</span>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
    expect(screen.getByTestId('header')).toHaveTextContent('header text');
  });

  it('SheetTitle renders text', () => {
    render(
      <Sheet>
        <SheetContent>
          <SheetTitle>My Sheet Title</SheetTitle>
        </SheetContent>
      </Sheet>
    );
    expect(screen.getByTestId('sheet-title')).toHaveTextContent('My Sheet Title');
  });

  it('SheetDescription renders text', () => {
    render(
      <Sheet>
        <SheetContent>
          <SheetDescription>Sheet description text</SheetDescription>
        </SheetContent>
      </Sheet>
    );
    expect(screen.getByTestId('sheet-description')).toHaveTextContent('Sheet description text');
  });

  it('SheetFooter renders a div', () => {
    render(
      <Sheet>
        <SheetContent>
          <SheetFooter data-testid="footer">
            <span>footer content</span>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
    expect(screen.getByTestId('footer')).toHaveTextContent('footer content');
  });

  it('SheetClose renders a close button', () => {
    render(
      <Sheet>
        <SheetContent>
          <SheetClose data-testid="explicit-close">Close</SheetClose>
        </SheetContent>
      </Sheet>
    );
    expect(screen.getByTestId('explicit-close')).toHaveTextContent('Close');
  });

  it('all components compose together', () => {
    render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Test Sheet</SheetTitle>
            <SheetDescription>A test description</SheetDescription>
          </SheetHeader>
          <div>Body</div>
          <SheetFooter data-testid="footer">
            <span>Footer</span>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByTestId('sheet-title')).toHaveTextContent('Test Sheet');
    expect(screen.getByTestId('sheet-description')).toHaveTextContent('A test description');
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByTestId('footer')).toBeInTheDocument();
  });

  it('SheetContent renders portal and overlay', () => {
    render(
      <Sheet>
        <SheetContent>content</SheetContent>
      </Sheet>
    );
    expect(screen.getByTestId('sheet-portal')).toBeInTheDocument();
    expect(screen.getByTestId('sheet-overlay')).toBeInTheDocument();
  });

  it('accepts custom className on SheetContent', () => {
    render(
      <Sheet>
        <SheetContent className="custom-sheet">content</SheetContent>
      </Sheet>
    );
    const content = screen.getByTestId('sheet-content');
    expect(content).toHaveAttribute('class');
  });

  it('accepts side prop on SheetContent', () => {
    render(
      <Sheet>
        <SheetContent side="left">content</SheetContent>
      </Sheet>
    );
    expect(screen.getByTestId('sheet-content')).toBeInTheDocument();
  });
});
