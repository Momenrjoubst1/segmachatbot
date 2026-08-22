import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/components/ui/dialog', () => {
  const React = require('react');
  return {
    Dialog: ({ children, open, ...props }: any) => {
      if (!open) return null;
      return React.createElement('div', { 'data-testid': 'dialog', role: 'dialog', ...props }, children);
    },
    DialogContent: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'dialog-content', ...props }, children),
    DialogHeader: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'dialog-header', ...props }, children),
    DialogTitle: ({ children, ...props }: any) => React.createElement('h2', { 'data-testid': 'dialog-title', ...props }, children),
    DialogDescription: ({ children, ...props }: any) => React.createElement('p', { 'data-testid': 'dialog-description', ...props }, children),
    DialogFooter: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'dialog-footer', ...props }, children),
  };
});

vi.mock('@/components/ui/button', () => {
  const React = require('react');
  return {
    Button: ({ children, ...props }: any) => React.createElement('button', { ...props }, children),
  };
});

import { SessionExpiredModal } from '@/components/SessionExpiredModal';

describe('SessionExpiredModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing initially (dialog not open)', () => {
    render(<SessionExpiredModal />);
    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
  });

  it('shows dialog when auth:session-expired event is dispatched', () => {
    render(<SessionExpiredModal />);
    fireEvent(window, new CustomEvent('auth:session-expired'));
    expect(screen.getByTestId('dialog')).toBeInTheDocument();
  });

  it('displays title "Session Expired"', () => {
    render(<SessionExpiredModal />);
    fireEvent(window, new CustomEvent('auth:session-expired'));
    expect(screen.getByTestId('dialog-title')).toHaveTextContent('Session Expired');
  });

  it('displays description about session expiry', () => {
    render(<SessionExpiredModal />);
    fireEvent(window, new CustomEvent('auth:session-expired'));
    expect(screen.getByTestId('dialog-description')).toHaveTextContent('Your session has expired');
  });

  it('renders a Log in button', () => {
    render(<SessionExpiredModal />);
    fireEvent(window, new CustomEvent('auth:session-expired'));
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('navigates to /login when Log in button is clicked', () => {
    render(<SessionExpiredModal />);
    fireEvent(window, new CustomEvent('auth:session-expired'));
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(mockNavigate).toHaveBeenCalledWith('/login', { state: { from: '' } });
  });

  it('closes the dialog when Log in is clicked', () => {
    render(<SessionExpiredModal />);
    fireEvent(window, new CustomEvent('auth:session-expired'));
    expect(screen.getByTestId('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
  });

  it('listens for auth:session-expired event on mount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    render(<SessionExpiredModal />);
    expect(addSpy).toHaveBeenCalledWith('auth:session-expired', expect.any(Function));
    addSpy.mockRestore();
  });

  it('cleans up event listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<SessionExpiredModal />);
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('auth:session-expired', expect.any(Function));
    removeSpy.mockRestore();
  });
});
