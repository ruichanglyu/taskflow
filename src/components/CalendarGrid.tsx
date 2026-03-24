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
    <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{monthLabel}</h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToday}
            className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onPrevMonth}
            className="rounded-lg border border-[var(--border-soft)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={onNextMonth}
            className="rounded-lg border border-[var(--border-soft)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map(day => (
          <div key={day} className="py-2 text-center text-xs font-medium text-[var(--text-faint)]">
            {day}
          </div>
        ))}
      </div>

      {/* Day cells */}
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
                'group relative flex flex-col items-center gap-1 border border-transparent p-1.5 transition-colors min-h-[72px]',
                isCurrentMonth ? 'text-[var(--text-primary)]' : 'text-[var(--text-faint)]',
                isSelected && 'border-[var(--accent)] bg-[var(--accent-soft)] rounded-lg',
                !isSelected && isCurrentMonth && 'hover:bg-[var(--surface-muted)] hover:rounded-lg',
              )}
            >
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium',
                  isToday && !isSelected && 'bg-[var(--accent)] text-[var(--accent-contrast)]',
                  isToday && isSelected && 'bg-[var(--accent)] text-[var(--accent-contrast)]',
                )}
              >
                {day}
              </span>

              {/* Deadline + event markers */}
              {(dayDeadlines.length > 0 || dayEvents.length > 0) && (
                <div className="flex items-center gap-0.5">
                  {dayDeadlines.slice(0, 2).map((dl, i) => (
                    <div
                      key={`dl-${i}`}
                      className="h-1.5 w-1.5 rotate-45 bg-orange-400"
                      title={dl.title}
                    />
                  ))}
                  {dayEvents.slice(0, 3 - Math.min(dayDeadlines.length, 2)).map((_, i) => (
                    <div
                      key={`ev-${i}`}
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        isSelected ? 'bg-[var(--accent)]' : 'bg-indigo-400'
                      )}
                    />
                  ))}
                  {dayEvents.length + dayDeadlines.length > 3 && (
                    <span className="text-[8px] text-[var(--text-faint)]">+{dayEvents.length + dayDeadlines.length - 3}</span>
                  )}
                </div>
              )}

              {/* Quick add on hover */}
              {isCurrentMonth && (
                <div
                  className="absolute right-0.5 top-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
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
