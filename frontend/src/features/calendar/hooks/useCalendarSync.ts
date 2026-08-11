import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { startOfDay, format, addDays, isSameDay } from 'date-fns';
import type { CalendarEvent, CalendarInsights, FreeSlotDay } from '../types';

const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

interface UseCalendarSyncOptions {
  userId?: string;
}

interface UseCalendarSyncReturn {
  events: CalendarEvent[];
  insights: CalendarInsights | null;
  isCalendarLoading: boolean;
  error: string | null;
  
  // Actions
  fetchEvents: (period?: 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'this_month', days?: number) => Promise<void>;
  fetchInsights: (period?: 'today' | 'tomorrow' | 'this_week' | 'this_month') => Promise<void>;
  createEvent: (event: Partial<CalendarEvent>) => Promise<{ success: boolean; event?: CalendarEvent; error?: string }>;
  updateEvent: (eventId: string, updates: Partial<CalendarEvent>) => Promise<{ success: boolean; error?: string }>;
  deleteEvent: (eventId: string) => Promise<{ success: boolean; error?: string }>;
  findFreeSlots: (duration: number, daysAhead?: number) => Promise<FreeSlotDay[]>;
}

export default function useCalendarSync(options?: UseCalendarSyncOptions): UseCalendarSyncReturn {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [insights, setInsights] = useState<CalendarInsights | null>(null);
  const [isCalendarLoading, setIsCalendarLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async (
    period: 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'this_month' = 'this_week',
    days?: number
  ) => {
    if (!options?.userId) {
      setError('User not authenticated');
      return;
    }

    setIsCalendarLoading(true);
    setError(null);

    try {
      // Calculate date range in user's local timezone
      const now = new Date();
      let startDate = startOfDay(now);
      let endDate = startOfDay(addDays(now, 1));

      switch (period) {
        case 'today':
          startDate = startOfDay(now);
          endDate = startOfDay(addDays(now, 1));
          break;
        case 'tomorrow':
          startDate = startOfDay(addDays(now, 1));
          endDate = startOfDay(addDays(now, 2));
          break;
        case 'this_week': {
          const dayOfWeek = now.getDay();
          startDate = startOfDay(addDays(now, -dayOfWeek));
          endDate = startOfDay(addDays(startDate, 7));
          break;
        }
        case 'next_week': {
          const dayOfWeek2 = now.getDay();
          const nextSunday = addDays(now, 7 - dayOfWeek2);
          endDate = startOfDay(addDays(nextSunday, 7));
          startDate = startOfDay(nextSunday);
          break;
        }
        case 'this_month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
          break;
      }

      if (days) {
        endDate = startOfDay(addDays(startDate, days));
      }

      const { data, error: fetchError } = await supabase
        .from('user_calendar_events')
        .select(`
          *,
          user_calendar_attendees(id, email, name, status)
        `)
        .eq('user_id', options.userId)
        .gte('start_time', startDate.toISOString())
        .lte('start_time', endDate.toISOString())
        .order('start_time', { ascending: true });

      if (fetchError) throw fetchError;

      setEvents(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch events');
      console.error('[Calendar] fetchEvents error:', err);
    } finally {
      setIsCalendarLoading(false);
    }
  }, [options?.userId]);

  const fetchInsights = useCallback(async (
    period: 'today' | 'tomorrow' | 'this_week' | 'this_month' = 'today'
  ) => {
    if (!options?.userId) {
      setError('User not authenticated');
      return;
    }

    setIsCalendarLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('user_calendar_events')
        .select(`
          *,
          user_calendar_attendees(id, email, name, status)
        `)
        .eq('user_id', options.userId);

      if (fetchError) throw fetchError;

      // Calculate insights from events in user's local timezone
      const now = new Date();
      let startDate = startOfDay(now);
      let endDate = startOfDay(addDays(now, 1));

      switch (period) {
        case 'today':
          startDate = startOfDay(now);
          endDate = startOfDay(addDays(now, 1));
          break;
        case 'tomorrow':
          startDate = startOfDay(addDays(now, 1));
          endDate = startOfDay(addDays(now, 2));
          break;
        case 'this_week': {
          const dayOfWeek = now.getDay();
          startDate = startOfDay(addDays(now, -dayOfWeek));
          endDate = startOfDay(addDays(startDate, 7));
          break;
        }
        case 'this_month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
          break;
      }

      const periodEvents = (data || []).filter((e: CalendarEvent) => {
        const eventDate = new Date(e.start_time);
        return eventDate >= startDate && eventDate <= endDate;
      });

      // Calculate time distribution
      const morningEvents = periodEvents.filter((e: CalendarEvent) => {
        const hour = new Date(e.start_time).getHours();
        return hour >= 6 && hour < 12;
      }).length;

      const afternoonEvents = periodEvents.filter((e: CalendarEvent) => {
        const hour = new Date(e.start_time).getHours();
        return hour >= 12 && hour < 18;
      }).length;

      const eveningEvents = periodEvents.filter((e: CalendarEvent) => {
        const hour = new Date(e.start_time).getHours();
        return hour >= 18 || hour < 6;
      }).length;

      // Calculate total hours
      const totalMinutes = periodEvents.reduce((sum: number, event: CalendarEvent) => {
        const start = new Date(event.start_time);
        const end = new Date(event.end_time);
        return sum + (end.getTime() - start.getTime()) / (60 * 1000);
      }, 0);

      const insightsData: CalendarInsights = {
        period,
        event_count: periodEvents.length,
        time_distribution: {
          morning: morningEvents,
          afternoon: afternoonEvents,
          evening: eveningEvents,
        },
        total_hours: Math.round(totalMinutes / 60 * 10) / 10,
        avg_event_duration_minutes: periodEvents.length > 0 
          ? Math.round(totalMinutes / periodEvents.length) 
          : 0,
      };

      setInsights(insightsData);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch insights');
      console.error('[Calendar] fetchInsights error:', err);
    } finally {
      setIsCalendarLoading(false);
    }
  }, [options?.userId]);

  const createEvent = useCallback(async (event: Partial<CalendarEvent>) => {
    if (!options?.userId) {
      return { success: false, error: 'User not authenticated' };
    }

    try {
      const { data, error: createError } = await supabase
        .from('user_calendar_events')
        .insert({
          user_id: options.userId,
          title: event.title,
          description: event.description,
          location: event.location,
          start_time: event.start_time,
          end_time: event.end_time,
          is_all_day: event.is_all_day || false,
          color: event.color || '#3B82F6',
          provider: 'local',
        })
        .select()
        .single();

      if (createError) throw createError;

      // Add attendees if any
      if (event.attendees && event.attendees.length > 0) {
        const attendeeRecords = event.attendees.map(a => ({
          event_id: data.id,
          email: a.email,
          name: a.name,
          status: a.status || 'pending',
        }));

        await supabase
          .from('user_calendar_attendees')
          .insert(attendeeRecords);
      }

      // Refresh events
      await fetchEvents();

      return { success: true, event: data };
    } catch (err: any) {
      console.error('[Calendar] createEvent error:', err);
      return { success: false, error: err.message };
    }
  }, [options?.userId, fetchEvents]);

  const updateEvent = useCallback(async (eventId: string, updates: Partial<CalendarEvent>) => {
    if (!options?.userId) {
      return { success: false, error: 'User not authenticated' };
    }

    try {
      const { error: updateError } = await supabase
        .from('user_calendar_events')
        .update({
          title: updates.title,
          description: updates.description,
          location: updates.location,
          start_time: updates.start_time,
          end_time: updates.end_time,
          is_all_day: updates.is_all_day,
          color: updates.color,
        })
        .eq('id', eventId)
        .eq('user_id', options.userId);

      if (updateError) throw updateError;

      // Update attendees if provided
      if (updates.attendees) {
        // Delete existing attendees
        await supabase
          .from('user_calendar_attendees')
          .delete()
          .eq('event_id', eventId);

        // Insert new attendees
        const attendeeRecords = updates.attendees.map(a => ({
          event_id: eventId,
          email: a.email,
          name: a.name,
          status: a.status || 'pending',
        }));

        await supabase
          .from('user_calendar_attendees')
          .insert(attendeeRecords);
      }

      // Refresh events
      await fetchEvents();

      return { success: true };
    } catch (err: any) {
      console.error('[Calendar] updateEvent error:', err);
      return { success: false, error: err.message };
    }
  }, [options?.userId, fetchEvents]);

  const deleteEvent = useCallback(async (eventId: string) => {
    if (!options?.userId) {
      return { success: false, error: 'User not authenticated' };
    }

    try {
      // Delete attendees first
      await supabase
        .from('user_calendar_attendees')
        .delete()
        .eq('event_id', eventId);

      // Delete the event
      const { error: deleteError } = await supabase
        .from('user_calendar_events')
        .delete()
        .eq('id', eventId)
        .eq('user_id', options.userId);

      if (deleteError) throw deleteError;

      // Refresh events
      await fetchEvents();

      return { success: true };
    } catch (err: any) {
      console.error('[Calendar] deleteEvent error:', err);
      return { success: false, error: err.message };
    }
  }, [options?.userId, fetchEvents]);

  const findFreeSlots = useCallback(async (duration: number, daysAhead: number = 7): Promise<FreeSlotDay[]> => {
    if (!options?.userId) {
      return [];
    }

    try {
      // Get user settings
      const { data: settings } = await supabase
        .from('user_calendar_settings')
        .select('working_hours_start, working_hours_end, working_days')
        .eq('user_id', options.userId)
        .single();

      const workStart = settings?.working_hours_start || '09:00';
      const workEnd = settings?.working_hours_end || '17:00';
      const workingDays = settings?.working_days || [0, 1, 2, 3, 4];

      // Fetch all events in the range
      const now = new Date();
      const startDate = now;
      const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

      const { data: allEvents } = await supabase
        .from('user_calendar_events')
        .select('start_time, end_time')
        .eq('user_id', options.userId)
        .gte('start_time', startDate.toISOString())
        .lte('end_time', endDate.toISOString());

      const freeSlots: FreeSlotDay[] = [];

      // For each day
      for (let day = 0; day < daysAhead; day++) {
        const currentDay = startOfDay(addDays(now, day));
        
        if (!workingDays.includes(currentDay.getDay())) continue;

        const [startHour, startMin] = workStart.split(':').map(Number);
        const [endHour, endMin] = workEnd.split(':').map(Number);

        const dayStart = new Date(currentDay);
        dayStart.setHours(startHour, startMin, 0, 0);

        const dayEnd = new Date(currentDay);
        dayEnd.setHours(endHour, endMin, 0, 0);

        // Find busy slots for this day
        const dayEvents = (allEvents || []).filter((e: any) => {
          const eventStart = new Date(e.start_time);
          return isSameDay(eventStart, currentDay);
        });

        // Sort events by start time
        dayEvents.sort((a: any, b: any) => 
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
        );

        const slots: any[] = [];
        let slotStart = new Date(dayStart);

        for (const event of dayEvents) {
          const eventStart = new Date(event.start_time);
          const eventEnd = new Date(event.end_time);

          // Check for gap before this event
          if (slotStart < eventStart) {
            const gapEnd = eventStart;
            const gapDuration = (gapEnd.getTime() - slotStart.getTime()) / (60 * 1000);

            if (gapDuration >= duration) {
              slots.push({
                start: slotStart.toISOString(),
                end: gapEnd.toISOString(),
                duration_minutes: Math.round(gapDuration),
                formatted: `${slotStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: USER_TZ })} - ${gapEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: USER_TZ })}`,
              });
            }
          }

          // Move slot start to after this event
          slotStart = new Date(Math.max(slotStart.getTime(), eventEnd.getTime()));
        }

        // Check remaining time after last event
        if (slotStart < dayEnd) {
          const remainingDuration = (dayEnd.getTime() - slotStart.getTime()) / (60 * 1000);
          if (remainingDuration >= duration) {
            slots.push({
              start: slotStart.toISOString(),
              end: dayEnd.toISOString(),
              duration_minutes: Math.round(remainingDuration),
              formatted: `${slotStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: USER_TZ })} - ${dayEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: USER_TZ })}`,
            });
          }
        }

        if (slots.length > 0) {
          freeSlots.push({
            date: format(currentDay, 'yyyy-MM-dd'),
            day_name: format(currentDay, 'EEEE'),
            slots: slots.slice(0, 5),
          });
        }
      }

      return freeSlots;
    } catch (err) {
      console.error('[Calendar] findFreeSlots error:', err);
      return [];
    }
  }, [options?.userId]);

  return {
    events,
    insights,
    isCalendarLoading,
    error,
    fetchEvents,
    fetchInsights,
    createEvent,
    updateEvent,
    deleteEvent,
    findFreeSlots,
  };
}