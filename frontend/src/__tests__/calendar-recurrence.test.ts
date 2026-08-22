import { describe, it, expect } from 'vitest';
import {
  parseRecurrenceRule,
  expandRecurringEvents,
  findOverlappingEvents,
} from '../features/calendar/utils/recurrence';
import type { CalendarEvent } from '../features/calendar/types';

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    title: 'Standup',
    start_time: '2026-08-10T09:00:00.000Z',
    end_time: '2026-08-10T09:30:00.000Z',
    is_all_day: false,
    provider: 'local',
    is_recurring: false,
    ...overrides,
  };
}

describe('parseRecurrenceRule', () => {
  it('parses freq and interval', () => {
    expect(parseRecurrenceRule('RRULE:FREQ=DAILY;INTERVAL=2')).toEqual({ freq: 'DAILY', interval: 2 });
    expect(parseRecurrenceRule('FREQ=WEEKLY')).toEqual({ freq: 'WEEKLY', interval: 1 });
  });

  it('returns null for missing or unsupported rules', () => {
    expect(parseRecurrenceRule(undefined)).toBeNull();
    expect(parseRecurrenceRule('RRULE:FREQ=YEARLY')).toBeNull();
    expect(parseRecurrenceRule('not a rule')).toBeNull();
  });

  it('clamps non-positive intervals to 1', () => {
    expect(parseRecurrenceRule('FREQ=DAILY;INTERVAL=0')?.interval).toBe(1);
    expect(parseRecurrenceRule('FREQ=DAILY;INTERVAL=-3')?.interval).toBe(1);
  });
});

describe('expandRecurringEvents', () => {
  const range = { start: new Date('2026-08-01T00:00:00.000Z'), end: new Date('2026-08-31T23:59:59.999Z') };

  it('passes non-recurring events through untouched', () => {
    const event = makeEvent();
    expect(expandRecurringEvents([event], range.start, range.end)).toEqual([event]);
  });

  it('expands daily events across the visible range', () => {
    const event = makeEvent({ is_recurring: true, recurrence_rule: 'RRULE:FREQ=DAILY' });
    const out = expandRecurringEvents([event], range.start, range.end);
    // Aug 1..31 with the base starting Aug 10 → occurrences on 10..31 = 22
    expect(out).toHaveLength(22);
    expect(out[0].start_time).toBe('2026-08-10T09:00:00.000Z');
    expect(out[0].id).toContain(':');
    expect(new Date(out[1].start_time).getUTCDate()).toBe(11);
  });

  it('respects INTERVAL for weekly rules', () => {
    const event = makeEvent({
      is_recurring: true,
      recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2',
      start_time: '2026-08-03T10:00:00.000Z', // Monday
      end_time: '2026-08-03T11:00:00.000Z',
    });
    const out = expandRecurringEvents([event], range.start, range.end);
    // Aug 3, 17, 31 — biweekly Mondays in range
    expect(out.map((e) => new Date(e.start_time).getUTCDate())).toEqual([3, 17, 31]);
  });

  it('expands monthly and clamps short months', () => {
    const event = makeEvent({
      is_recurring: true,
      recurrence_rule: 'FREQ=MONTHLY',
      start_time: '2026-01-31T12:00:00.000Z',
      end_time: '2026-01-31T13:00:00.000Z',
    });
    const range2026 = { start: new Date('2026-01-01T00:00:00.000Z'), end: new Date('2026-04-30T23:59:59.999Z') };
    const out = expandRecurringEvents([event], range2026.start, range2026.end);
    // Jan 31, Feb 28 (clamped), Mar 31, Apr 30 (clamped)
    expect(out.map((e) => e.start_time)).toEqual([
      '2026-01-31T12:00:00.000Z',
      '2026-02-28T12:00:00.000Z',
      '2026-03-31T12:00:00.000Z',
      '2026-04-30T12:00:00.000Z',
    ]);
  });

  it('keeps occurrence duration identical to the base event', () => {
    const event = makeEvent({ is_recurring: true, recurrence_rule: 'FREQ=DAILY' });
    const [first] = expandRecurringEvents([event], range.start, range.end);
    const duration =
      new Date(first.end_time).getTime() - new Date(first.start_time).getTime();
    const baseDuration =
      new Date(event.end_time).getTime() - new Date(event.start_time).getTime();
    expect(duration).toBe(baseDuration);
  });

  it('falls back to showing the base event when a recurring flag has no usable rule', () => {
    const event = makeEvent({ is_recurring: true, recurrence_rule: undefined });
    const out = expandRecurringEvents([event], range.start, range.end);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('evt-1');
  });
});

describe('findOverlappingEvents', () => {
  const existing = [
    makeEvent({ id: 'a', title: 'A', start_time: '2026-08-10T09:00:00.000Z', end_time: '2026-08-10T10:00:00.000Z' }),
    makeEvent({ id: 'b', title: 'B', start_time: '2026-08-10T10:30:00.000Z', end_time: '2026-08-10T11:30:00.000Z' }),
  ];

  it('detects direct overlaps', () => {
    const conflicts = findOverlappingEvents(
      { start_time: '2026-08-10T09:30:00.000Z', end_time: '2026-08-10T10:30:00.000Z' },
      existing,
    );
    expect(conflicts.map((c) => c.id)).toEqual(['a']);
  });

  it('ignores back-to-back events', () => {
    const conflicts = findOverlappingEvents(
      { start_time: '2026-08-10T10:00:00.000Z', end_time: '2026-08-10T10:30:00.000Z' },
      existing,
    );
    expect(conflicts).toHaveLength(0);
  });

  it('excludes the edited event itself', () => {
    const conflicts = findOverlappingEvents(
      { start_time: '2026-08-10T09:00:00.000Z', end_time: '2026-08-10T10:00:00.000Z' },
      [...existing, makeEvent({ id: 'self', start_time: '2026-08-10T09:15:00.000Z', end_time: '2026-08-10T09:45:00.000Z' })],
      'self',
    );
    expect(conflicts.map((c) => c.id)).toEqual(['a']);
  });
});
