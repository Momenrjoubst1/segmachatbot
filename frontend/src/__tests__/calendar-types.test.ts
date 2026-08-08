import { describe, it, expect } from 'vitest';
import type {
  CalendarEvent,
  CalendarAttendee,
  FreeSlot,
  CalendarInsights,
  CalendarView,
  CalendarState,
} from '../features/calendar/types/index.js';

describe('Calendar Types', () => {
  describe('CalendarEvent', () => {
    it('should accept valid event', () => {
      const event: CalendarEvent = {
        id: '123',
        title: 'Test Event',
        start_time: '2024-01-01T09:00:00Z',
        end_time: '2024-01-01T10:00:00Z',
        is_all_day: false,
        provider: 'manual',
        is_recurring: false,
      };
      expect(event.id).toBe('123');
    });

    it('should accept event with all fields', () => {
      const event: CalendarEvent = {
        id: '123',
        title: 'Test Event',
        description: 'Test description',
        location: 'Conference Room',
        start_time: '2024-01-01T09:00:00Z',
        end_time: '2024-01-01T10:00:00Z',
        is_all_day: false,
        provider: 'google',
        external_id: 'ext123',
        external_link: 'https://calendar.google.com/event/123',
        color: '#ff0000',
        attendees: [
          { email: 'test@example.com', name: 'Test User', status: 'accepted' },
        ],
        recurrence_rule: 'RRULE:FREQ=WEEKLY',
        is_recurring: true,
      };
      expect(event.attendees).toHaveLength(1);
    });
  });

  describe('CalendarAttendee', () => {
    it('should accept valid attendee', () => {
      const attendee: CalendarAttendee = {
        email: 'test@example.com',
        status: 'pending',
      };
      expect(attendee.email).toBe('test@example.com');
    });

    it('should accept all status values', () => {
      const statuses: CalendarAttendee['status'][] = [
        'pending',
        'accepted',
        'declined',
        'tentative',
        'needs_action',
      ];
      expect(statuses).toHaveLength(5);
    });
  });

  describe('CalendarView', () => {
    it('should accept valid views', () => {
      const views: CalendarView[] = ['day', 'week', 'month'];
      expect(views).toHaveLength(3);
    });
  });

  describe('CalendarState', () => {
    it('should accept valid state', () => {
      const state: CalendarState = {
        events: [],
        selectedDate: new Date(),
        view: 'week',
        isLoading: false,
      };
      expect(state.events).toHaveLength(0);
    });
  });

  describe('FreeSlot', () => {
    it('should accept valid slot', () => {
      const slot: FreeSlot = {
        start: '09:00',
        end: '10:00',
        duration_minutes: 60,
        formatted: '9:00 AM - 10:00 AM',
      };
      expect(slot.duration_minutes).toBe(60);
    });
  });

  describe('CalendarInsights', () => {
    it('should accept valid insights', () => {
      const insights: CalendarInsights = {
        period: 'today',
        event_count: 5,
        free_day: false,
        time_distribution: {
          morning: 2,
          afternoon: 2,
          evening: 1,
        },
      };
      expect(insights.event_count).toBe(5);
    });
  });
});
