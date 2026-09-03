
import * as React from "react"
import { useTranslation } from "react-i18next"
import {
  add,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getDay,
  isEqual,
  isSameDay,
  isSameMonth,
  isToday,
  parse,
  startOfToday,
  startOfWeek,
} from "date-fns"
import { enUS, ar as arLocale } from "date-fns/locale"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusCircleIcon,
  SearchIcon,
  ClockIcon,
  MapPinIcon,
  UsersIcon,
  PencilIcon,
  TrashIcon,
  CalendarDaysIcon,
  ListIcon,
} from "lucide-react"

import { cn } from "@/lib/cn"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { useMediaQuery } from "@/hooks/useMediaQuery"
import i18n from "@/i18n/i18next"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import SchedulingPanel from "@/features/calendar/components/SchedulingPanel"
import type { CalendarEvent } from "@/features/calendar/types"

interface Event {
  id: string
  /** Base DB id — recurring occurrences carry "<baseId>:<startISO>" ids. */
  baseId?: string
  title: string
  description?: string
  location?: string
  time: string
  datetime: string
  /** ISO end timestamp — needed so editing restores the real duration. */
  end_datetime?: string
  is_all_day?: boolean
  color?: string
  attendees?: { email: string; name?: string; status: string }[]
}

interface CalendarData {
  day: Date
  events: Event[]
}

export interface VisibleRange {
  start: Date
  end: Date
}

interface FullScreenCalendarProps {
  data: CalendarData[]
  /** Receives the full form payload so events created in the grid modal persist. */
  onCreateEvent?: (event?: Partial<CalendarEvent>) => void
  onEditEvent?: (event: Event) => void
  onDeleteEvent?: (eventId: string) => void
  /** Fires on mount and whenever the visible month changes, so the parent can refetch. */
  onVisibleRangeChange?: (range: VisibleRange) => void
  /** Fires when the user selects a day cell, so "New Event" can prefill it. */
  onSelectedDayChange?: (day: Date) => void
}

const colStartClasses = [
  "",
  "col-start-2",
  "col-start-3",
  "col-start-4",
  "col-start-5",
  "col-start-6",
  "col-start-7",
]

/** date-fns locale matching the active UI language. */
function getDateFnsLocale() {
  return i18n.language?.toLowerCase().startsWith("ar") ? arLocale : enUS
}

