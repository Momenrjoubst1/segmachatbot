import { useState } from 'react';
import { Calendar, Clock, MapPin, Users, X, Plus, Trash2, Save } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { CalendarEvent } from '../types';
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
  initialData?: Partial<CalendarEvent>;
  availableSlots?: { start: string; end: string }[];
  className?: string;
}

export default function SchedulingPanel({
  onSubmit,
  onCancel,
  initialData,
  availableSlots: _availableSlots,
  className,
}: SchedulingPanelProps) {
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
  const [duration, setDuration] = useState(60);
  const [attendees, setAttendees] = useState<{ email: string; name?: string }[]>(
    initialData?.attendees?.map(a => ({ email: a.email, name: a.name })) || []
  );
  const [newAttendee, setNewAttendee] = useState('');
  const [isAllDay, setIsAllDay] = useState(initialData?.is_all_day || false);
  const [color, setColor] = useState(initialData?.color || 'hsl(var(--primary))');
  const [recurrence, setRecurrence] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');

  const durations = [
    { value: 15, label: '15 min' },
    { value: 30, label: '30 min' },
    { value: 45, label: '45 min' },
    { value: 60, label: '1 hour' },
    { value: 90, label: '1.5 hours' },
    { value: 120, label: '2 hours' },
    { value: 180, label: '3 hours' },
  ];

  const colors = [
    'hsl(var(--primary))',
    'hsl(142 71% 45%)',
    'hsl(38 92% 50%)',
    'hsl(0 84% 60%)',
    'hsl(262 83% 58%)',
    'hsl(330 81% 60%)',
    'hsl(189 94% 43%)',
    'hsl(24 94% 53%)',
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

  const handleSubmit = () => {
    const startDateTime = new Date(`${date}T${startTime}`);
    const endDateTime = new Date(startDateTime.getTime() + duration * 60 * 1000);

    const event: Partial<CalendarEvent> = {
      id: initialData?.id || crypto.randomUUID(),
      title,
      description,
      location,
      start_time: startDateTime.toISOString(),
      end_time: endDateTime.toISOString(),
      is_all_day: isAllDay,
      color,
      provider: 'manual',
      is_recurring: recurrence !== 'none',
      recurrence_rule: recurrence !== 'none' ? `RRULE:FREQ=${recurrence.toUpperCase()}` : undefined,
      attendees: attendees.map(a => ({
        ...a,
        status: 'pending' as const,
      })),
    };

    onSubmit?.(event);
  };

  const isValid = title.trim().length > 0 && date && startTime;

  return (
    <div className={cn("bg-card rounded-xl border border-border overflow-hidden shadow-lg", className)}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-primary text-primary-foreground">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              {isEditing ? 'Edit Event' : 'Schedule a Meeting'}
            </h2>
            <p className="text-sm text-primary-foreground/80">
              {isEditing ? 'Update event details' : 'Create a new calendar event'}
            </p>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              className="p-2 hover:bg-primary-foreground/20 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Form */}
      <div className="p-6 space-y-6">
        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="title">Event Title *</Label>
          <Input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Team Meeting, Client Call"
          />
        </div>

        {/* Date & Time */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="date">
              <Calendar className="w-4 h-4 inline mr-1" />
              Date *
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
              <Clock className="w-4 h-4 inline mr-1" />
              Start Time *
            </Label>
            <Input
              id="time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              disabled={isAllDay}
            />
          </div>
        </div>

        {/* Duration */}
        <div className="space-y-2">
          <Label>Duration</Label>
          <div className="flex flex-wrap gap-2">
            {durations.map((d) => (
              <Button
                key={d.value}
                variant={duration === d.value ? "default" : "outline"}
                size="sm"
                onClick={() => setDuration(d.value)}
                disabled={isAllDay}
              >
                {d.label}
              </Button>
            ))}
          </div>
        </div>

        {/* All Day Toggle */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="allDay"
            checked={isAllDay}
            onCheckedChange={(checked) => setIsAllDay(checked as boolean)}
          />
          <Label htmlFor="allDay" className="cursor-pointer">
            All-day event
          </Label>
        </div>

        {/* Recurrence */}
        <div className="space-y-2">
          <Label>Recurrence</Label>
          <div className="flex flex-wrap gap-2">
            {(['none', 'daily', 'weekly', 'monthly'] as const).map((r) => (
              <Button
                key={r}
                variant={recurrence === r ? "default" : "outline"}
                size="sm"
                onClick={() => setRecurrence(r)}
              >
                {r === 'none' ? 'No Repeat' : r.charAt(0).toUpperCase() + r.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        <Separator />

        {/* Location */}
        <div className="space-y-2">
          <Label htmlFor="location">
            <MapPin className="w-4 h-4 inline mr-1" />
            Location
          </Label>
          <Input
            id="location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g., Conference Room A, Zoom, Google Meet"
          />
        </div>

        {/* Color */}
        <div className="space-y-2">
          <Label>Event Color</Label>
          <div className="flex gap-2">
            {colors.map((c, _i) => (
              <button
                key={c}
                onClick={() => setColor(c)}
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
            <Users className="w-4 h-4 inline mr-1" />
            Attendees
          </Label>
          
          <div className="flex gap-2">
            <Input
              type="email"
              value={newAttendee}
              onChange={(e) => setNewAttendee(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAttendee())}
              placeholder="Add email address"
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
                  className="flex items-center gap-2 pr-1"
                >
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">
                    {attendee.email[0].toUpperCase()}
                  </div>
                  <span className="text-xs">{attendee.email}</span>
                  <button
                    onClick={() => removeAttendee(attendee.email)}
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
          <Label htmlFor="description">Description / Notes</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Add meeting agenda, notes, or any relevant details..."
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
          Cancel
        </Button>
        {isEditing && (
          <Button
            variant="destructive"
            className="gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </Button>
        )}
        <Button
          onClick={handleSubmit}
          disabled={!isValid}
          className="flex-1 gap-2"
        >
          <Save className="w-4 h-4" />
          {isEditing ? 'Update Event' : 'Create Event'}
        </Button>
      </div>
    </div>
  );
}