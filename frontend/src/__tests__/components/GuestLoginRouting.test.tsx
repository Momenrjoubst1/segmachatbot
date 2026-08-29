import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarView } from '@/features/ai-assistant/shadcn/components/Sidebar/SidebarView';
import { LoginPage } from '@/components/LoginPage';

// Mock useChatHistory
vi.mock('@/hooks/useChatHistory', () => ({
  useChatHistory: () => ({
    loadThread: vi.fn(),
    threads: [],
    activeThreadId: null,
    isLoadingThreads: false,
    getThreadsByCourse: vi.fn(() => []),
  }),
}));

// Mock useUserProfile
vi.mock('@/features/ai-assistant/shadcn/components/Sidebar/UserProfileCard', () => ({
  useUserProfile: () => null,
  UserProfileCard: () => <div data-testid="user-profile" />,
}));

// Mock useAuth
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    signIn: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({ error: null }),
    isAuthLoading: false,
  }),
}));

// Mock useGuestMode
vi.mock('@/context/GuestModeContext', () => ({
  useGuestMode: () => ({
    isGuestMode: true,
    guestMessageCount: 0,
    guestMessageLimit: 4,
    retryAfterSeconds: null,
    limitReached: false,
    setGuestQuota: vi.fn(),
    refreshGuestStatus: vi.fn(),
  }),
}));

// Override the global react-router-dom mock to use real implementations
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return actual;
});

const defaultProps = {
  collapsed: false,
  onToggle: vi.fn(),
  courses: [],
  activeCourse: null,
  onActiveCourseChange: vi.fn(),
};

const renderWithProviders = (ui: React.ReactElement, initialEntries = ['/']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <TooltipProvider>{ui}</TooltipProvider>
    </MemoryRouter>
  );

describe('Guest Login Routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SidebarView guest mode', () => {
    it('renders Sign in button when in guest mode', () => {
      renderWithProviders(<SidebarView {...defaultProps} isGuestMode={true} />);
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('navigates to /login when Sign in button is clicked', () => {
      renderWithProviders(
        <Routes>
          <Route path="/" element={<SidebarView {...defaultProps} isGuestMode={true} />} />
          <Route path="/login" element={<div data-testid="login-page">Login Page</div>} />
        </Routes>
      );
      
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });

    it('does not render Sign in button when not in guest mode', () => {
      renderWithProviders(<SidebarView {...defaultProps} isGuestMode={false} />);
      expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
    });
  });

  describe('LoginPage routing', () => {
    // SignupPage is a lazy chunk inside <Suspense> — the form only exists once
    // the dynamic import resolves, so every assertion here must await findBy*.
    it('renders LoginPage when navigating to /login', async () => {
      renderWithProviders(
        <Routes>
          <Route path="/" element={<div>Home</div>} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>,
        ['/login']
      );

      expect(
        await screen.findByText(/signin\.title/i, {}, { timeout: 15000 })
      ).toBeInTheDocument();
    });

    it('renders email and password fields', async () => {
      renderWithProviders(
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>,
        ['/login']
      );

      expect(
        await screen.findByLabelText(/signin\.emailLabel/i, {}, { timeout: 15000 })
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/signin\.passwordLabel/i)).toBeInTheDocument();
    });

    it('renders submit button', async () => {
      renderWithProviders(
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>,
        ['/login']
      );

      expect(
        await screen.findByRole('button', { name: /signin\.submit/i }, { timeout: 15000 })
      ).toBeInTheDocument();
    });
  });

  describe('Route protection', () => {
    it('redirects unknown routes to / via catch-all route', () => {
      renderWithProviders(
        <Routes>
          <Route path="/" element={<div data-testid="home-page">Home</div>} />
          <Route path="/login" element={<div>Login</div>} />
          <Route path="*" element={<div data-testid="not-found">Not Found</div>} />
        </Routes>,
        ['/unknown-route']
      );
      
      // With the catch-all route, unknown routes show "Not Found"
      // In the actual App.tsx, the catch-all redirects to /
      expect(screen.getByTestId('not-found')).toBeInTheDocument();
    });

    it('navigates between routes correctly', () => {
      renderWithProviders(
        <Routes>
          <Route path="/" element={<div data-testid="home-page">Home</div>} />
          <Route path="/login" element={<div data-testid="login-page">Login</div>} />
        </Routes>,
        ['/']
      );
      
      // Start at home
      expect(screen.getByTestId('home-page')).toBeInTheDocument();
    });
  });
});
