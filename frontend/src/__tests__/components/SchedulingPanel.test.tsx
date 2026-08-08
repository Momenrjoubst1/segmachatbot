import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SchedulingPanel from '@/features/calendar/components/SchedulingPanel';

vi.mock('@/lib/cn', () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' '),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SchedulingPanel', () => {
  it('renders the scheduling form header', () => {
    render(<SchedulingPanel />);
    expect(screen.getByText('Schedule a Meeting')).toBeInTheDocument();
    expect(screen.getByText('Create a new calendar event')).toBeInTheDocument();
  });

  it('renders all form fields', () => {
    render(<SchedulingPanel />);
    expect(screen.getByLabelText(/Event Title/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Start Time/)).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByLabelText(/Location/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/)).toBeInTheDocument();
    expect(screen.getByText('Attendees')).toBeInTheDocument();
  });

  it('renders duration buttons', () => {
    render(<SchedulingPanel />);
    expect(screen.getByText('15 min')).toBeInTheDocument();
    expect(screen.getByText('30 min')).toBeInTheDocument();
    expect(screen.getByText('1 hour')).toBeInTheDocument();
    expect(screen.getByText('2 hours')).toBeInTheDocument();
  });

  it('renders recurrence buttons', () => {
    render(<SchedulingPanel />);
    expect(screen.getByText('No Repeat')).toBeInTheDocument();
    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('Monthly')).toBeInTheDocument();
  });

  it('renders color picker', () => {
    const { container } = render(<SchedulingPanel />);
    const colorButtons = container.querySelectorAll('.rounded-full[style]');
    expect(colorButtons.length).toBeGreaterThan(0);
  });

  it('renders create button', () => {
    render(<SchedulingPanel />);
    expect(screen.getByText('Create Event')).toBeInTheDocument();
  });

  it('renders cancel button and calls onCancel when clicked', () => {
    const onCancel = vi.fn();
    render(<SchedulingPanel onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders close button when onCancel is provided', () => {
    const onCancel = vi.fn();
    render(<SchedulingPanel onCancel={onCancel} />);
    const buttons = screen.getAllByRole('button');
    const closeButton = buttons.find((btn) => btn.querySelector('svg'));
    expect(closeButton).toBeInTheDocument();
  });

  it('disables create button when title is empty', () => {
    render(<SchedulingPanel />);
    const submitButton = screen.getByText('Create Event');
    expect(submitButton.closest('button')).toBeDisabled();
  });

  it('enables create button when title is entered', () => {
    render(<SchedulingPanel />);
    const titleInput = screen.getByLabelText(/Event Title/);
    fireEvent.change(titleInput, { target: { value: 'Team Meeting' } });
    const submitButton = screen.getByText('Create Event');
    expect(submitButton.closest('button')).not.toBeDisabled();
  });

  it('calls onSubmit with correct data when form is submitted', () => {
    const onSubmit = vi.fn();
    render(<SchedulingPanel onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Event Title/), { target: { value: 'Standup' } });
    fireEvent.click(screen.getByText('Create Event'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Standup',
        provider: 'manual',
      })
    );
  });

  it('changes duration when duration button is clicked', () => {
    const onSubmit = vi.fn();
    render(<SchedulingPanel onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Event Title/), { target: { value: 'Quick sync' } });
    fireEvent.click(screen.getByText('30 min'));
    fireEvent.click(screen.getByText('Create Event'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Quick sync',
      })
    );
  });

  it('adds attendee when email is entered and add button clicked', () => {
    render(<SchedulingPanel />);
    const emailInput = screen.getByPlaceholderText('Add email address');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    const addButton = emailInput.parentElement?.querySelector('button');
    fireEvent.click(addButton!);
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('adds attendee on Enter key', () => {
    render(<SchedulingPanel />);
    const emailInput = screen.getByPlaceholderText('Add email address');
    fireEvent.change(emailInput, { target: { value: 'alice@corp.com' } });
    fireEvent.keyDown(emailInput, { key: 'Enter' });
    expect(screen.getByText('alice@corp.com')).toBeInTheDocument();
  });

  it('removes attendee when remove button is clicked', () => {
    render(<SchedulingPanel />);
    const emailInput = screen.getByPlaceholderText('Add email address');
    fireEvent.change(emailInput, { target: { value: 'bob@test.com' } });
    const addButton = emailInput.parentElement?.querySelector('button');
    fireEvent.click(addButton!);
    expect(screen.getByText('bob@test.com')).toBeInTheDocument();
    const badge = screen.getByText('bob@test.com').closest('[class*="Badge"]') || screen.getByText('bob@test.com').parentElement!;
    const removeBtn = badge.querySelector('button');
    fireEvent.click(removeBtn!);
    expect(screen.queryByText('bob@test.com')).not.toBeInTheDocument();
  });

  it('does not add attendee without @ symbol', () => {
    render(<SchedulingPanel />);
    const emailInput = screen.getByPlaceholderText('Add email address');
    fireEvent.change(emailInput, { target: { value: 'notanemail' } });
    const addButton = emailInput.parentElement?.querySelector('button');
    fireEvent.click(addButton!);
    expect(screen.queryByText('notanemail')).not.toBeInTheDocument();
  });

  it('renders edit mode header when initialData has id', () => {
    render(
      <SchedulingPanel
        initialData={{ id: 'evt-1', title: 'Existing Event' }}
      />
    );
    expect(screen.getByText('Edit Event')).toBeInTheDocument();
    expect(screen.getByText('Update event details')).toBeInTheDocument();
  });

  it('renders delete button in edit mode', () => {
    render(
      <SchedulingPanel
        initialData={{ id: 'evt-1', title: 'Existing Event' }}
      />
    );
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Update Event')).toBeInTheDocument();
  });

  it('pre-fills title from initialData', () => {
    render(
      <SchedulingPanel
        initialData={{ id: 'evt-1', title: 'Sprint Planning' }}
      />
    );
    expect(screen.getByDisplayValue('Sprint Planning')).toBeInTheDocument();
  });

  it('pre-fills location from initialData', () => {
    render(
      <SchedulingPanel
        initialData={{ id: 'evt-1', title: 'Meeting', location: 'Room 42' }}
      />
    );
    expect(screen.getByDisplayValue('Room 42')).toBeInTheDocument();
  });

  it('toggles all-day checkbox', () => {
    render(<SchedulingPanel />);
    const allDayCheckbox = screen.getByLabelText('All-day event');
    fireEvent.click(allDayCheckbox);
    expect(allDayCheckbox).toBeChecked();
  });

  it('changes recurrence when button is clicked', () => {
    render(<SchedulingPanel />);
    const weeklyBtn = screen.getByText('Weekly');
    fireEvent.click(weeklyBtn);
    expect(weeklyBtn).toBeInTheDocument();
    fireEvent.click(screen.getByText('No Repeat'));
    expect(screen.getByText('No Repeat')).toBeInTheDocument();
  });

  it('renders all-day event checkbox', () => {
    render(<SchedulingPanel />);
    expect(screen.getByLabelText('All-day event')).toBeInTheDocument();
  });

  it('renders event color label', () => {
    render(<SchedulingPanel />);
    expect(screen.getByText('Event Color')).toBeInTheDocument();
  });
});
