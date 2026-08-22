import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockLoadThread = vi.fn();

vi.mock('@/lib/cn', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/ui/chat-icon', () => {
  const React = require('react');
  return {
    ChatIcon: (props: any) => React.createElement('svg', { 'data-testid': 'chat-icon', ...props }),
  };
});

vi.mock('@/hooks/useChatHistory', () => ({
  useChatHistory: () => ({
    threads: [
      { id: '1', title: 'React hooks discussion' },
      { id: '2', title: 'TypeScript tips' },
      { id: '3', title: 'Project planning' },
    ],
    loadThread: mockLoadThread,
  }),
}));

vi.mock('lucide-react', () => {
  const React = require('react');
  return {
    SearchIcon: (props: any) => React.createElement('svg', { 'data-testid': 'search-icon', ...props }),
  };
});

import { SidebarSearchBar } from '@/components/ui/sidebar-search-bar';

describe('SidebarSearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the search input', () => {
    render(<SidebarSearchBar />);
    expect(screen.getByPlaceholderText('Search chats...')).toBeInTheDocument();
  });

  it('renders the search icon', () => {
    render(<SidebarSearchBar />);
    expect(screen.getByTestId('search-icon')).toBeInTheDocument();
  });

  it('renders the Ctrl+K keyboard hint', () => {
    render(<SidebarSearchBar />);
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
  });

  it('has correct aria-label on input', () => {
    render(<SidebarSearchBar />);
    expect(screen.getByLabelText('Search chats')).toBeInTheDocument();
  });

  it('shows no dropdown when input is empty', () => {
    render(<SidebarSearchBar />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows dropdown with results when typing matching query', () => {
    render(<SidebarSearchBar />);
    const input = screen.getByPlaceholderText('Search chats...');
    fireEvent.change(input, { target: { value: 'react' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('React hooks discussion')).toBeInTheDocument();
  });

  it('shows "No chats found" when no results match', () => {
    render(<SidebarSearchBar />);
    const input = screen.getByPlaceholderText('Search chats...');
    fireEvent.change(input, { target: { value: 'xyz123' } });
    expect(screen.getByText('No chats found')).toBeInTheDocument();
  });

  it('calls loadThread when a result is clicked', () => {
    render(<SidebarSearchBar />);
    const input = screen.getByPlaceholderText('Search chats...');
    fireEvent.change(input, { target: { value: 'react' } });
    fireEvent.click(screen.getByText('React hooks discussion'));
    expect(mockLoadThread).toHaveBeenCalledWith('1');
  });

  it('clears input after selecting a thread', () => {
    render(<SidebarSearchBar />);
    const input = screen.getByPlaceholderText('Search chats...');
    fireEvent.change(input, { target: { value: 'react' } });
    fireEvent.click(screen.getByText('React hooks discussion'));
    expect(input).toHaveValue('');
  });

  it('closes dropdown after selecting a thread', () => {
    render(<SidebarSearchBar />);
    const input = screen.getByPlaceholderText('Search chats...');
    fireEvent.change(input, { target: { value: 'react' } });
    fireEvent.click(screen.getByText('React hooks discussion'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('calls onThreadSelected callback when provided', () => {
    const onThreadSelected = vi.fn();
    render(<SidebarSearchBar onThreadSelected={onThreadSelected} />);
    const input = screen.getByPlaceholderText('Search chats...');
    fireEvent.change(input, { target: { value: 'react' } });
    fireEvent.click(screen.getByText('React hooks discussion'));
    expect(onThreadSelected).toHaveBeenCalled();
  });

  it('hides dropdown on Escape key', () => {
    render(<SidebarSearchBar />);
    const input = screen.getByPlaceholderText('Search chats...');
    fireEvent.change(input, { target: { value: 'react' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('focuses input on Ctrl+K keydown', () => {
    render(<SidebarSearchBar />);
    const input = screen.getByPlaceholderText('Search chats...');
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });

  it('searches are case-insensitive', () => {
    render(<SidebarSearchBar />);
    const input = screen.getByPlaceholderText('Search chats...');
    fireEvent.change(input, { target: { value: 'REACT' } });
    expect(screen.getByText('React hooks discussion')).toBeInTheDocument();
  });

  it('shows chat-icon for each result', () => {
    render(<SidebarSearchBar />);
    const input = screen.getByPlaceholderText('Search chats...');
    fireEvent.change(input, { target: { value: 'react' } });
    expect(screen.getByTestId('chat-icon')).toBeInTheDocument();
  });
});
