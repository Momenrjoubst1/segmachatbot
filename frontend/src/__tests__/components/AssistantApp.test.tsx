import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => <div data-testid="toaster" />,
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/ai-assistant/shadcn/components/Header/Header', () => ({
  Header: ({ activeView, onToggleView }: { activeView: string; onToggleView: (v: 'chat' | 'calendar') => void }) => (
    <header data-testid="header">
      <span data-testid="active-view">{activeView}</span>
      <button onClick={() => onToggleView(activeView === 'chat' ? 'calendar' : 'chat')} data-testid="view-toggle">
        Switch View
      </button>
    </header>
  ),
}));

vi.mock('@/features/ai-assistant/shadcn/components/Sidebar/SidebarView', () => ({
  SidebarView: () => <div data-testid="sidebar-view" />,
}));

vi.mock('@/features/ai-assistant/shadcn/components/Sidebar/MobileSidebarView', () => ({
  MobileSidebarView: () => <div data-testid="mobile-sidebar-view" />,
}));

vi.mock('@/components/ui/LoadingStates', () => ({
  CompactSkeleton: () => <div data-testid="compact-skeleton" />,
}));

vi.mock('@/hooks/useChatHistory', () => ({
  useChatHistory: vi.fn(() => ({
    threads: [],
    activeThreadId: null,
    isLoadingMessages: true,
    saveDraft: vi.fn(),
    getDraft: vi.fn(),
    newChatCount: 0,
  })),
  ChatHistoryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useCourses', () => ({
  useCourses: vi.fn(() => ({
    courses: [],
    isOnboarded: false,
    isLoading: false,
    replaceCourses: vi.fn(),
    refetch: vi.fn(),
  })),
}));

vi.mock('@/context/TitleContext', () => ({
  useTitle: vi.fn(() => ({ setBaseTitle: vi.fn() })),
}));

vi.mock('@/context/RAGContext', () => ({
  RAGProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useRAGContext: vi.fn(() => ({ isRAGEnabled: false, toggleRAG: vi.fn() })),
}));

vi.mock('@assistant-ui/react', () => ({
  AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Suggestions: vi.fn(),
  useAui: vi.fn(() => ({ composer: () => ({ getText: () => '' }) })),
  useAuiState: vi.fn(() => ({ thread: { isEmpty: true } })),
}));

vi.mock('@/features/ai-assistant/ui/useChatRuntime', () => ({
  useRuntime: vi.fn(() => ({})),
}));

vi.mock('@/features/ai-assistant/shadcn/AssistantLayout', () => ({
  Shadcn: ({ showLoading }: { showLoading?: boolean }) => (
    <div data-testid="shadcn">
      {showLoading ? <div data-testid="loading-spinner" /> : <div data-testid="thread" />}
    </div>
  ),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'token-123' } } }),
    },
  },
}));

// Import after mocks
import { AssistantApp } from '@/features/ai-assistant/AssistantApp';
import { useChatHistory } from '@/hooks/useChatHistory';

describe('AssistantApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Header when isLoadingMessages is true', () => {
    vi.mocked(useChatHistory).mockReturnValue({
      threads: [],
      activeThreadId: null,
      isLoadingMessages: true,
      saveDraft: vi.fn(),
      getDraft: vi.fn(),
      newChatCount: 0,
    });

    render(<AssistantApp />);
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByTestId('compact-skeleton')).toBeInTheDocument();
  });

  it('renders Header when isLoadingMessages is false', () => {
    vi.mocked(useChatHistory).mockReturnValue({
      threads: [],
      activeThreadId: null,
      isLoadingMessages: false,
      saveDraft: vi.fn(),
      getDraft: vi.fn(),
      newChatCount: 0,
    });

    render(<AssistantApp />);
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByTestId('shadcn')).toBeInTheDocument();
  });
});
