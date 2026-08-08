import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArtifactPanel } from '@/features/artifacts/ArtifactPanel';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'token-123' } },
      }),
    },
  },
}));

vi.mock('@/features/artifacts/ArtifactViewer', () => ({
  ArtifactViewer: ({ artifact }: { artifact: { title: string; content: string; type: string } }) => (
    <div data-testid="artifact-viewer">{artifact.title}</div>
  ),
}));

const mockArtifacts = [
  { id: '1', type: 'code', title: 'Test Component', content: 'console.log("hello")', language: 'javascript', created_at: '2025-01-01' },
  { id: '2', type: 'html', title: 'Test Page', content: '<html><body>Hello</body></html>', created_at: '2025-01-02' },
  { id: '3', type: 'markdown', title: 'Test Doc', content: '# Hello World', created_at: '2025-01-03' },
];

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockArtifacts),
  });
});

describe('ArtifactPanel', () => {
  it('returns null when closed', () => {
    const { container } = render(
      <ArtifactPanel open={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the panel when open', async () => {
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Artifacts')).toBeInTheDocument();
    expect(screen.getByText('Preview, inspect code, or open full page')).toBeInTheDocument();
  });

  it('renders loading skeletons while fetching', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <ArtifactPanel open={true} onClose={vi.fn()} />
    );
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders empty state when no artifacts', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
    });
    expect(screen.getByText(/Ask Sigma to create/)).toBeInTheDocument();
  });

  it('renders artifacts after fetching', async () => {
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText('Test Component').length).toBeGreaterThan(0);
    });
  });

  it('shows artifact tabs when multiple artifacts exist', async () => {
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
    fireEvent.click(screen.getByTitle('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls fetchLatest when refresh button is clicked', async () => {
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText('Test Component').length).toBeGreaterThan(0);
    });
    const initialCallCount = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  it('toggles expanded state on expand button click', async () => {
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText('Test Component').length).toBeGreaterThan(0);
    });
    const expandButton = screen.getByTitle('Wide panel');
    fireEvent.click(expandButton);
    expect(screen.getByTitle('Compact panel')).toBeInTheDocument();
  });

  it('switches active artifact when tab is clicked', async () => {
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText('Test Component').length).toBeGreaterThan(0);
    });
    const pageTab = screen.getByText('Test Page');
    fireEvent.click(pageTab);
    await waitFor(() => {
      const viewers = screen.getAllByTestId('artifact-viewer');
      const lastViewer = viewers[viewers.length - 1];
      expect(lastViewer).toHaveTextContent('Test Page');
    });
  });

  it('fetches artifacts on open', async () => {
    render(<ArtifactPanel open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/artifacts',
        expect.objectContaining({
          headers: { Authorization: 'Bearer token-123' },
        })
      );
    });
  });
});
