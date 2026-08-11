import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { Shadcn } from '@/features/ai-assistant/shadcn/AssistantLayout';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/ai-assistant/shadcn/components/Sidebar/SidebarView', () => ({
  SidebarView: ({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) => (
    <div data-testid="sidebar-view">
      <span data-testid="sidebar-collapsed">{String(collapsed)}</span>
      <button onClick={onToggle} data-testid="sidebar-toggle">Toggle</button>
    </div>
  ),
}));

vi.mock('@/features/ai-assistant/shadcn/components/Thread/ThreadWelcome', () => ({
  Thread: ({ isOnboarded }: { isOnboarded: boolean }) => (
    <div data-testid="thread">
      <span data-testid="onboarded">{String(isOnboarded)}</span>
    </div>
  ),
}));

vi.mock('@/components/ui/BarsSpinner', () => ({
  BarsSpinner: ({ size, className }: { size: number; className?: string }) => (
    <div data-testid="bars-spinner" data-size={size} className={className} />
  ),
}));

vi.mock('@/components/ui/core/ErrorBoundary', () => ({
  ErrorBoundary: ({ children, componentName }: { children: React.ReactNode; componentName?: string }) => (
    <div data-testid="error-boundary" data-component={componentName}>
      {children}
    </div>
  ),
}));

const MockArtifactPanel = React.forwardRef(function MockArtifactPanel(
  { open, onClose }: { open: boolean; onClose: () => void },
  _ref: React.ForwardedRef<HTMLDivElement>
) {
  if (!open) return null;
  return (
    <div data-testid="artifact-panel">
      <button onClick={onClose} data-testid="close-artifacts">Close</button>
    </div>
  );
});

vi.mock('@/features/artifacts/ArtifactPanel', () => ({
  ArtifactPanel: MockArtifactPanel,
  default: MockArtifactPanel,
}));

vi.mock('@/features/calendar/components', () => ({
  SchedulingPanel: ({ onSubmit, onCancel }: { onSubmit?: (e: unknown) => void; onCancel?: () => void }) => (
    <div data-testid="scheduling-panel">
      <button onClick={onCancel} data-testid="cancel-schedule">Cancel</button>
      <button onClick={() => onSubmit?.({ title: 'Test Event' })} data-testid="submit-schedule">Submit</button>
    </div>
  ),
}));

const MockFullScreenCalendar = React.forwardRef(function MockFullScreenCalendar(
  { onCreateEvent }: { onCreateEvent?: () => void },
  _ref: React.ForwardedRef<HTMLDivElement>
) {
  return (
    <div data-testid="fullscreen-calendar">
      <button onClick={onCreateEvent} data-testid="create-event">Create Event</button>
    </div>
  );
});

vi.mock('@/components/ui/fullscreen-calendar', () => ({
  FullScreenCalendar: MockFullScreenCalendar,
  default: MockFullScreenCalendar,
}));

vi.mock('@/features/ai-assistant/shadcn/components/EmailHistoryPanel', () => ({
  EmailHistoryPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="email-history-panel">
      <button onClick={onClose} data-testid="close-email">Close</button>
    </div>
  ),
}));

vi.mock('@/features/calendar/hooks/useCalendarSync', () => ({
  __esModule: true,
  default: vi.fn(() => ({
    events: [],
    insights: null,
    isCalendarLoading: false,
    error: null,
    fetchEvents: vi.fn(),
    fetchInsights: vi.fn(),
    createEvent: vi.fn().mockResolvedValue({ success: true }),
    updateEvent: vi.fn().mockResolvedValue({ success: true }),
    deleteEvent: vi.fn().mockResolvedValue({ success: true }),
    findFreeSlots: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'token-123' } },
      }),
    },
  },
}));

vi.mock('../../../context/RAGContext', () => ({
  useRAGContext: vi.fn().mockReturnValue({
    isRAGEnabled: false,
    toggleRAG: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}));

vi.mock('../../../context/AgenticUIBus', () => ({
  useAgenticAction: vi.fn(),
}));

const defaultProps = {
  courses: [],
  isOnboarded: true,
  activeCourse: null,
  onActiveCourseChange: vi.fn(),
  onCompleteOnboarding: vi.fn().mockResolvedValue(undefined),
  sidebarCollapsed: false,
  onToggleSidebar: vi.fn(),
  activeView: 'chat' as const,
  onToggleView: vi.fn(),
  artifactPanelOpen: false,
  setArtifactPanelOpen: vi.fn(),
  emailHistoryOpen: false,
  setEmailHistoryOpen: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AssistantLayout (Shadcn)', () => {
  it('renders the basic layout', () => {
    render(<Shadcn {...defaultProps} />);
    expect(screen.getByTestId('thread')).toBeInTheDocument();
  });

  it('renders Thread with isOnboarded prop', () => {
    render(<Shadcn {...defaultProps} isOnboarded={true} />);
    expect(screen.getByTestId('onboarded')).toHaveTextContent('true');
  });

  it('renders Thread as not onboarded when isOnboarded=false', () => {
    render(<Shadcn {...defaultProps} isOnboarded={false} />);
    expect(screen.getByTestId('onboarded')).toHaveTextContent('false');
  });

  it('renders loading spinner when isCoursesLoadingVisible is true', () => {
    render(<Shadcn {...defaultProps} isCoursesLoadingVisible={true} />);
    expect(screen.getByTestId('bars-spinner')).toBeInTheDocument();
    expect(screen.getByTestId('thread')).toBeInTheDocument();
  });

  it('does not render loading spinner by default', () => {
    render(<Shadcn {...defaultProps} />);
    expect(screen.queryByTestId('bars-spinner')).not.toBeInTheDocument();
  });

  it('switches to calendar view and renders calendar components', async () => {
    render(<Shadcn {...defaultProps} activeView="calendar" />);
    await waitFor(() => {
      expect(screen.getByTestId('fullscreen-calendar')).toBeInTheDocument();
    });
  });

  it('opens scheduling panel when create event is clicked in calendar', async () => {
    render(<Shadcn {...defaultProps} activeView="calendar" />);
    fireEvent.click(screen.getByTestId('create-event'));
    await waitFor(() => {
      expect(screen.getByTestId('scheduling-panel')).toBeInTheDocument();
    });
  });

  it('closes scheduling panel when cancel is clicked', async () => {
    render(<Shadcn {...defaultProps} activeView="calendar" />);
    fireEvent.click(screen.getByTestId('create-event'));
    await waitFor(() => {
      expect(screen.getByTestId('scheduling-panel')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('cancel-schedule'));
    await waitFor(() => {
      expect(screen.queryByTestId('scheduling-panel')).not.toBeInTheDocument();
    });
  });

  it('shows artifact panel when opened', async () => {
    render(<Shadcn {...defaultProps} artifactPanelOpen={true} />);
    expect(screen.getByTestId('artifact-panel')).toBeInTheDocument();
  });

  it('closes artifact panel when close is clicked', async () => {
    render(<Shadcn {...defaultProps} artifactPanelOpen={true} />);
    expect(screen.getByTestId('artifact-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('close-artifacts'));
    expect(defaultProps.setArtifactPanelOpen).toHaveBeenCalledWith(false);
  });
});
