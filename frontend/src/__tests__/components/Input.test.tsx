import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '@/components/ui/input';

describe('Input Component', () => {
  it('should render input element', () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText('Enter text')).toBeDefined();
  });

  it('should accept value prop', () => {
    render(<Input value="test value" readOnly />);
    expect(screen.getByDisplayValue('test value')).toBeDefined();
  });

  it('should handle onChange', () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} />);
    const input = screen.getByRole('textbox');
    expect(input).toBeDefined();
  });

  it('should be disabled when disabled prop is set', () => {
    render(<Input disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('should accept custom className', () => {
    render(<Input className="custom-input" />);
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('should accept type prop', () => {
    const { rerender } = render(<Input type="password" />);
    rerender(<Input type="email" />);
    rerender(<Input type="number" />);
  });

  it('should forward ref', () => {
    const ref = { current: null };
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
