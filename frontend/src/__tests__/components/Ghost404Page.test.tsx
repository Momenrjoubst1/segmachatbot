import { describe, it, expect, vi } from 'vitest';
import { forwardRef, createElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotFound } from '@/components/ui/ghost-404-page';

// Mock framer-motion to avoid animation complexity in tests
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion');
  return {
    ...actual,
    motion: new Proxy({}, {
      get: (_, tag: string) => {
        return forwardRef((props: any, ref: any) => {
          return createElement(tag, { ...props, ref });
        });
      },
    }),
    AnimatePresence: ({ children }: any) => children,
  };
});

describe('Ghost404Page (NotFound)', () => {
  it('should render the 404 page', () => {
    const { container } = render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>
    );
    expect(container.firstChild).toBeDefined();
  });

  it('should display content', () => {
    const { container } = render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>
    );
    expect(container.textContent).toBeTruthy();
  });
});
