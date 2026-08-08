// Calendar Types - Phase 2: Frontend Components

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  provider: 'google' | 'local' | 'manual' | 'email';
  external_id?: string;
  external_link?: string;
  color?: string;
  attendees?: CalendarAttendee[];
  recurrence_rule?: string;
  is_recurring: boolean;
}

export interface CalendarAttendee {
  id?: string;
  email: string;
  name?: string;
  status: 'pending' | 'accepted' | 'declined' | 'tentative' | 'needs_action';
}

export interface CalendarSettings {
  user_id: string;
  default_calendar_id?: string;
  timezone: string;
  week_start_day: number;
  working_hours_start: string;
  working_hours_end: string;
  working_days: number[];
  google_calendar_id?: string;
  auto_sync: boolean;
}

export interface FreeSlot {
  start: string;
  end: string;
  duration_minutes: number;
  formatted: string;
}

export interface FreeSlotDay {
  date: string;
  day_name: string;
  slots: FreeSlot[];
}

export interface CalendarInsights {
  period: 'today' | 'tomorrow' | 'this_week' | 'this_month';
  event_count: number;
  free_day?: boolean;
  time_distribution?: {
    morning: number;
    afternoon: number;
    evening: number;
  };
  total_hours?: number;
  avg_event_duration_minutes?: number;
  busiest_day?: string;
  busiest_day_count?: number;
  meetings_count?: number;
  focus_time_count?: number;
  collaborative_events?: number;
  early_morning_events?: number;
  late_evening_events?: number;
  conflicts?: CalendarConflict[];
  has_conflicts?: boolean;
  suggestions?: string[];
  today?: {
    first_event: { title: string; time: string } | null;
    next_event: { title: string; time: string; minutes_until: number } | null;
    current_time: string;
  };
}

export interface CalendarConflict {
  event1: { id: string; title: string };
  event2: { id: string; title: string };
  overlap_minutes: number;
}

export interface OptimalTimeSlot {
  date: string;
  start_time: string;
  end_time: string;
  formatted: string;
  day_name: string;
  is_full_day_available?: boolean;
  score: number;
}

export type CalendarView = 'day' | 'week' | 'month';

export interface CalendarState {
  events: CalendarEvent[];
  selectedDate: Date;
  view: CalendarView;
  isLoading: boolean;
  error?: string;
}