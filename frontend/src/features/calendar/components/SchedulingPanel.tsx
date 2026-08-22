import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Clock, MapPin, Users, X, Plus, Trash2, Save, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { CalendarEvent } from '../types';
import { findOverlappingEvents } from '../utils/recurrence';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/core/Label';
import { Checkbox } from '@/components/ui/core/Checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface SchedulingPanelProps {
  onSubmit?: (event: Partial<CalendarEvent>) => void;
  onCancel?: () => void;
  onDelete?: (eventId: string) => void;
  initialData?: Partial<CalendarEvent>;
  /** Known events used for live conflict detection while editing. */
  existingEvents?: CalendarEvent[];
  availableSlots?: { start: string; end: string }[];
  className?: string;
}

type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

/** Local date + "HH:mm" → ISO string in the user's timezone. */
function toLocalIso(date: string, time: string): string {
  return new Date(`${date}T${time || '00:00'}`).toISOString();
}

/** Minutes between two "HH:mm" times on the same day (handles midnight wrap). */
function diffMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60; // end before start → assume next-day wrap
  return mins;
}

function addMinutesToTime(start: string, minutes: number): string {
  const [h, m] = start.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function SchedulingPanel({
  onSubmit,
  onCancel,
  onDelete,
  initialData,
  existingEvents = [],
  availableSlots: _availableSlots,
  className,
}: SchedulingPanelProps) {
  const { t } = useTranslation("calendar");
  const isEditing = !!initialData?.id;

  const [title, setTitle] = useState(initialData?.title || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [location, setLocation] = useState(initialData?.location || '');
  const [date, setDate] = useState(
    initialData?.start_time
      ? new Date(initialData.start_time).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]
  );
  const [startTime, setStartTime] = useState(
    initialData?.start_time
      ? new Date(initialData.start_time).toTimeString().slice(0, 5)
      : '09:00'
  );
  // Duration derived from the real start/end when editing an existing event.
  const [duration, setDuration] = useState(() => {
    if (initialData?.start_time && initialData?.end_time) {
      const mins = Math.round(
        (new Date(initialData.end_time).getTime() - new Date(initialData.start_time).getTime()) / 60000,
      );
      if (Number.isFinite(mins) && mins > 0) return mins;
    }
    return 60;
  });
  const [endTime, setEndTime] = useState(() =>
    initialData?.start_time && initialData?.end_time
      ? new Date(initialData.end_time).toTimeString().slice(0, 5)
      : '10:00'
  );
  const [attendees, setAttendees] = useState<{ email: string; name?: string }[]>(
    initialData?.attendees?.map(a => ({ email: a.email, name: a.name })) || []
  );
  const [newAttendee, setNewAttendee] = useState('');
  const [isAllDay, setIsAllDay] = useState(initialData?.is_all_day || false);
  const [color, setColor] = useState(initialData?.color || '#3B82F6');
  const [recurrence, setRecurrence] = useState<Recurrence>(() => {
    const rule = initialData?.recurrence_rule?.toUpperCase() ?? '';
    if (rule.includes('DAILY')) return 'daily';
    if (rule.includes('WEEKLY')) return 'weekly';
    if (rule.includes('MONTHLY')) return 'monthly';
    return 'none';
  });

  const durations = [15, 30, 45, 60, 90, 120, 180];
  const durationLabel = (mins: number) =>
    t(`d${mins}`, { defaultValue: `${mins} min` });

  const colors = [
    '#3B82F6',
    '#22c55e',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#ec4899',
    '#06b6d4',
    '#f97316',
  ];

  const addAttendee = () => {
    if (newAttendee && newAttendee.includes('@')) {
      setAttendees([...attendees, { email: newAttendee }]);
      setNewAttendee('');
    }
  };

  const removeAttendee = (email: string) => {
    setAttendees(attendees.filter(a => a.email !== email));
  };

  const handleDurationSelect = (mins: number) => {
    setDuration(mins);
    setEndTime(addMinutesToTime(startTime, mins));
  };

  const handleEndTimeChange = (value: string) => {
    setEndTime(value);
    if (value) setDuration(diffMinutes(startTime, value));
  };

  // Live conflict detection against the user's existing events.
  const conflicts = useMemo(() => {
    if (!date) return [];
    const startIso = toLocalIso(date, isAllDay ? '00:00' : startTime);
    const endIso = toLocalIso(
      date,
      isAllDay ? '23:59' : endTime || addMinutesToTime(startTime, duration),
    );
    return findOverlappingEvents(
      { start_time: startIso, end_time: endIso },
      existingEvents,
      initialData?.id,
    );
  }, [date, startTime, endTime, duration, isAllDay, existingEvents, initialData?.id]);

  const handleSubmit = () => {
    const startDateTime = new Date(`${date}T${isAllDay ? '00:00' : startTime}`);
    const endDateTime = new Date(
      isAllDay
        ? `${date}T23:59:59`
        : `${date}T${endTime || addMinutesToTime(startTime, duration)}`,
    );

    const event: Partial<CalendarEvent> = {
      id: initialData?.id,
      title,
      description,
      location,
      start_time: startDateTime.toISOString(),
      end_time: endDateTime.toISOString(),
      is_all_day: isAllDay,
      color,
      provider: initialData?.provider ?? 'manual',
      is_recurring: recurrence !== 'none',
      recurrence_rule: recurrence !== 'none' ? `RRULE:FREQ=${recurrence.toUpperCase()}` : undefined,
      attendees: attendees.map(a => ({
        ...a,
        status: initialData?.attendees?.find(x => x.email === a.email)?.status ?? 'pending',
      })),
    };

    onSubmit?.(event);
  };

  const isValid = title.trim().length > 0 && date && (isAllDay || startTime);

  return (
    <div className={cn("bg-card rounded-xl border border-border overflow-hidden shadow-lg", className)} dir="auto">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-primary text-primary-foreground">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              {isEditing ? t('editEvent') : t('scheduleMeeting')}
            </h2>
            <p className="text-sm text-primary-foreground/80">
              {isEditing ? t('scheduleEditSubtitle') : t('scheduleCreateSubtitle')}
            </p>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              className="p-2 hover:bg-primary-foreground/20 rounded-lg transition-colors"
              aria-label={t('cancel')}
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Form */}
      <div className="p-6 space-y-6">
        {/* Conflict warning */}
        {conflicts.length > 0 && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-sm text-foreground"
          >
            <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <p className="font-medium">
                {t('conflictsBanner', { count: conflicts.length })}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground truncate">
                {conflicts.map(c => c.title).join(' · ')}
              </p>
            </div>
          </div>
        )}

        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="title">{t('titleLabel')}</Label>
          <Input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('titlePlaceholder')}
          />
        </div>

        {/* Date & Time */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="date">
              <Calendar className="w-4 h-4 inline mr-1 rtl:mr-0 rtl:ml-1" />
              {t('dateLabel')}
            </Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="time">
              <Clock className="w-4 h-4 inline mr-1 rtl:mr-0 rtl:ml-1" />
              {t('startTimeLabel')}
            </Label>
            <Input
              id="time"
              type="time"
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value);
                if (e.target.value) setEndTime(addMinutesToTime(e.target.value, duration));
              }}
              disabled={isAllDay}
            />
          </div>
        </div>

        {/* Duration + End time */}
        {!isAllDay && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="endTime">{t('durationLabel')}</Label>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  id="endTime"
                  type="time"
                  value={endTime}
                  onChange={(e) => handleEndTimeChange(e.target.value)}
                  className="h-7 w-28 text-xs"
                  aria-label={t('endTimeLabel')}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {durations.map((mins) => (
                <Button
                  key={mins}
                  variant={duration === mins ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleDurationSelect(mins)}
                >
                  {durationLabel(mins)}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* All Day Toggle */}
        <div className="flex items-center space-x-2 rtl:space-x-reverse">
          <Checkbox
            id="allDay"
            checked={isAllDay}
            onCheckedChange={(checked) => setIsAllDay(checked as boolean)}
          />
          <Label htmlFor="allDay" className="cursor-pointer">
            {t('allDay')}
          </Label>
        </div>

        {/* Recurrence */}
        <div className="space-y-2">
          <Label>{t('recurrenceLabel')}</Label>
          <div className="flex flex-wrap gap-2">
            {(['none', 'daily', 'weekly', 'monthly'] as const).map((r) => (
              <Button
                key={r}
                variant={recurrence === r ? "default" : "outline"}
                size="sm"
                onClick={() => setRecurrence(r)}
              >
                {r === 'none'
                  ? t('recurrenceNone')
                  : t(`recurrence${r.charAt(0).toUpperCase()}${r.slice(1)}`)}
              </Button>
            ))}
          </div>
        </div>

        <Separator />

        {/* Location */}
        <div className="space-y-2">
          <Label htmlFor="location">
            <MapPin className="w-4 h-4 inline mr-1 rtl:mr-0 rtl:ml-1" />
            {t('locationLabel')}
          </Label>
          <Input
            id="location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t('locationPlaceholder')}
          />
        </div>

        {/* Color */}
        <div className="space-y-2">
          <Label>{t('colorLabel')}</Label>
          <div className="flex gap-2">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                className={cn(
                  "w-8 h-8 rounded-full transition-all hover:scale-110",
                  color === c && "ring-2 ring-offset-2 ring-primary scale-110"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* Attendees */}
        <div className="space-y-2">
          <Label>
            <Users className="w-4 h-4 inline mr-1 rtl:mr-0 rtl:ml-1" />
            {t('attendeesLabel')}
          </Label>

          <div className="flex gap-2">
            <Input
              type="email"
              value={newAttendee}
              onChange={(e) => setNewAttendee(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAttendee())}
              placeholder={t('addAttendeePlaceholder')}
            />
            <Button
              onClick={addAttendee}
              disabled={!newAttendee}
              size="icon"
              variant="outline"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {attendees.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {attendees.map((attendee) => (
                <Badge
                  key={attendee.email}
                  variant="secondary"
                  className="flex items-center gap-2 ps-1 pe-1"
                >
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">
                    {attendee.email[0].toUpperCase()}
                  </div>
                  <span className="text-xs">{attendee.email}</span>
                  <button
                    onClick={() => removeAttendee(attendee.email)}
                    aria-label={`Remove ${attendee.email}`}
                    className="p-0.5 hover:bg-muted rounded transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description">{t('notesLabel')}</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder={t('notesPlaceholder')}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="px-6 py-4 border-t border-border bg-muted/50 flex gap-3">
        <Button
          onClick={onCancel}
          variant="outline"
          className="flex-1"
        >
          {t('cancel')}
        </Button>
        {isEditing && onDelete && initialData?.id && (
          <Button
            variant="destructive"
            className="gap-2"
            onClick={() => onDelete(initialData.id!)}
          >
            <Trash2 className="w-4 h-4" />
            {t('delete')}
          </Button>
        )}
        <Button
          onClick={handleSubmit}
          disabled={!isValid}
          className="flex-1 gap-2"
        >
          <Save className="w-4 h-4" />
          {isEditing ? t('update') : t('create')}
        </Button>
      </div>
    </div>
  );
}
