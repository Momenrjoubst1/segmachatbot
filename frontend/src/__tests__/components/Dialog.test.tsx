import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/cn', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@radix-ui/react-dialog', () => {
  const React = require('react');
  return {
    Root: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'dialog-root', ...props }, children),
    Trigger: React.forwardRef((props: any, ref: any) => React.createElement('button', { ref, 'data-testid': 'dialog-trigger', ...props })),
    Portal: ({ children }: any) => React.createElement('div', { 'data-testid': 'dialog-portal' }, children),
    Overlay: React.forwardRef((props: any, ref: any) => React.createElement('div', { ref, 'data-testid': 'dialog-overlay', ...props })),
    Content: React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement('div', { ref, 'data-testid': 'dialog-content', role: 'dialog', ...props }, children)),
    Title: React.forwardRef((props: any, ref: any) => React.createElement('h2', { ref, 'data-testid': 'dialog-title', ...props })),
    Description: React.forwardRef((props: any, ref: any) => React.createElement('p', { ref, 'data-testid': 'dialog-description', ...props })),
    Close: React.forwardRef((props: any, ref: any) => React.createElement('button', { ref, 'data-testid': 'dialog-close', ...props })),
  };
});

import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

describe('Dialog components', () => {
  it('Dialog renders as root container', () => {
    render(
      <Dialog>
        <div data-testid="child">content</div>
      </Dialog>
    );
    expect(screen.getByTestId('dialog-root')).toBeInTheDocument();
  });

  it('DialogTrigger renders a button', () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
      </Dialog>
    );
    expect(screen.getByTestId('dialog-trigger')).toHaveTextContent('Open');
  });

  it('DialogContent renders dialog content with role', () => {
    render(
      <Dialog>
        <DialogContent>
          <span>content text</span>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('content text')).toBeInTheDocument();
  });

  it('DialogHeader renders a div', () => {
    render(
      <Dialog>
        <DialogContent>
          <DialogHeader data-testid="header">
            <span>header text</span>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByTestId('header')).toHaveTextContent('header text');
  });

  it('DialogTitle renders text', () => {
    render(
      <Dialog>
        <DialogContent>
          <DialogTitle>My Title</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByTestId('dialog-title')).toHaveTextContent('My Title');
  });

  it('DialogDescription renders text', () => {
    render(
      <Dialog>
        <DialogContent>
          <DialogDescription>My Description</DialogDescription>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByTestId('dialog-description')).toHaveTextContent('My Description');
  });

  it('DialogFooter renders a div', () => {
    render(
      <Dialog>
        <DialogContent>
          <DialogFooter data-testid="footer">
            <span>footer text</span>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByTestId('footer')).toHaveTextContent('footer text');
  });

  it('DialogClose renders a close button', () => {
    render(
      <Dialog>
        <DialogContent>
          <DialogClose data-testid="explicit-close">Close</DialogClose>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByTestId('explicit-close')).toHaveTextContent('Close');
  });

  it('all components can be composed together', () => {
    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test Dialog</DialogTitle>
            <DialogDescription>A test description</DialogDescription>
          </DialogHeader>
          <div>Body content</div>
          <DialogFooter data-testid="footer">
            <span>Footer content</span>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByText('Open Dialog')).toBeInTheDocument();
    expect(screen.getByTestId('dialog-title')).toHaveTextContent('Test Dialog');
    expect(screen.getByTestId('dialog-description')).toHaveTextContent('A test description');
    expect(screen.getByText('Body content')).toBeInTheDocument();
    expect(screen.getByTestId('footer')).toBeInTheDocument();
  });
});
