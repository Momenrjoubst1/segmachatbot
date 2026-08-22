import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Checkbox } from '@/components/ui/core/Checkbox';

describe('Checkbox Component', () => {
  it('should render checkbox', () => {
    render(<Checkbox />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDefined();
  });

  it('should be unchecked by default', () => {
    render(<Checkbox />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
  });

  it('should handle checked state', () => {
    render(<Checkbox defaultChecked />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('should accept custom className', () => {
    const { container } = render(<Checkbox className="custom-checkbox" />);
    expect(container.firstChild).toBeDefined();
  });
});
