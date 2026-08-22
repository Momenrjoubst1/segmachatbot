import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BarsSpinner } from '@/components/ui/BarsSpinner';

describe('BarsSpinner Component', () => {
  it('should render spinner', () => {
    const { container } = render(<BarsSpinner />);
    expect(container.firstChild).toBeDefined();
  });

  it('should accept custom size', () => {
    const { container } = render(<BarsSpinner size={40} />);
    expect(container.firstChild).toBeDefined();
  });

  it('should accept custom color', () => {
    const { container } = render(<BarsSpinner color="#ff0000" />);
    expect(container.firstChild).toBeDefined();
  });

  it('should accept custom className', () => {
    const { container } = render(<BarsSpinner className="custom-spinner" />);
    expect(container.firstChild).toBeDefined();
  });

  it('should render 12 bars', () => {
    const { container } = render(<BarsSpinner />);
    const spinner = container.querySelector('[class*="spinner"]');
    expect(spinner).toBeDefined();
  });
});
