import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LoadingSpinner } from '@/components/ui/LoadingStates';

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

    it('has role=status for accessibility', () => {
      const { container } = render(<LoadingSpinner />);
      expect(container.firstChild).toHaveAttribute('role', 'status');
    });

    it('accepts aria-label', () => {
      const { container } = render(<LoadingSpinner aria-label="Loading content" />);
      expect(container.firstChild).toHaveAttribute('aria-label', 'Loading content');
    });
  });
});
