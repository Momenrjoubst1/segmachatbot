import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import {
  LoadingSpinner,
  LoadingOverlay,
  LoadingCard,
  MessageSkeleton,
  ChatSkeleton,
  CompactSkeleton,
} from '@/components/ui/LoadingStates';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

describe('LoadingStates', () => {
  describe('LoadingSpinner', () => {
    it('renders with default size', () => {
      const { container } = render(<LoadingSpinner />);
      expect(container.firstChild).toBeInTheDocument();
    });

    it('renders with sm size', () => {
      const { container } = render(<LoadingSpinner size="sm" />);
      expect(container.firstChild).toHaveClass('h-4', 'w-4', 'border-2');
    });

    it('renders with md size', () => {
      const { container } = render(<LoadingSpinner size="md" />);
      expect(container.firstChild).toHaveClass('h-8', 'w-8', 'border-3');
    });

    it('renders with lg size', () => {
      const { container } = render(<LoadingSpinner size="lg" />);
      expect(container.firstChild).toHaveClass('h-12', 'w-12', 'border-4');
    });

    it('applies custom className', () => {
      const { container } = render(<LoadingSpinner className="my-custom-class" />);
      expect(container.firstChild).toHaveClass('my-custom-class');
    });
  });

  describe('LoadingOverlay', () => {
    it('renders spinner', () => {
      const { container } = render(<LoadingOverlay />);
      expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('renders message when provided', () => {
      render(<LoadingOverlay message="Please wait..." />);
      expect(screen.getByText('Please wait...')).toBeInTheDocument();
    });

    it('does not render message when not provided', () => {
      const { container } = render(<LoadingOverlay />);
      const p = container.querySelector('p');
      expect(p).toBeNull();
    });

    it('applies custom className', () => {
      const { container } = render(<LoadingOverlay className="custom-overlay" />);
      expect(container.firstChild).toHaveClass('custom-overlay');
    });
  });

  describe('LoadingCard', () => {
    it('renders default message', () => {
      render(<LoadingCard />);
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('renders custom message', () => {
      render(<LoadingCard message="Fetching data..." />);
      expect(screen.getByText('Fetching data...')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(<LoadingCard className="custom-card" />);
      expect(container.firstChild).toHaveClass('custom-card');
    });
  });

  describe('MessageSkeleton', () => {
    it('renders the skeleton layout', () => {
      const { container } = render(<MessageSkeleton />);
      expect(container.querySelector('[dir="ltr"]')).toBeInTheDocument();
    });

    it('renders user and assistant skeleton sections', () => {
      const { container } = render(<MessageSkeleton />);
      const divs = container.querySelectorAll('.animate-pulse');
      expect(divs.length).toBeGreaterThan(0);
    });

    it('renders thinking text', () => {
      render(<MessageSkeleton />);
      expect(screen.getByText('Thinking...')).toBeInTheDocument();
    });
  });

  describe('ChatSkeleton', () => {
    it('renders three message skeletons', () => {
      const { container } = render(<ChatSkeleton />);
      const avatars = container.querySelectorAll('.h-10.w-10.rounded-full');
      expect(avatars).toHaveLength(3);
    });

    it('renders alternating alignment', () => {
      const { container } = render(<ChatSkeleton />);
      const reversed = container.querySelectorAll('.flex-row-reverse');
      expect(reversed.length).toBeGreaterThan(0);
    });
  });

  describe('CompactSkeleton', () => {
    it('renders message bubbles', () => {
      const { container } = render(<CompactSkeleton />);
      const bubbles = container.querySelectorAll('.h-9.rounded-2xl');
      expect(bubbles).toHaveLength(5);
    });

    it('renders composer skeleton', () => {
      const { container } = render(<CompactSkeleton />);
      const composer = container.querySelector('.h-12.rounded-2xl');
      expect(composer).toBeInTheDocument();
    });
  });
});
