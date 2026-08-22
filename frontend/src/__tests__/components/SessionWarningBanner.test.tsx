import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const mockNavigate = vi.fn();
const mockGetSession = vi.fn();
const mockRefreshSession = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...args: any[]) => mockGetSession(...args),
      refreshSession: (...args: any[]) => mockRefreshSession(...args),
    },
  },
}));

vi.mock('@/lib/cn', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

vi.mock('lucide-react', () => {
  const React = require('react');
  return {
    AlertTriangle: (props: any) => React.createElement('svg', { 'data-testid': 'icon-alert', ...props }),
    LogIn: (props: any) => React.createElement('svg', { 'data-testid': 'icon-login', ...props }),
    RefreshCcw: (props: any) => React.createElement('svg', { 'data-testid': 'icon-refresh', ...props }),
  };
});

import { SessionWarningBanner } from '@/components/SessionWarningBanner';

describe('SessionWarningBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockRefreshSession.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when session is null', async () => {
    await act(async () => {
      render(<SessionWarningBanner />);
    });
    expect(screen.queryByTestId('icon-alert')).not.toBeInTheDocument();
  });

  it('renders nothing when session has far expiry (> 10 minutes)', async () => {
    const futureTime = Math.floor((Date.now() + 20 * 60 * 1000) / 1000);
    mockGetSession.mockResolvedValue({
      data: { session: { expires_at: futureTime } },
      error: null,
    });

    await act(async () => {
      render(<SessionWarningBanner />);
    });
    expect(screen.queryByTestId('icon-alert')).not.toBeInTheDocument();
  });

  it('shows expiring warning when session expires within 10 minutes', async () => {
    const soonTime = Math.floor((Date.now() + 5 * 60 * 1000) / 1000);
    mockGetSession.mockResolvedValue({
      data: { session: { expires_at: soonTime } },
      error: null,
    });

    await act(async () => {
      render(<SessionWarningBanner />);
    });
    expect(screen.getByText(/Your session expires in/)).toBeInTheDocument();
    expect(screen.getByText('Refresh session')).toBeInTheDocument();
  });

  it('shows expired message when session has expired', async () => {
    const pastTime = Math.floor((Date.now() - 1000) / 1000);
    mockGetSession.mockResolvedValue({
      data: { session: { expires_at: pastTime } },
      error: null,
    });

    await act(async () => {
      render(<SessionWarningBanner />);
    });
    expect(screen.getByText('Your session has expired.')).toBeInTheDocument();
    expect(screen.getByText('Log in again')).toBeInTheDocument();
  });

  it('navigates to /login when "Log in again" is clicked', async () => {
    const pastTime = Math.floor((Date.now() - 1000) / 1000);
    mockGetSession.mockResolvedValue({
      data: { session: { expires_at: pastTime } },
      error: null,
    });

    await act(async () => {
      render(<SessionWarningBanner />);
    });

    await act(async () => {
      screen.getByText('Log in again').click();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/login', { state: { from: '' } });
  });

  it('calls refreshSession when "Refresh session" is clicked', async () => {
    const soonTime = Math.floor((Date.now() + 5 * 60 * 1000) / 1000);
    mockGetSession.mockResolvedValue({
      data: { session: { expires_at: soonTime } },
      error: null,
    });

    await act(async () => {
      render(<SessionWarningBanner />);
    });

    await act(async () => {
      screen.getByText('Refresh session').click();
    });
    expect(mockRefreshSession).toHaveBeenCalled();
  });

  it('dismisses the banner when Dismiss is clicked', async () => {
    const soonTime = Math.floor((Date.now() + 5 * 60 * 1000) / 1000);
    mockGetSession.mockResolvedValue({
      data: { session: { expires_at: soonTime } },
      error: null,
    });

    await act(async () => {
      render(<SessionWarningBanner />);
    });
    expect(screen.getByText(/Your session expires in/)).toBeInTheDocument();

    await act(async () => {
      screen.getByText('Dismiss').click();
    });
    expect(screen.queryByText(/Your session expires in/)).not.toBeInTheDocument();
  });

  it('shows minutes left as plural when more than 1 minute', async () => {
    const soonTime = Math.floor((Date.now() + 7 * 60 * 1000) / 1000);
    mockGetSession.mockResolvedValue({
      data: { session: { expires_at: soonTime } },
      error: null,
    });

    await act(async () => {
      render(<SessionWarningBanner />);
    });
    expect(screen.getByText(/minutes/)).toBeInTheDocument();
  });

  it('shows "minute" singular when exactly 1 minute left', async () => {
    const soonTime = Math.floor((Date.now() + 1 * 60 * 1000) / 1000);
    mockGetSession.mockResolvedValue({
      data: { session: { expires_at: soonTime } },
      error: null,
    });

    await act(async () => {
      render(<SessionWarningBanner />);
    });
    expect(screen.getByText(/minute\./)).toBeInTheDocument();
    expect(screen.queryByText(/minutes/)).not.toBeInTheDocument();
  });
});
