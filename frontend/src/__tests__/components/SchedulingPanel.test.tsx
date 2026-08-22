import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SchedulingPanel from '@/features/calendar/components/SchedulingPanel';
import type { CalendarEvent } from '@/features/calendar/types';
import enCalendar from '@/i18n/locales/en/calendar.json';

// Resolve translations from the real calendar namespace so assertions exercise
// actual copy, falling back to defaultValue like production i18next would.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: { defaultValue?: string; count?: number }) => {
        // Emulate i18next plural resolution (_one/_other suffixes).
        const dict = enCalendar as Record<string, string>;
        const count = opts?.count;
        const entry =
          (count !== undefined
            ? dict[`${key}_${count === 1 ? 'one' : 'other'}`]
            : undefined) ??
          dict[key] ??
          opts?.defaultValue ??
          key;
        return typeof entry === 'string' && count !== undefined
          ? entry.replace('{{count}}', String(count))
          : entry;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('@/lib/cn', () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' '),
}));

const baseEvent = (): Partial<CalendarEvent> => ({
  id: 'evt-1',
  title: 'Existing meeting',
  start_time: '2026-08-10T09:00:00.000Z',
  end_time: '2026-08-10T10:00:00.000Z',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SchedulingPanel', () => {
  it('renders the scheduling form header', () => {
    render(<SchedulingPanel />);
    expect(screen.getByText(enCalendar.scheduleMeeting)).toBeInTheDocument();
    expect(screen.getByText(enCalendar.scheduleCreateSubtitle)).toBeInTheDocument();
  });

  it('renders edit header when editing', () => {
    render(<SchedulingPanel initialData={baseEvent()} />);
    expect(screen.getByText(enCalendar.editEvent)).toBeInTheDocument();
    expect(screen.getByText(enCalendar.update)).toBeInTheDocument();
  });

  it('renders all form fields', () => {
    render(<SchedulingPanel />);
    expect(screen.getByLabelText(/title \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/start time \*/i)).toBeInTheDocument();
    expect(screen.getAllByText(enCalendar.durationLabel).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/location/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/notes/i)).toBeInTheDocument();
    expect(screen.getByText(enCalendar.attendeesLabel)).toBeInTheDocument();
  });

  it('renders duration buttons', () => {
    render(<SchedulingPanel />);
    expect(screen.getByText(enCalendar.d15)).toBeInTheDocument();
    expect(screen.getByText(enCalendar.d30)).toBeInTheDocument();
    expect(screen.getByText(enCalendar.d60)).toBeInTheDocument();
    expect(screen.getByText(enCalendar.d120)).toBeInTheDocument();
  });

  it('renders recurrence buttons', () => {
    render(<SchedulingPanel />);
    expect(screen.getByText(enCalendar.recurrenceNone)).toBeInTheDocument();
    expect(screen.getByText(enCalendar.recurrenceDaily)).toBeInTheDocument();
    expect(screen.getByText(enCalendar.recurrenceWeekly)).toBeInTheDocument();
    expect(screen.getByText(enCalendar.recurrenceMonthly)).toBeInTheDocument();
  });

  it('renders color swatches', () => {
    const { container } = render(<SchedulingPanel />);
    const colorButtons = container.querySelectorAll('.rounded-full[style]');
    expect(colorButtons.length).toBeGreaterThan(0);
  });

  it('renders create button in create mode', () => {
    render(<SchedulingPanel />);
    expect(screen.getByText(enCalendar.create)).toBeInTheDocument();
  });

  it('calls onCancel', () => {
    const onCancel = vi.fn();
    render(<SchedulingPanel onCancel={onCancel} />);
    fireEvent.click(screen.getAllByRole('button', { name: enCalendar.cancel })[0]);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables create until a title exists', () => {
    render(<SchedulingPanel />);
    const submit = screen.getByRole('button', { name: enCalendar.create });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/title \*/i), { target: { value: 'Sync' } });
    expect(submit).toBeEnabled();
  });

  it('submits a full payload including end time and recurrence', () => {
    const onSubmit = vi.fn();
    render(<SchedulingPanel onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/title \*/i), { target: { value: 'Team sync' } });
    fireEvent.change(screen.getByLabelText(/date \*/i), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByText(enCalendar.d90));
    fireEvent.click(screen.getByText(enCalendar.recurrenceWeekly));
    fireEvent.click(screen.getByRole('button', { name: enCalendar.create }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0] as Partial<CalendarEvent>;
    expect(payload.title).toBe('Team sync');
    expect(payload.is_recurring).toBe(true);
    expect(payload.recurrence_rule).toBe('RRULE:FREQ=WEEKLY');
    const duration =
      (new Date(payload.end_time!).getTime() - new Date(payload.start_time!).getTime()) / 60000;
    expect(duration).toBe(90);
  });

  it('derives duration from the event being edited', () => {
    const onSubmit = vi.fn();
    // Edited event runs 60 minutes; do NOT touch duration controls.
    render(<SchedulingPanel onSubmit={onSubmit} initialData={baseEvent()} />);
    fireEvent.click(screen.getByRole('button', { name: enCalendar.update }));
    const payload = onSubmit.mock.calls[0][0] as Partial<CalendarEvent>;
    const duration =
      (new Date(payload.end_time!).getTime() - new Date(payload.start_time!).getTime()) / 60000;
    expect(duration).toBe(60);
  });

  it('shows the delete action only when editing with a handler', () => {
    const onDelete = vi.fn();
    const { rerender } = render(<SchedulingPanel />);
    expect(screen.queryByRole('button', { name: enCalendar.delete })).not.toBeInTheDocument();

    rerender(<SchedulingPanel onDelete={onDelete} />);
    expect(screen.queryByRole('button', { name: enCalendar.delete })).not.toBeInTheDocument();

    rerender(<SchedulingPanel onDelete={onDelete} initialData={baseEvent()} />);
    fireEvent.click(screen.getByRole('button', { name: enCalendar.delete }));
    expect(onDelete).toHaveBeenCalledWith('evt-1');
  });

  it('adds and removes attendees', () => {
    render(<SchedulingPanel />);
    const input = screen.getByPlaceholderText(enCalendar.addAttendeePlaceholder);
    fireEvent.change(input, { target: { value: 'peer@uni.edu' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('peer@uni.edu')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove peer@uni.edu' }));
    expect(screen.queryByText('peer@uni.edu')).not.toBeInTheDocument();
  });

  it('warns about conflicting events live', () => {
    const existing = [
      {
        id: 'other',
        title: 'Overlap source',
        start_time: '2026-08-10T09:30:00.000Z',
        end_time: '2026-08-10T10:30:00.000Z',
        is_all_day: false,
        provider: 'local' as const,
        is_recurring: false,
      },
    ];
    render(
      <SchedulingPanel
        initialData={{ ...baseEvent(), start_time: '2026-08-10T08:00:00Z', end_time: '2026-08-10T09:45:00Z' }}
        existingEvents={existing}
      />,
    );
    // Editing evt-1 excludes itself but "Overlap source" collides.
    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((a) => /conflicts with/i.test(a.textContent ?? ''))).toBe(true);
    expect(screen.getByText(/Overlap source/)).toBeInTheDocument();
  });
});
