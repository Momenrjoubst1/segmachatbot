import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary, withErrorBoundary } from '@/components/ui/core/ErrorBoundary';

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
}));

function ThrowingComponent({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div data-testid="child">Hello</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">Hello</div>
      </ErrorBoundary>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders error fallback when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders error message from thrown error', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom</div>}>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
  });

  it('renders componentName in error UI', () => {
    render(
      <ErrorBoundary componentName="MyComponent">
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('in MyComponent')).toBeInTheDocument();
  });

  it('calls onRetry when Try Again is clicked', async () => {
    const onRetry = vi.fn();
    render(
      <ErrorBoundary onRetry={onRetry}>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    const retryButton = screen.getByText('Try Again');
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalled();
  });

  it('reloads page when Try Again clicked without onRetry', () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadSpy },
      writable: true,
    });
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByText('Try Again'));
    expect(reloadSpy).toHaveBeenCalled();
  });

  it('toggles details on show/hide click', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    const toggle = screen.getByText(/details/);
    fireEvent.click(toggle);
    expect(screen.getByText(/Hide/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Hide/));
    expect(screen.getByText(/Show/)).toBeInTheDocument();
  });

  it('shows error stack in details', () => {
    const { container } = render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(container.querySelector('pre')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/details/));
    expect(container.querySelector('pre')).toBeInTheDocument();
  });

  it('copies error to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <ErrorBoundary componentName="TestComp">
        <ThrowingComponent />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByText('Copy Error'));
    expect(writeText).toHaveBeenCalled();
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });
});

describe('withErrorBoundary', () => {
  it('wraps component with ErrorBoundary', () => {
    const SafeComponent = () => <div data-testid="safe">Safe</div>;
    const Wrapped = withErrorBoundary(SafeComponent, 'SafeComponent');
    render(<Wrapped />);
    expect(screen.getByTestId('safe')).toBeInTheDocument();
  });

  it('catches errors in wrapped component', () => {
    const Wrapped = withErrorBoundary(ThrowingComponent, 'ThrowingComponent');
    render(<Wrapped />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('in ThrowingComponent')).toBeInTheDocument();
  });
});
