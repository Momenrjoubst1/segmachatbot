import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { OfflineBanner } from '@/components/ui/OfflineBanner';

describe('OfflineBanner', () => {
  it('should render without crashing', () => {
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeDefined();
  });

  it('should accept className', () => {
    const { container } = render(<OfflineBanner className="test-class" />);
    expect(container.firstChild).toBeDefined();
  });
});
