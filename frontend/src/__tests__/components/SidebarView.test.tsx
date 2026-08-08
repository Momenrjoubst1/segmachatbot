import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarView } from '@/features/ai-assistant/shadcn/components/Sidebar/SidebarView';

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

const defaultProps = {
  collapsed: false,
  onToggle: vi.fn(),
  courses: [],
  activeCourse: null,
  onActiveCourseChange: vi.fn(),
};

const renderWithProviders = (ui: React.ReactElement) =>
  render(<TooltipProvider>{ui}</TooltipProvider>);

describe('SidebarView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with collapsed=false by default', () => {
    renderWithProviders(<SidebarView {...defaultProps} />);
    expect(screen.getByTestId('sidebar-view')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-collapsed')).toHaveTextContent('false');
  });

  it('renders with collapsed=true when collapsed prop is true', () => {
    renderWithProviders(<SidebarView {...defaultProps} collapsed={true} />);
    expect(screen.getByTestId('sidebar-collapsed')).toHaveTextContent('true');
  });

  it('calls onToggle when toggle button is clicked', () => {
    renderWithProviders(<SidebarView {...defaultProps} />);
    fireEvent.click(screen.getByTestId('sidebar-toggle'));
    expect(defaultProps.onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders ThreadList when not collapsed', () => {
    renderWithProviders(<SidebarView {...defaultProps} />);
    expect(screen.getByTestId('thread-list')).toBeInTheDocument();
  });

  it('does not render ThreadList when collapsed', () => {
    renderWithProviders(<SidebarView {...defaultProps} collapsed={true} />);
    expect(screen.queryByTestId('thread-list')).not.toBeInTheDocument();
  });

  it('passes courses to ThreadList', () => {
    const courses = [{ id: '1', course_name: 'CS101', credit_hours: 3 }];
    renderWithProviders(<SidebarView {...defaultProps} courses={courses as any} />);
    expect(screen.getByTestId('thread-list')).toBeInTheDocument();
  });

  it('passes activeCourse to ThreadList', () => {
    const course = { id: '1', course_name: 'CS101', credit_hours: 3 };
    renderWithProviders(<SidebarView {...defaultProps} activeCourse={course as any} />);
    expect(screen.getByTestId('thread-list')).toBeInTheDocument();
  });
});
