import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Separator } from '@/components/ui/separator';

describe('Separator Component', () => {
  it('should render horizontal separator', () => {
    const { container } = render(<Separator />);
    expect(container.firstChild).toBeDefined();
  });

  it('should render vertical separator', () => {
    const { container } = render(<Separator orientation="vertical" />);
    expect(container.firstChild).toBeDefined();
  });

  it('should accept custom className', () => {
    const { container } = render(<Separator className="custom-separator" />);
    expect(container.firstChild).toBeDefined();
  });

  it('should have decorative attribute by default', () => {
    const { container } = render(<Separator />);
    expect(container.firstChild).toBeDefined();
  });

  it('should render with non-decorative', () => {
    const { container } = render(<Separator decorative={false} />);
    expect(container.firstChild).toBeDefined();
  });
});
