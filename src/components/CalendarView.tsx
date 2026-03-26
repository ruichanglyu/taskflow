import { useState, useMemo } from 'react';
import { CalendarDays, Check, ChevronDown, ExternalLink, List, LayoutGrid, Plus, RefreshCcw, Trash2, Unplug } from 'lucide-react';
import { useGoogleCalendar } from '../hooks/useGoogleCalendar';
import { GoogleCalendarEvent } from '../lib/googleCalendar';
import { CreateEventModal } from './CreateEventModal';
import { CalendarGrid } from './CalendarGrid';
import { cn } from '../utils/cn';

type CalendarViewMode = 'month' | 'week' | 'list';

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatWeekRangeLabel(start: Date) {
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `${start.toLocaleDateString('en-US', { month: 'long' })} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function getMinutesFromStart(dateTime?: string) {
  if (!dateTime) return null;
  const date = new Date(dateTime);
  return date.getHours() * 60 + date.getMinutes();
}

function hourToTime(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function minutesToTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getEventStartLabel(date?: { date?: string; dateTime?: string }) {
  if (!date) return 'No start time';

  if (date.date) {
    return new Date(`${date.date}T00:00:00`).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  if (date.dateTime) {
    return new Date(date.dateTime).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  return 'No start time';
}

function getEventTimeLabel(date?: { date?: string; dateTime?: string }) {
  if (date?.date) return 'All day';
  if (date?.dateTime) {
    return new Date(date.dateTime).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return '';
}

function getEventSectionLabel(date?: { date?: string; dateTime?: string }) {
  if (date?.date) {
    return new Date(`${date.date}T00:00:00`).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
    });
  }

  if (date?.dateTime) {
    return new Date(date.dateTime).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
    });
  }

  return 'Later';
}

function getEventDateKey(event: GoogleCalendarEvent): string | null {
  if (event.start?.date) return event.start.date;
  if (event.start?.dateTime) return event.start.dateTime.slice(0, 10);
  return null;
}

function CalendarChecklist({
  calendars,
  visibleCalendarIds,
  selectedCalendarId,
  isLoading,
  open,
  onToggleOpen,
  onToggleVisibility,
  onChooseCalendar,
}: {
  calendars: ReturnType<typeof useGoogleCalendar>['calendars'];
  visibleCalendarIds: string[];
  selectedCalendarId: string;
  isLoading: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onToggleVisibility: (id: string) => void;
  onChooseCalendar: (id: string) => void;
}) {
  return (
    <div className="rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-sm sm:p-5">
      <button
        type="button"
        onClick={onToggleOpen}
        className="mb-3 flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2">
          <CalendarDays size={16} className="text-[var(--text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">My calendars</h2>
        </span>
        <ChevronDown
          size={16}
          className={cn(
            'text-[var(--text-faint)] transition-transform',
            open ? 'rotate-180' : 'rotate-0'
          )}
        />
      </button>
      {open && (
        <div className="space-y-1.5">
          {calendars.map(item => {
            const checked = visibleCalendarIds.includes(item.id);
            const isActive = selectedCalendarId === item.id;
            const color = item.backgroundColor || '#818cf8';

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onToggleVisibility(item.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition',
                  checked ? 'bg-[var(--surface-muted)]' : 'hover:bg-[var(--surface-muted)]'
                )}
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-[6px] border-2"
                  style={{
                    borderColor: color,
                    backgroundColor: checked ? color : 'transparent',
                    color: checked ? '#111827' : 'transparent',
                  }}
                >
                  <Check size={12} strokeWidth={3} />
                </span>
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    checked ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                  )}
                >
                  {item.summary}
                  {item.primary ? ' (Primary)' : ''}
                </span>
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    onChooseCalendar(item.id);
                  }}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium transition',
                    isActive
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'bg-[var(--surface)] text-[var(--text-faint)]'
                  )}
                >
                  {isActive ? 'Active' : 'Use'}
                </button>
              </button>
            );
          })}
        </div>
      )}
      {isLoading && <p className="mt-2 text-xs text-[var(--text-faint)]">Loading...</p>}
    </div>
  );
}

interface CalendarViewProps {
  userId: string;
  deadlines?: import('../types').Deadline[];
}

function DayPanel({
  dateStr,
  events,
  deadlines = [],
  onDelete,
  deletingId,
  onCreateEvent,
}: {
  dateStr: string;
  events: GoogleCalendarEvent[];
  deadlines?: import('../types').Deadline[];
  onDelete: (id: string) => void;
  deletingId: string | null;
  onCreateEvent: () => void;
}) {
  const dayDeadlines = deadlines.filter(d => d.dueDate === dateStr);
  const dateLabel = new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold leading-tight text-[var(--text-primary)]">{dateLabel}</h3>
        <button
          type="button"
          onClick={onCreateEvent}
          className="flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
        >
          <Plus size={14} /> Add event
        </button>
      </div>

      {events.length === 0 && dayDeadlines.length === 0 ? (
        <div className="flex min-h-[120px] items-center justify-center rounded-2xl border border-dashed border-[var(--border-soft)] text-sm text-[var(--text-faint)]">
          No events this day
        </div>
      ) : (
        <div className="space-y-2">
          {dayDeadlines.map(dl => (
            <div
              key={dl.id}
              className="flex items-start gap-3 rounded-2xl bg-orange-400/6 p-3"
            >
              <div className="mt-0.5 flex h-8 w-1 shrink-0 rounded-full bg-orange-400" />
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {dl.title}
                </h4>
                <p className="text-xs text-orange-400/80">
                  {dl.type.charAt(0).toUpperCase() + dl.type.slice(1)} deadline
                  {dl.dueTime ? ` · ${dl.dueTime}` : ''}
                </p>
              </div>
            </div>
          ))}
          {events.map(event => (
            <div
              key={event.id}
              className="group flex items-start gap-3 rounded-2xl bg-[var(--surface-muted)] p-3"
            >
              <div
                className="mt-1 flex h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: event.calendarColor || '#818cf8' }}
              />
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {event.summary || 'Untitled event'}
                </h4>
                <p className="text-xs text-[var(--text-muted)]">
                  {getEventTimeLabel(event.start)}
                </p>
                {event.location && (
                  <p className="mt-1 text-xs text-[var(--text-faint)] truncate">{event.location}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onDelete(event.id)}
                  disabled={deletingId === event.id}
                  className="rounded-full p-1.5 text-[var(--text-faint)] opacity-100 transition hover:text-red-400 disabled:opacity-50 md:opacity-0 md:group-hover:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
                {event.htmlLink && (
                  <a
                    href={event.htmlLink}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full p-1.5 text-[var(--text-faint)] transition hover:text-[var(--text-primary)]"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WeekCalendarGrid({
  weekStart,
  events,
  deadlines = [],
  selectedDate,
  onSelectDate,
  onCreateEventAt,
}: {
  weekStart: Date;
  events: GoogleCalendarEvent[];
  deadlines?: import('../types').Deadline[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onCreateEventAt: (
    date: string,
    startTime: string,
    endTime: string,
    anchorRect: { top: number; left: number; width: number; height: number }
  ) => void;
}) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const hourRows = Array.from({ length: 19 }, (_, index) => 5 + index);
  const rowHeight = 44;
  const todayKey = formatDateKey(new Date());

  const timedEvents = events.filter(event => event.start?.dateTime && event.end?.dateTime);
  const allDayEvents = events.filter(event => event.start?.date && !event.start?.dateTime);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, GoogleCalendarEvent[]>();
    for (const event of timedEvents) {
      const key = getEventDateKey(event);
      if (!key) continue;
      const existing = map.get(key);
      if (existing) existing.push(event);
      else map.set(key, [event]);
    }
    for (const [key, value] of map) {
      value.sort((a, b) => (a.start?.dateTime || '').localeCompare(b.start?.dateTime || ''));
      map.set(key, value);
    }
    return map;
  }, [timedEvents]);

  const allDayByDay = useMemo(() => {
    const map = new Map<string, GoogleCalendarEvent[]>();
    for (const event of allDayEvents) {
      const key = getEventDateKey(event);
      if (!key) continue;
      const existing = map.get(key);
      if (existing) existing.push(event);
      else map.set(key, [event]);
    }
    return map;
  }, [allDayEvents]);

  const deadlinesByDay = useMemo(() => {
    const map = new Map<string, import('../types').Deadline[]>();
    for (const dl of deadlines) {
      const existing = map.get(dl.dueDate);
      if (existing) existing.push(dl);
      else map.set(dl.dueDate, [dl]);
    }
    return map;
  }, [deadlines]);

  return (
    <div className="overflow-hidden rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface)]">
      <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b border-[var(--border-soft)]">
        <div className="border-r border-[var(--border-soft)] bg-[var(--surface)] px-3 py-4 text-[11px] font-medium text-[var(--text-faint)]">
          GMT-04
        </div>
        {days.map(day => {
          const key = formatDateKey(day);
          const isSelected = key === selectedDate;
          const isToday = key === todayKey;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(key)}
              className={cn(
                'border-r border-[var(--border-soft)] px-3 py-3 text-left transition last:border-r-0',
                isSelected ? 'bg-[var(--surface-muted)]' : 'hover:bg-[var(--surface-muted)]'
              )}
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                {day.toLocaleDateString('en-US', { weekday: 'short' })}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold',
                    isToday ? 'bg-[var(--accent)] text-[var(--accent-contrast)]' : 'text-[var(--text-primary)]'
                  )}
                >
                  {day.getDate()}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b border-[var(--border-soft)]">
        <div className="border-r border-[var(--border-soft)] px-3 py-2 text-[11px] font-medium text-[var(--text-faint)]">
          All-day
        </div>
        {days.map(day => {
          const key = formatDateKey(day);
          const dayEvents = allDayByDay.get(key) ?? [];
          const dayDeadlines = deadlinesByDay.get(key) ?? [];

          return (
            <div key={key} className="min-h-[52px] border-r border-[var(--border-soft)] px-2 py-2 last:border-r-0">
              <div className="space-y-1">
                {dayEvents.slice(0, 2).map(event => (
                  <div
                    key={event.id}
                    className="flex items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-[10px] font-medium text-[var(--text-secondary)]"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: event.calendarColor || '#818cf8' }} />
                    <span className="truncate">{event.summary || 'Untitled'}</span>
                  </div>
                ))}
                {dayDeadlines.slice(0, Math.max(0, 2 - dayEvents.length)).map(dl => (
                  <div
                    key={dl.id}
                    className="flex items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-[10px] font-medium text-[var(--text-secondary)]"
                  >
                    <span className="h-2 w-2 shrink-0 rotate-45 bg-orange-400" />
                    <span className="truncate">{dl.title}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="relative">
        <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))]">
          <div className="border-r border-[var(--border-soft)]">
            {hourRows.map(hour => (
              <div key={hour} className="relative border-b border-[var(--border-soft)] px-2 text-[11px] text-[var(--text-faint)]" style={{ height: `${rowHeight}px` }}>
                <span className="absolute -top-2 right-2 bg-[var(--surface)] px-1">
                  {new Date(2026, 0, 1, hour).toLocaleTimeString('en-US', { hour: 'numeric' })}
                </span>
              </div>
            ))}
          </div>

          {days.map(day => {
            const key = formatDateKey(day);
            const dayEvents = eventsByDay.get(key) ?? [];
            const isSelected = key === selectedDate;

            return (
              <div
                key={key}
                className={cn(
                  'relative border-r border-[var(--border-soft)] last:border-r-0',
                  isSelected && 'bg-[var(--accent-soft)]/40'
                )}
              >
                {hourRows.map(hour => (
                  <button
                    key={hour}
                    type="button"
                    onClick={event => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const relativeY = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
                      const quarterIndex = Math.min(3, Math.floor((relativeY / rect.height) * 4));
                      const startMinutes = hour * 60 + quarterIndex * 15;
                      const endMinutes = Math.min(startMinutes + 60, 24 * 60 - 1);

                      onCreateEventAt(
                        key,
                        minutesToTime(startMinutes),
                        minutesToTime(endMinutes),
                        rect
                      );
                    }}
                    className="block w-full border-b border-[var(--border-soft)] transition hover:bg-[var(--surface-muted)]"
                    style={{ height: `${rowHeight}px` }}
                  />
                ))}

                {dayEvents.map(event => {
                  const startMinutes = getMinutesFromStart(event.start?.dateTime);
                  const endMinutes = getMinutesFromStart(event.end?.dateTime);
                  if (startMinutes === null || endMinutes === null) return null;

                  const top = ((startMinutes - 300) / 60) * rowHeight;
                  const height = Math.max(((endMinutes - startMinutes) / 60) * rowHeight, 24);

                  if (top < 0 || top > hourRows.length * rowHeight) return null;

                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onSelectDate(key)}
                      className="absolute left-1.5 right-1.5 overflow-hidden rounded-lg px-2 py-1 text-left shadow-sm"
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        backgroundColor: `${event.calendarColor || '#818cf8'}22`,
                        borderLeft: `3px solid ${event.calendarColor || '#818cf8'}`,
                      }}
                    >
                      <div className="truncate text-[10px] font-semibold text-[var(--text-primary)]">
                        {event.summary || 'Untitled event'}
                      </div>
                      <div className="truncate text-[10px] text-[var(--text-muted)]">
                        {getEventTimeLabel(event.start)}
                        {event.end?.dateTime ? ` - ${getEventTimeLabel(event.end)}` : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CalendarView({ userId, deadlines = [] }: CalendarViewProps) {
  const calendar = useGoogleCalendar(userId);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createDate, setCreateDate] = useState<string | undefined>(undefined);
  const [createStartTime, setCreateStartTime] = useState<string | undefined>(undefined);
  const [createEndTime, setCreateEndTime] = useState<string | undefined>(undefined);
  const [createAnchorRect, setCreateAnchorRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showCalendarList, setShowCalendarList] = useState(true);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const todayStr = formatDateKey(now);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const weekStart = useMemo(() => startOfWeek(new Date(`${selectedDate}T00:00:00`)), [selectedDate]);

  const handlePrevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };

  const handleNextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const handleToday = () => {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth());
    setSelectedDate(todayStr);
  };

  const handleCreateFromDate = (date: string) => {
    setCreateDate(date);
    setCreateStartTime(undefined);
    setCreateEndTime(undefined);
    setCreateAnchorRect(null);
    setShowCreateModal(true);
  };

  const handleCreateFromWeekSlot = (
    date: string,
    startTime: string,
    endTime: string,
    anchorRect: { top: number; left: number; width: number; height: number }
  ) => {
    setCreateDate(date);
    setCreateStartTime(startTime);
    setCreateEndTime(endTime);
    setCreateAnchorRect(anchorRect);
    setShowCreateModal(true);
  };

  const handleDelete = async (eventId: string) => {
    setDeletingId(eventId);
    await calendar.deleteEvent(eventId);
    setDeletingId(null);
  };

  const selectedDayEvents = useMemo(() => {
    if (!selectedDate) return [];
    return calendar.events.filter(e => getEventDateKey(e) === selectedDate);
  }, [calendar.events, selectedDate]);

  const groupedEvents = useMemo(() => {
    return calendar.events.reduce<Record<string, GoogleCalendarEvent[]>>((groups, event) => {
      const key = getEventSectionLabel(event.start);
      groups[key] = groups[key] ?? [];
      groups[key].push(event);
      return groups;
    }, {});
  }, [calendar.events]);

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 shadow-sm sm:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Calendar</h1>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {calendar.isConnected && (
            <div className="flex overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)]">
              <button
                type="button"
                onClick={() => setViewMode('month')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors',
                  viewMode === 'month'
                    ? 'bg-[var(--surface)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                )}
              >
                <LayoutGrid size={14} /> Month
              </button>
              <button
                type="button"
                onClick={() => setViewMode('week')}
                className={cn(
                  'flex items-center gap-1.5 border-l border-[var(--border-soft)] px-3 py-2.5 text-xs font-medium transition-colors',
                  viewMode === 'week'
                    ? 'bg-[var(--surface)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                )}
              >
                <CalendarDays size={14} /> Week
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={cn(
                  'flex items-center gap-1.5 border-l border-[var(--border-soft)] px-3 py-2.5 text-xs font-medium transition-colors',
                  viewMode === 'list'
                    ? 'bg-[var(--surface)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                )}
              >
                <List size={14} /> List
              </button>
            </div>
          )}

          {calendar.isConnected ? (
            <>
              <button
                type="button"
                onClick={() => { setCreateDate(undefined); setShowCreateModal(true); }}
                className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)]"
                style={{ backgroundColor: 'var(--accent-strong)' }}
              >
                <Plus size={16} />
                New Event
              </button>
              <button
                type="button"
                onClick={() => void calendar.refresh()}
                className="flex items-center gap-2 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
              >
                <RefreshCcw size={15} />
                Refresh
              </button>
              <button
                type="button"
                onClick={calendar.disconnect}
                className="flex items-center gap-2 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
              >
                <Unplug size={15} />
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void calendar.connect()}
              disabled={!calendar.isConfigured || calendar.isConnecting}
              className="rounded-2xl px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent-strong)', boxShadow: '0 16px 34px var(--glow-accent)' }}
            >
              {calendar.isConnecting ? 'Connecting...' : 'Connect Google Calendar'}
            </button>
          )}
        </div>
        </div>
      </div>

      {!calendar.isConfigured && (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
          Add `VITE_GOOGLE_CLIENT_ID` to your local env and Vercel project settings before Google Calendar can connect.
        </div>
      )}

      {calendar.error && (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
          {calendar.error}
        </div>
      )}

      {!calendar.isConnected ? (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <section className="rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <CalendarDays size={18} className="text-[var(--accent)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Connected Calendar</h2>
            </div>
            <div className="mt-6 rounded-xl border border-dashed border-[var(--border-soft)] p-4 text-sm text-[var(--text-muted)]">
              Connect your Google account to view and create events here.
            </div>
          </section>
          <section className="rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-[var(--border-soft)] text-sm text-[var(--text-muted)]">
              Connect Google Calendar to populate this view.
            </div>
          </section>
        </div>
      ) : viewMode === 'month' ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <CalendarGrid
            year={year}
            month={month}
            events={calendar.events}
            deadlines={deadlines}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
            onToday={handleToday}
            onCreateEvent={handleCreateFromDate}
          />

          <div className="space-y-4">
            <CalendarChecklist
              calendars={calendar.calendars}
              visibleCalendarIds={calendar.visibleCalendarIds}
              selectedCalendarId={calendar.selectedCalendarId}
              isLoading={calendar.isLoading}
              open={showCalendarList}
              onToggleOpen={() => setShowCalendarList(open => !open)}
              onToggleVisibility={id => void calendar.toggleCalendarVisibility(id)}
              onChooseCalendar={id => void calendar.chooseCalendar(id)}
            />

            <DayPanel
              dateStr={selectedDate}
              events={selectedDayEvents}
              deadlines={deadlines}
              onDelete={id => void handleDelete(id)}
              deletingId={deletingId}
              onCreateEvent={() => handleCreateFromDate(selectedDate)}
            />
          </div>
        </div>
      ) : viewMode === 'week' ? (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="text-lg font-semibold text-[var(--text-primary)]">
              {formatWeekRangeLabel(weekStart)}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedDate(formatDateKey(addDays(weekStart, -7)))}
                className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-2 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(todayStr)}
                className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
              >
                This week
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(formatDateKey(addDays(weekStart, 7)))}
                className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-2 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
              >
                →
              </button>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <WeekCalendarGrid
              weekStart={weekStart}
              events={calendar.events}
              deadlines={deadlines}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onCreateEventAt={handleCreateFromWeekSlot}
            />

            <div className="space-y-4">
              <CalendarChecklist
                calendars={calendar.calendars}
                visibleCalendarIds={calendar.visibleCalendarIds}
                selectedCalendarId={calendar.selectedCalendarId}
                isLoading={calendar.isLoading}
                open={showCalendarList}
                onToggleOpen={() => setShowCalendarList(open => !open)}
                onToggleVisibility={id => void calendar.toggleCalendarVisibility(id)}
                onChooseCalendar={id => void calendar.chooseCalendar(id)}
              />

              <DayPanel
                dateStr={selectedDate}
                events={selectedDayEvents}
                deadlines={deadlines}
                onDelete={id => void handleDelete(id)}
                deletingId={deletingId}
                onCreateEvent={() => handleCreateFromDate(selectedDate)}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <CalendarChecklist
            calendars={calendar.calendars}
            visibleCalendarIds={calendar.visibleCalendarIds}
            selectedCalendarId={calendar.selectedCalendarId}
            isLoading={calendar.isLoading}
            open={showCalendarList}
            onToggleOpen={() => setShowCalendarList(open => !open)}
            onToggleVisibility={id => void calendar.toggleCalendarVisibility(id)}
            onChooseCalendar={id => void calendar.chooseCalendar(id)}
          />

          <section className="rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="mb-6 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Upcoming Events</h2>
                <p className="mt-1 text-sm text-[var(--text-muted)]">Showing your next 50 events.</p>
              </div>
            </div>

            {calendar.events.length === 0 && !calendar.isLoading ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border-soft)] text-sm text-[var(--text-muted)]">
                <p>No upcoming events found.</p>
                <button
                  type="button"
                  onClick={() => { setCreateDate(undefined); setShowCreateModal(true); }}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)]"
                >
                  <Plus size={14} /> Create your first event
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedEvents).map(([section, events]) => (
                  <div key={section}>
                    <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">{section}</h3>
                    <div className="mt-3 space-y-3">
                      {events.map(event => (
                        <article
                          key={event.id}
                          className="group rounded-2xl bg-[var(--surface-muted)] p-4"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <h4 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                                {event.summary || 'Untitled event'}
                              </h4>
                              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                                {getEventStartLabel(event.start)}
                              </p>
                              {event.location && (
                                <p className="mt-2 text-xs text-[var(--text-faint)]">{event.location}</p>
                              )}
                              {event.description && (
                                <p className="mt-2 line-clamp-3 text-xs text-[var(--text-faint)]">
                                  {event.description}
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleDelete(event.id)}
                                disabled={deletingId === event.id}
                className="rounded-full border border-[var(--border-soft)] p-2 text-[var(--text-faint)] opacity-100 transition hover:border-red-500/30 hover:text-red-400 disabled:opacity-50 md:opacity-0 md:group-hover:opacity-100"
                              >
                                <Trash2 size={14} />
                              </button>
                              {event.htmlLink && (
                                <a
                                  href={event.htmlLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full border border-[var(--border-soft)] p-2 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                                >
                                  <ExternalLink size={14} />
                                </a>
                              )}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {showCreateModal && (
        <CreateEventModal
          initialDate={createDate}
          initialStartTime={createStartTime}
          initialEndTime={createEndTime}
          calendars={calendar.calendars}
          initialCalendarId={calendar.selectedCalendarId}
          compact={viewMode === 'week'}
          anchorRect={createAnchorRect}
          onSave={calendar.createEvent}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
