import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArtifactPanel } from '@/features/artifacts/ArtifactPanel';

// The realtime bridge lives in the panel and must survive open/close, so the
// supabase mock exposes channel/removeChannel plus auth.getUser for owner
// filtering.
const changeHandlerHolder: { handler: ((payload: { eventType?: string; new?: Record<string, unknown> }) => void) | null } = {
  handler: null,
};

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'token-123' } },
      }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    channel: vi.fn(() => {
      const chan = {
        on: (_event: string, _config: unknown, handler: (payload: { eventType?: string; new?: Record<string, unknown> }) => void) => {
          changeHandlerHolder.handler = handler;
          return chan;
        },
        subscribe: (cb: (status: string) => void) => {
          cb('SUBSCRIBED');
          return chan;
        },
      };
      return chan;
    }),
    removeChannel: vi.fn(),
  },
}));

vi.mock('@/features/artifacts/ArtifactViewer', () => ({
  ArtifactViewer: ({ artifact }: { artifact: { title: string; content: string; type: string } }) => (
    <div data-testid="artifact-viewer">{artifact.title}</div>
  ),
}));

const mockArtifacts = [
  { id: '1', type: 'code', title: 'Test Component', content: 'console.log("hello")', language: 'javascript', version: 1, visibility: 'private', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: '2', type: 'html', title: 'Test Page', content: '<html><body>Hello</body></html>', version: 2, visibility: 'private', created_at: '2025-01-02T00:00:00Z', updated_at: '2025-01-02T00:00:00Z' },
  { id: '3', type: 'markdown', title: 'Test Doc', content: '# Hello World', version: 1, visibility: 'private', created_at: '2025-01-03T00:00:00Z', updated_at: '2025-01-03T00:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  changeHandlerHolder.handler = null;
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockArtifacts),
  });
});

describe('ArtifactPanel', () => {
  it('hides but stays mounted when closed (realtime keeps running)', () => {
    const { container } = render(
      <ArtifactPanel open={false} onClose={vi.fn()} />,
    );
    const panel = container.querySelector('[data-testid="artifact-panel"]');
    expect(panel).not.toBeNull();
    expect(panel).toHaveClass('hidden');
  });

  it('renders the panel when open', async () => {
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    // i18n is mocked to return keys — assert on the panel title key.
    expect(screen.getByText('panel.title')).toBeInTheDocument();
    expect(screen.getByText('panel.subtitle')).toBeInTheDocument();
  });

  it('renders empty state when no artifacts', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('panel.emptyTitle')).toBeInTheDocument();
    });
    expect(screen.getByText(/panel\.emptyHint/)).toBeInTheDocument();
  });

  it('renders artifacts after fetching', async () => {
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText('Test Component').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Test Page')).toBeInTheDocument();
    expect(screen.getByText('Test Doc')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(<ArtifactPanel open={true} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getAllByText('Test Component').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByTitle('panel.close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('refetches when refresh button is clicked', async () => {
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText('Test Component').length).toBeGreaterThan(0);
    });
    const initialCallCount = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByTitle('panel.refresh'));
    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  it('toggles expanded state on expand button click', async () => {
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText('Test Component').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByTitle('panel.wide'));
    expect(screen.getByTitle('panel.compact')).toBeInTheDocument();
  });

  it('switches active artifact when a sidebar item is clicked', async () => {
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByTestId('artifact-viewer').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByText('Test Page'));
    await waitFor(() => {
      const viewers = screen.getAllByTestId('artifact-viewer');
      expect(viewers[viewers.length - 1]).toHaveTextContent('Test Page');
    });
  });

  it('filters the sidebar list by search text', async () => {
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('panel.search')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText('panel.search'), {
      target: { value: 'page' },
    });
    await waitFor(() => {
      expect(screen.queryByText('Test Doc')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Test Page')).toBeInTheDocument();
  });

  it('sends authenticated requests to the artifacts API', async () => {
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    const backendBase = import.meta.env.VITE_BACKEND_URL || '';
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `${backendBase}/api/artifacts`,
        expect.objectContaining({ headers: expect.any(Headers) }),
      );
    });
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (args: unknown[]) => String(args[0]).endsWith('/api/artifacts'),
    );
    const headers = call?.[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer token-123');
  });

  it('auto-opens and focuses on realtime INSERT when closed', async () => {
    const onRequestOpen = vi.fn();
    render(
      <ArtifactPanel open={false} onClose={vi.fn()} onRequestOpen={onRequestOpen} />,
    );
    await waitFor(() => {
      expect(changeHandlerHolder.handler).not.toBeNull();
    });

    changeHandlerHolder.handler?.({ eventType: 'INSERT', new: { id: '2' } });

    await waitFor(() => {
      expect(onRequestOpen).toHaveBeenCalled();
    });
    const viewers = screen.getAllByTestId('artifact-viewer');
    expect(viewers[viewers.length - 1]).toHaveTextContent('Test Page');
  });

  it('does not call onRequestOpen for non-INSERT events', async () => {
    const onRequestOpen = vi.fn();
    render(
      <ArtifactPanel open={false} onClose={vi.fn()} onRequestOpen={onRequestOpen} />,
    );
    await waitFor(() => {
      expect(changeHandlerHolder.handler).not.toBeNull();
    });

    changeHandlerHolder.handler?.({ eventType: 'UPDATE', new: { id: '3' } });
    expect(onRequestOpen).not.toHaveBeenCalled();
  });
});
