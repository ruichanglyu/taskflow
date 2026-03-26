import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { GoogleCalendarEvent } from '../lib/googleCalendar';
import { Deadline } from '../types';
import { cn } from '../utils/cn';

interface CalendarGridProps {
  year: number;
  month: number;
  events: GoogleCalendarEvent[];
  deadlines?: Deadline[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  onCreateEvent: (date: string) => void;
}

function getEventDateKey(event: GoogleCalendarEvent): string | null {
  if (event.start?.date) return event.start.date;
  if (event.start?.dateTime) return event.start.dateTime.slice(0, 10);
  return null;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarGrid({
  year,
  month,
  events,
  deadlines = [],
  selectedDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  onToday,
  onCreateEvent,
}: CalendarGridProps) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const monthLabel = new Date(year, month).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const eventsByDate = useMemo(() => {
    const map = new Map<string, GoogleCalendarEvent[]>();
    for (const event of events) {
      const key = getEventDateKey(event);
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        existing.push(event);
      } else {
        map.set(key, [event]);
      }
    }
    return map;
  }, [events]);

  const deadlinesByDate = useMemo(() => {
    const map = new Map<string, Deadline[]>();
    for (const dl of deadlines) {
      const existing = map.get(dl.dueDate);
      if (existing) existing.push(dl);
      else map.set(dl.dueDate, [dl]);
    }
    return map;
  }, [deadlines]);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  const prevMonthDays = getDaysInMonth(year, month === 0 ? 11 : month - 1);

  const cells: { day: number; dateStr: string; isCurrentMonth: boolean }[] = [];

  // Previous month trailing days
  for (let i = firstDay - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const m = month === 0 ? 12 : month;
    const y = month === 0 ? year - 1 : year;
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ day, dateStr, isCurrentMonth: false });
  }

  // Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ day, dateStr, isCurrentMonth: true });
  }

  // Next month leading days
  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    for (let day = 1; day <= remaining; day++) {
      const m = month === 11 ? 1 : month + 2;
      const y = month === 11 ? year + 1 : year;
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      cells.push({ day, dateStr, isCurrentMonth: false });
    }
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">{monthLabel}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToday}
            className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onPrevMonth}
            className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={onNextMonth}
            className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-[var(--border-soft)] px-2">
        {WEEKDAYS.map(day => (
          <div key={day} className="py-3 text-center text-[11px] font-medium text-[var(--text-faint)]">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map(({ day, dateStr, isCurrentMonth }) => {
          const dayEvents = eventsByDate.get(dateStr) ?? [];
          const dayDeadlines = deadlinesByDate.get(dateStr) ?? [];
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => onSelectDate(dateStr)}
              className={cn(
                'group relative flex min-h-[108px] flex-col items-start border-r border-b border-[var(--border-soft)] px-3 py-2 text-left transition-colors last:border-r-0',
                isCurrentMonth ? 'text-[var(--text-primary)]' : 'text-[var(--text-faint)]',
                isSelected && 'bg-[var(--accent-soft)] ring-1 ring-inset ring-[var(--accent)]',
                !isSelected && isCurrentMonth && 'hover:bg-[var(--surface-muted)]',
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium',
                  isToday && !isSelected && 'bg-[var(--accent)] text-[var(--accent-contrast)]',
                  isToday && isSelected && 'bg-[var(--accent)] text-[var(--accent-contrast)]',
                )}
              >
                {day}
              </span>

              {isCurrentMonth && (
                <div className="mt-1 flex w-full flex-col gap-1">
                  {dayEvents.slice(0, 2).map((event, idx) => (
                    <div
                      key={`${event.id}-${idx}`}
                      className="flex items-center gap-1.5 truncate rounded-md bg-transparent px-0.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: event.calendarColor || '#818cf8' }}
                      />
                      <span className="truncate">{event.summary || 'Untitled'}</span>
                    </div>
                  ))}
                  {dayDeadlines.slice(0, Math.max(0, 2 - dayEvents.slice(0, 2).length)).map((dl, idx) => (
                    <div
                      key={`${dl.id}-${idx}`}
                      className="flex items-center gap-1.5 truncate rounded-md bg-transparent px-0.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]"
                    >
                      <span className="h-2 w-2 shrink-0 rotate-45 bg-orange-400" />
                      <span className="truncate">{dl.title}</span>
                    </div>
                  ))}
                  {dayEvents.length + dayDeadlines.length > 2 && (
                    <span className="pl-1 text-[10px] text-[var(--text-faint)]">
                      +{dayEvents.length + dayDeadlines.length - 2} more
                    </span>
                  )}
                </div>
              )}

              {isCurrentMonth && (
                <div
                  className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={e => { e.stopPropagation(); onCreateEvent(dateStr); }}
                >
                  <Plus size={12} className="text-[var(--text-faint)] hover:text-[var(--accent)]" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