export function FullScreenCalendar({
  data,
  onCreateEvent,
  onEditEvent,
  onDeleteEvent,
  onVisibleRangeChange,
  onSelectedDayChange,
}: FullScreenCalendarProps) {
  const { t } = useTranslation("calendar")
  const today = startOfToday()
  const [selectedDay, setSelectedDay] = React.useState(today)
  const [currentMonth, setCurrentMonth] = React.useState(
    format(today, "MMM-yyyy"),
  )
  const [viewMode, setViewMode] = React.useState<'month' | 'agenda'>('month')
  const [selectedEvent, setSelectedEvent] = React.useState<Event | null>(null)
  const [showEventModal, setShowEventModal] = React.useState(false)
  const [showCreateModal, setShowCreateModal] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [createPrefillDate, setCreatePrefillDate] = React.useState<Date | undefined>(undefined)
  const firstDayCurrentMonth = React.useMemo(
    () => parse(currentMonth, "MMM-yyyy", new Date()),
    [currentMonth],
  )
  const isDesktop = useMediaQuery("(min-width: 768px)")
  const dateLocale = React.useMemo(getDateFnsLocale, [i18n.language])

  const days = React.useMemo(() => eachDayOfInterval({
    start: startOfWeek(firstDayCurrentMonth),
    end: endOfWeek(endOfMonth(firstDayCurrentMonth)),
  }), [firstDayCurrentMonth])

  // Report the visible range (including leading/trailing week overflow days)
  // so the parent refetches events when the user navigates months.
  React.useEffect(() => {
    onVisibleRangeChange?.({
      start: startOfWeek(firstDayCurrentMonth),
      end: endOfWeek(endOfMonth(firstDayCurrentMonth)),
    })
  }, [firstDayCurrentMonth, onVisibleRangeChange])

  const weekdayHeaders = React.useMemo(
    () => eachDayOfInterval({ start: startOfWeek(firstDayCurrentMonth), end: add(startOfWeek(firstDayCurrentMonth), { days: 6 }) })
      .map((d) => format(d, "EEE", { locale: dateLocale })),
    [firstDayCurrentMonth, dateLocale],
  )

  function previousMonth() {
    const firstDayPrevMonth = add(firstDayCurrentMonth, { months: -1 })
    setCurrentMonth(format(firstDayPrevMonth, "MMM-yyyy"))
  }

  function nextMonth() {
    const firstDayNextMonth = add(firstDayCurrentMonth, { months: 1 })
    setCurrentMonth(format(firstDayNextMonth, "MMM-yyyy"))
  }

  function goToToday() {
    setCurrentMonth(format(today, "MMM-yyyy"))
    setSelectedDay(today)
  }

  const handleDaySelect = (day: Date) => {
    setSelectedDay(day)
    onSelectedDayChange?.(day)
  }

  const handleEventClick = (event: Event) => {
    setSelectedEvent(event)
    setShowEventModal(true)
  }

  const openCreateAt = (day?: Date) => {
    setCreatePrefillDate(day)
    setShowCreateModal(true)
  }

  const allEvents = React.useMemo(
    () => data.flatMap((d) => d.events),
    [data],
  )

  const searchResults = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return allEvents.filter((e) => e.title.toLowerCase().includes(q)).slice(0, 8)
  }, [searchQuery, allEvents])

  const upcomingByDay = React.useMemo(() => {
    const groups = data
      .filter((d) => d.day.getTime() >= new Date().setHours(0, 0, 0, 0) && d.events.length > 0)
      .sort((a, b) => a.day.getTime() - b.day.getTime())
      .slice(0, 30)
    return groups
  }, [data])

  const renderEventChips = (day: Date) =>
    data
      .filter((date) => isSameDay(date.day, day))
      .map((date) => (
        <div key={date.day.toString()} className="space-y-1.5">
          {date.events.slice(0, 2).map((event) => (
            <div
              key={event.id}
              onClick={(e) => {
                e.stopPropagation()
                handleEventClick(event)
              }}
              className="flex flex-col items-start gap-1 rounded-lg border bg-muted/50 p-2 text-xs leading-tight hover:bg-muted cursor-pointer transition-colors"
              style={event.color ? { borderInlineStartColor: event.color, borderInlineStartWidth: 3 } : undefined}
            >
              <p className="font-medium leading-none truncate w-full">
                {event.title}
              </p>
              <p className="leading-none text-muted-foreground flex items-center gap-1">
                <ClockIcon className="w-3 h-3" />
                {event.time}
              </p>
              {event.location && (
                <p className="leading-none text-muted-foreground flex items-center gap-1">
                  <MapPinIcon className="w-3 h-3" />
                  {event.location}
                </p>
              )}
            </div>
          ))}
          {date.events.length > 2 && (
            <div className="text-xs text-muted-foreground">
              {t("moreEvents", { count: date.events.length - 2 })}
            </div>
          )}
        </div>
      ))

  return (
    <div className="flex flex-1 flex-col">
      {/* Calendar Header */}
      <div className="flex flex-col space-y-4 p-4 md:flex-row md:items-center md:justify-between md:space-y-0 lg:flex-none">
        <div className="flex flex-auto">
          <div className="flex items-center gap-4">
            <div className="hidden w-20 flex-col items-center justify-center rounded-lg border bg-muted p-0.5 md:flex">
              <h1 className="p-1 text-xs uppercase text-muted-foreground">
                {format(today, "MMM", { locale: dateLocale })}
              </h1>
              <div className="flex w-full items-center justify-center rounded-lg border bg-background p-0.5 text-lg font-bold">
                <span>{format(today, "d")}</span>
              </div>
            </div>
            <div className="flex flex-col">
              <h2 className="text-lg font-semibold text-foreground">
                {format(firstDayCurrentMonth, "MMMM yyyy", { locale: dateLocale })}
              </h2>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4 md:flex-row md:gap-6">
          {/* View Mode Toggle */}
          <div className="inline-flex rounded-lg border bg-muted p-1">
            {([
              ['month', <CalendarDaysIcon key="m" size={14} strokeWidth={2} />],
              ['agenda', <ListIcon key="a" size={14} strokeWidth={2} />],
            ] as const).map(([mode, icon]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  viewMode === mode
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {icon}
                {mode === 'month' ? t('viewMonth') : t('viewAgenda')}
              </button>
            ))}
          </div>

          <Separator orientation="vertical" className="hidden h-6 lg:block" />

          <div className="inline-flex w-full -space-x-px rounded-lg shadow-sm shadow-black/5 md:w-auto rtl:space-x-reverse">
            <Button
              onClick={previousMonth}
              className="rounded-none shadow-none first:rounded-s-lg last:rounded-e-lg focus-visible:z-10"
              variant="outline"
              size="icon"
              aria-label={t('prevMonth')}
            >
              <ChevronLeftIcon size={16} strokeWidth={2} aria-hidden="true" />
            </Button>
            <Button
              onClick={goToToday}
              className="w-full rounded-none shadow-none first:rounded-s-lg last:rounded-e-lg focus-visible:z-10 md:w-auto"
              variant="outline"
            >
              {t('today')}
            </Button>
            <Button
              onClick={nextMonth}
              className="rounded-none shadow-none first:rounded-s-lg last:rounded-e-lg focus-visible:z-10"
              variant="outline"
              size="icon"
              aria-label={t('nextMonth')}
            >
              <ChevronRightIcon size={16} strokeWidth={2} aria-hidden="true" />
            </Button>
          </div>

          <Separator orientation="vertical" className="hidden h-6 md:block" />
          <Separator
            orientation="horizontal"
            className="block w-full md:hidden"
          />

          {/* Search */}
          <div className="relative w-full md:w-auto">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchEvents')}
              className="w-full md:w-56 h-9"
            />
            <SearchIcon size={15} strokeWidth={2} aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-[15px] w-[15px] text-muted-foreground" />
            {searchOpen && searchQuery.trim() && (
              <div className="absolute z-40 mt-1 w-full md:w-80 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md max-h-72 overflow-y-auto">
                {searchResults.length === 0 ? (
                  <p className="px-3 py-2.5 text-sm text-muted-foreground">{t('noResults')}</p>
                ) : (
                  searchResults.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSearchOpen(false)
                        setSearchQuery('')
                        handleEventClick(event)
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground text-start"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: event.color || 'var(--primary)' }}
                      />
                      <span className="truncate font-medium">{event.title}</span>
                      <span className="ms-auto shrink-0 text-xs text-muted-foreground">{event.time}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <Button className="w-full gap-2 md:w-auto" onClick={() => openCreateAt(selectedDay)}>
            <PlusCircleIcon size={16} strokeWidth={2} aria-hidden="true" />
            <span>{t('newEvent')}</span>
          </Button>
        </div>
      </div>

      {viewMode === 'month' ? (
      <div className="lg:flex lg:flex-auto lg:flex-col">
        {/* Week Days Header */}
        <div className="grid grid-cols-7 border text-center text-xs font-semibold leading-6 lg:flex-none">
          {weekdayHeaders.map((label) => (
            <div key={label + String(weekdayHeaders.indexOf(label))} className="border-e py-2.5 last:border-e-0">
              {label}
            </div>
          ))}
        </div>

        {/* Calendar Days */}
        <div className="flex text-xs leading-6 lg:flex-auto">
          <div className="hidden w-full border-x lg:grid lg:grid-cols-7 lg:auto-rows-fr lg:h-full">
            {days.map((day, dayIdx) => !isDesktop ? null : (
                <div
                  key={dayIdx}
                  onClick={() => handleDaySelect(day)}
                  onDoubleClick={() => openCreateAt(day)}
                  className={cn(
                    dayIdx === 0 && colStartClasses[getDay(day)],
                    !isSameMonth(day, firstDayCurrentMonth) && "bg-accent/50 text-muted-foreground",
                    "group relative flex min-h-24 flex-col border-b border-e hover:bg-muted focus:z-10",
                  )}
                >
                  <header className="flex items-center justify-between p-2.5">
                    <time
                      dateTime={format(day, "yyyy-MM-dd")}
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full text-xs",
                        isToday(day) && "bg-primary font-semibold text-primary-foreground",
                        !isToday(day) && isEqual(day, selectedDay) && "bg-foreground font-semibold text-background",
                        !isToday(day) && "hover:border",
                        !isEqual(day, selectedDay) &&
                          !isToday(day) &&
                          !isSameMonth(day, firstDayCurrentMonth) &&
                          "text-muted-foreground",
                      )}
                    >
                      {format(day, "d")}
                    </time>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDaySelect(day)
                        openCreateAt(day)
                      }}
                      aria-label={t('newEvent')}
                      className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <PlusCircleIcon className="h-4 w-4" />
                    </button>
                  </header>
                  <div className="flex-1 px-2.5 pb-2.5">
                    {renderEventChips(day)}
                  </div>
                </div>
            ))}
          </div>

          <div className="isolate grid w-full grid-cols-7 auto-rows-fr border-x lg:hidden">
            {days.map((day, dayIdx) => (
              <button
                onClick={() => handleDaySelect(day)}
                key={dayIdx}
                type="button"
                className={cn(
                  dayIdx === 0 && colStartClasses[getDay(day)],
                  !isSameMonth(day, firstDayCurrentMonth) && "bg-accent/50 text-muted-foreground",
                  isEqual(day, selectedDay) && "bg-muted",
                  "flex h-16 flex-col items-center border-b border-e px-1 py-1.5 hover:bg-muted focus:z-10",
                )}
              >
                <time
                  dateTime={format(day, "yyyy-MM-dd")}
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full",
                    isToday(day) && "bg-primary font-semibold text-primary-foreground",
                    isEqual(day, selectedDay) && !isToday(day) && "bg-foreground font-semibold text-background",
                  )}
                >
                  {format(day, "d")}
                </time>
                {(() => {
                  const dayData = data.find((date) => isSameDay(date.day, day))
                  if (!dayData || dayData.events.length === 0) return null
                  const first = dayData.events[0]
                  return (
                    <span className="mt-0.5 w-full truncate text-[10px] leading-tight text-muted-foreground" style={first.color ? { color: first.color } : undefined}>
                      {dayData.events.length > 1 ? `${first.title} +${dayData.events.length - 1}` : first.title}
                    </span>
                  )
                })()}
              </button>
            ))}
          </div>
        </div>

        {/* Selected-day summary (mobile) */}
        {!isDesktop && (
          <div className="border-t p-3">
            {(() => {
              const dayData = data.find((date) => isSameDay(date.day, selectedDay))
              if (!dayData || dayData.events.length === 0) return null
              return (
                <div className="space-y-2">
                  {dayData.events.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => handleEventClick(event)}
                      className="flex w-full items-center gap-2.5 rounded-lg border bg-card p-3 text-start text-sm hover:bg-muted transition-colors"
                    >
                      <span
                        className="h-8 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: event.color || 'var(--primary)' }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{event.title}</span>
                        <span className="block text-xs text-muted-foreground">{event.time}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>
        )}
      </div>
      ) : (
      /* ── Agenda view ─────────────────────────────────────────────────── */
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {upcomingByDay.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <CalendarDaysIcon className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('agendaEmpty')}</p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            {upcomingByDay.map(({ day, events }) => (
              <section key={day.toISOString()}>
                <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
                  {format(day, "EEEE, MMM d", { locale: dateLocale })}
                  {isToday(day) && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {t('today')}
                    </span>
                  )}
                </h3>
                <div className="space-y-2">
                  {events.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => handleEventClick(event)}
                      className="flex w-full items-center gap-3 rounded-xl border bg-card p-3.5 text-start hover:bg-muted transition-colors"
                    >
                      <span
                        className="h-10 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: event.color || 'var(--primary)' }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-sm">{event.title}</span>
                        {event.location && (
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {event.location}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{event.time}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Event Detail Modal */}
      <Dialog open={showEventModal} onOpenChange={setShowEventModal}>
        <DialogContent className="sm:max-w-[525px]" dir="auto">
          {selectedEvent && (
            <>
              <DialogHeader>
                <DialogTitle className="text-2xl font-bold flex items-center gap-2.5">
                  <span
                    className="inline-block h-5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: selectedEvent.color || 'var(--primary)' }}
                  />
                  <span className="min-w-0 break-words">{selectedEvent.title}</span>
                </DialogTitle>
                <DialogDescription>
                  {selectedEvent.datetime}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                {selectedEvent.description && (
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">{t('descriptionLabel')}</h4>
                    <p className="text-sm whitespace-pre-wrap">{selectedEvent.description}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <ClockIcon className="w-4 h-4 text-muted-foreground" />
                    <span>{selectedEvent.time}</span>
                  </div>
                  {selectedEvent.location && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPinIcon className="w-4 h-4 text-muted-foreground" />
                      <span>{selectedEvent.location}</span>
                    </div>
                  )}
                  {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                    <div className="flex items-center gap-2 text-sm">
                      <UsersIcon className="w-4 h-4 text-muted-foreground" />
                      <span>{t('attendees', { count: selectedEvent.attendees.length })}</span>
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setShowEventModal(false)}>
                  {t('close')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowEventModal(false)
                    onEditEvent?.(selectedEvent)
                  }}
                >
                  <PencilIcon className="w-4 h-4 me-2" />
                  {t('edit')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    onDeleteEvent?.(selectedEvent.baseId ?? selectedEvent.id)
                    setShowEventModal(false)
                  }}
                >
                  <TrashIcon className="w-4 h-4 me-2" />
                  {t('delete')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Event Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('scheduleMeeting')}</DialogTitle>
            <DialogDescription>
              {t('scheduleCreateSubtitle')}
            </DialogDescription>
          </DialogHeader>
          <SchedulingPanel
            onSubmit={(event) => {
              onCreateEvent?.(event)
              setShowCreateModal(false)
            }}
            onCancel={() => setShowCreateModal(false)}
            initialData={
              createPrefillDate
                ? { start_time: createPrefillDate.toISOString(), end_time: new Date(createPrefillDate.getTime() + 60 * 60 * 1000).toISOString() }
                : undefined
            }
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

export type { Event as CalendarGridEvent, CalendarData, FullScreenCalendarProps }
export default FullScreenCalendar
