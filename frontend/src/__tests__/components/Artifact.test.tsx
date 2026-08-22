import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/cn', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/ui/button', () => {
  const React = require('react');
  return {
    Button: React.forwardRef(({ children, ...props }: any, ref: any) =>
      React.createElement('button', { ref, ...props }, children)
    ),
  };
});

vi.mock('@/components/ui/tooltip', () => {
  const React = require('react');
  return {
    TooltipProvider: ({ children }: any) => React.createElement('div', null, children),
    Tooltip: ({ children }: any) => React.createElement('div', null, children),
    TooltipTrigger: React.forwardRef(({ children, ...props }: any, ref: any) =>
      React.createElement('button', { ref, ...props }, children)
    ),
    TooltipContent: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'tooltip-content', ...props }, children),
  };
});

vi.mock('lucide-react', () => {
  const React = require('react');
  return {
    XIcon: (props: any) => React.createElement('svg', { 'data-testid': 'icon-x', ...props }),
  };
});

import {
  Artifact,
  ArtifactHeader,
  ArtifactTitle,
  ArtifactDescription,
  ArtifactActions,
  ArtifactAction,
  ArtifactContent,
  ArtifactClose,
} from '@/components/ui/artifact';

describe('Artifact components', () => {
  it('Artifact renders a div', () => {
    render(
      <Artifact data-testid="artifact">
        <span>content</span>
      </Artifact>
    );
    expect(screen.getByTestId('artifact')).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('Artifact accepts custom className', () => {
    render(<Artifact data-testid="artifact" className="custom-artifact" />);
    expect(screen.getByTestId('artifact').className).toContain('custom-artifact');
  });

  it('ArtifactHeader renders a div', () => {
    render(
      <ArtifactHeader data-testid="header">
        <span>header content</span>
      </ArtifactHeader>
    );
    expect(screen.getByTestId('header')).toHaveTextContent('header content');
  });

  it('ArtifactTitle renders a paragraph', () => {
    render(<ArtifactTitle data-testid="title">My Title</ArtifactTitle>);
    expect(screen.getByTestId('title')).toHaveTextContent('My Title');
  });

  it('ArtifactDescription renders a paragraph', () => {
    render(<ArtifactDescription data-testid="desc">Description text</ArtifactDescription>);
    expect(screen.getByTestId('desc')).toHaveTextContent('Description text');
  });

  it('ArtifactActions renders a div', () => {
    render(
      <ArtifactActions data-testid="actions">
        <span>action</span>
      </ArtifactActions>
    );
    expect(screen.getByTestId('actions')).toHaveTextContent('action');
  });

  it('ArtifactContent renders a div', () => {
    render(
      <ArtifactContent data-testid="content">
        <p>body content</p>
      </ArtifactContent>
    );
    expect(screen.getByTestId('content')).toHaveTextContent('body content');
  });

  it('ArtifactClose renders a button with X icon by default', () => {
    render(<ArtifactClose data-testid="close-btn" />);
    const btn = screen.getByTestId('close-btn');
    expect(btn).toBeInTheDocument();
    expect(screen.getByTestId('icon-x')).toBeInTheDocument();
  });

  it('ArtifactClose renders custom children instead of default X', () => {
    render(
      <ArtifactClose data-testid="close-btn">
        <span>Custom Close</span>
      </ArtifactClose>
    );
    expect(screen.getByText('Custom Close')).toBeInTheDocument();
    expect(screen.queryByTestId('icon-x')).not.toBeInTheDocument();
  });

  it('ArtifactAction renders a button', () => {
    render(<ArtifactAction data-testid="action-btn" label="Copy" />);
    expect(screen.getByTestId('action-btn')).toBeInTheDocument();
  });

  it('ArtifactAction with icon renders the icon', () => {
    const React = require('react');
    const MockIcon: any = (props: any) => React.createElement('svg', { 'data-testid': 'mock-icon', ...props });
    render(<ArtifactAction data-testid="action-btn" icon={MockIcon} label="Action" />);
    expect(screen.getByTestId('mock-icon')).toBeInTheDocument();
  });

  it('ArtifactAction with tooltip wraps in tooltip components', () => {
    render(<ArtifactAction data-testid="action-btn" tooltip="Copy to clipboard" label="Copy" />);
    expect(screen.getByTestId('action-btn')).toBeInTheDocument();
  });

  it('ArtifactAction without tooltip renders button directly', () => {
    render(<ArtifactAction data-testid="action-btn" label="Simple action" />);
    expect(screen.getByTestId('action-btn')).toBeInTheDocument();
  });

  it('composes all components together', () => {
    render(
      <Artifact data-testid="artifact">
        <ArtifactHeader>
          <ArtifactTitle>File Title</ArtifactTitle>
          <ArtifactDescription>A file description</ArtifactDescription>
          <ArtifactActions>
            <ArtifactAction data-testid="copy-action" label="Copy" />
            <ArtifactClose data-testid="close-action" />
          </ArtifactActions>
        </ArtifactHeader>
        <ArtifactContent>
          <p>File content goes here</p>
        </ArtifactContent>
      </Artifact>
    );
    expect(screen.getByTestId('artifact')).toBeInTheDocument();
    expect(screen.getByText('File Title')).toBeInTheDocument();
    expect(screen.getByText('A file description')).toBeInTheDocument();
    expect(screen.getByTestId('copy-action')).toBeInTheDocument();
    expect(screen.getByTestId('close-action')).toBeInTheDocument();
    expect(screen.getByText('File content goes here')).toBeInTheDocument();
  });
});
