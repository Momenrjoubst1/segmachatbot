import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Label } from '@/components/ui/core/Label';

describe('Label Component', () => {
  it('should render label', () => {
    const { container } = render(<Label>Test Label</Label>);
    expect(container.textContent).toBe('Test Label');
  });

  it('should accept custom className', () => {
    const { container } = render(<Label className="custom-label">Custom</Label>);
    expect(container.textContent).toBe('Custom');
  });

  it('should render as label element', () => {
    const { container } = render(<Label htmlFor="test-input">Email</Label>);
    const label = container.querySelector('label');
    expect(label).toBeDefined();
    expect(label?.getAttribute('for')).toBe('test-input');
  });
});
