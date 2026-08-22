import { addDays, addMonths, isSameDay } from 'date-fns';
import type { CalendarEvent } from '../types';

/**
 * Minimal RRULE support for what SchedulingPanel emits:
 *   RRULE:FREQ=DAILY|WEEKLY|MONTHLY(;INTERVAL=n)
 * Anything unparseable falls back to non-repeating behavior (returned as-is),
 * never dropped.
 */
interface ParsedRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval: number;
}

export function parseRecurrenceRule(rule?: string | null): ParsedRule | null {
  if (!rule) return null;
  const body = rule.replace(/^RRULE:/i, '');
  const parts = Object.fromEntries(
    body.split(';').map((p) => p.split('=') as [string, string]),
  );
  const freq = parts.FREQ?.toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return null;
  const interval = Math.max(1, Number.parseInt(parts.INTERVAL ?? '1', 10) || 1);
  return { freq, interval };
}

/** Safety cap so a malformed rule can never hang the render loop. */
const MAX_OCCURRENCES = 500;

/**
 * Expands recurring events into concrete occurrences that intersect
 * [rangeStart, rangeEnd]. Non-recurring events pass through untouched.
 * Occurrence ids are derived (`<baseId>:<startISO>`) so React keys stay
 * stable while remaining unique per occurrence.
 */
export function expandRecurringEvents(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEvent[] {
  const out: CalendarEvent[] = [];

  for (const event of events) {
    if (!event.is_recurring || !event.start_time || !event.end_time) {
      out.push(event);
      continue;
    }

    const rule = parseRecurrenceRule(event.recurrence_rule);
    // A recurring flag without a usable rule still shows the base event.
    if (!rule) {
      out.push(event);
      continue;
    }

    const baseStart = new Date(event.start_time);
    const baseEnd = new Date(event.end_time);
    const durationMs = Math.max(0, baseEnd.getTime() - baseStart.getTime());
    const hardStop = new Date(rangeEnd.getTime() + durationMs);

    let cursor = new Date(baseStart);
    let count = 0;

    while (cursor.getTime() <= hardStop.getTime() && count < MAX_OCCURRENCES) {
      const inWindow =
        cursor.getTime() + durationMs >= rangeStart.getTime() &&
        cursor.getTime() <= rangeEnd.getTime();

      if (inWindow) {
        out.push({
          ...event,
          id: `${event.id}:${cursor.toISOString()}`,
          start_time: cursor.toISOString(),
          end_time: new Date(cursor.getTime() + durationMs).toISOString(),
        });
      }

      if (rule.freq === 'DAILY') {
        cursor = addDays(cursor, rule.interval);
      } else if (rule.freq === 'WEEKLY') {
        cursor = addDays(cursor, 7 * rule.interval);
      } else {
        // MONTHLY — clamp to month length (Jan 31 → Feb 28)
        const next = addMonths(cursor, rule.interval);
        const daysInMonth = new Date(
          next.getFullYear(), next.getMonth() + 1, 0,
        ).getDate();
        cursor = new Date(next);
        cursor.setDate(Math.min(baseStart.getDate(), daysInMonth));
      }
      count += 1;
    }
  }

  return out;
}

/**
 * Returns events that overlap the given time window. Used to warn about
 * scheduling conflicts before saving.
 */
export function findOverlappingEvents(
  candidate: Pick<CalendarEvent, 'start_time' | 'end_time'>,
  events: CalendarEvent[],
  excludeEventId?: string,
): CalendarEvent[] {
  const start = new Date(candidate.start_time).getTime();
  const end = new Date(candidate.end_time).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];

  return events.filter((other) => {
    if (excludeEventId && (other.id === excludeEventId || other.id.startsWith(`${excludeEventId}:`))) {
      return false;
    }
    const oStart = new Date(other.start_time).getTime();
    const oEnd = new Date(other.end_time).getTime();
    return start < oEnd && oStart < end;
  });
}

/** True when two dates land on the same calendar day (local time). */
export function isSameLocalDay(a: Date | string, b: Date | string): boolean {
  return isSameDay(new Date(a), new Date(b));
}
