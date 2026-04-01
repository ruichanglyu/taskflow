import { useEffect, useState, useMemo, useRef } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, List, LayoutGrid, Pencil, Plus, RefreshCcw, Trash2, Unplug, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { GoogleCalendarEvent } from '../lib/googleCalendar';
import { buildAcademicPlanMetadataDescription, parseAcademicPlanMetadata } from '../lib/academicPlanning';
import { CreateEventModal } from './CreateEventModal';
import { CalendarGrid } from './CalendarGrid';
import { cn } from '../utils/cn';
import { isStudyBlockLikeCalendarEvent } from '../utils/studyBlockDetection';
import { getEventDateKey, hasEventEnded, getEventTimeLabel } from '../utils/calendarEventHelpers';
import { STUDY_OUTCOME_OPTIONS, getOutcomeTone, getOutcomeLabel, OutcomeBadge } from '../utils/studyOutcomes';
import { addDays, addMonths, formatDateKey } from '../utils/dateHelpers';
import type { GoogleCalendarController } from '../hooks/useGoogleCalendar';
import type { StudyBlockOutcome } from '../hooks/useStudyBlockOutcomes';
import type { StudyBlockOutcomeStatus } from '../types';
import { getCalendarEventPresentation } from '../utils/calendarEventPresentation';

type CalendarViewMode = 'month' | 'week' | 'list';
type StudyBlockOutcomeMap = Record<string, StudyBlockOutcome>;


function parseCalendarViewMode(value: string | null): CalendarViewMode {
  return value === 'week' || value === 'list' || value === 'month' ? value : 'month';
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() - next.getDay());
  return next;
}


function startOfMonthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  first.setHours(0, 0, 0, 0);
  return addDays(first, -first.getDay());
}

function endOfMonthGrid(year: number, month: number) {
  const last = new Date(year, month + 1, 0);
  last.setHours(0, 0, 0, 0);
  return addDays(last, 7 - last.getDay());
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

function getCalendarEventRenderKey(event: GoogleCalendarEvent) {
  const startValue = event.start?.dateTime || event.start?.date || '';
  return `${event.calendarId || ''}:${event.id || ''}:${startValue}`;
}

/**
 * Google Calendar–style overlap layout.
 *
 * Groups overlapping events into clusters, assigns each event a column index
 * within its cluster, and returns layout info (column, totalColumns) so the
 * renderer can set percentage-based `left` and `width`.
 */
interface EventLayout {
  column: number;
  totalColumns: number;
}

function computeOverlapLayout(
  events: GoogleCalendarEvent[],
  getStart: (e: GoogleCalendarEvent) => number | null,
  getEnd: (e: GoogleCalendarEvent) => number | null,
): Map<GoogleCalendarEvent, EventLayout> {
  const result = new Map<GoogleCalendarEvent, EventLayout>();
  if (events.length === 0) return result;

  // Build a list of events with resolved start/end minutes.
  const items = events
    .map(event => ({
      event,
      start: getStart(event),
      end: getEnd(event),
    }))
    .filter((item): item is { event: GoogleCalendarEvent; start: number; end: number } =>
      item.start !== null && item.end !== null,
    )
    // Sort by start time, then by longest duration first (so wider events anchor left).
    .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  // Process events into overlap clusters using a sweep-line approach.
  let clusterEnd = -1;
  let cluster: typeof items = [];

  const flushCluster = () => {
    if (cluster.length === 0) return;

    // Greedily assign columns: for each event pick the first column whose
    // previous occupant has already ended.
    const columns: number[] = []; // end-time of the last event in each column
    const assignments = new Map<GoogleCalendarEvent, number>();

    for (const item of cluster) {
      let placed = false;
      for (let col = 0; col < columns.length; col++) {
        if (item.start >= columns[col]) {
          columns[col] = item.end;
          assignments.set(item.event, col);
          placed = true;
          break;
        }
      }
      if (!placed) {
        assignments.set(item.event, columns.length);
        columns.push(item.end);
      }
    }

    const totalColumns = columns.length;
    for (const item of cluster) {
      result.set(item.event, {
        column: assignments.get(item.event) ?? 0,
        totalColumns,
      });
    }
  };

  for (const item of items) {
    if (cluster.length === 0 || item.start < clusterEnd) {
      // Overlaps with current cluster — absorb it.
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.end);
    } else {
      // No overlap — flush previous cluster and start a new one.
      flushCluster();
      cluster = [item];
      clusterEnd = item.end;
    }
  }
  flushCluster();

  return result;
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

function getOutcomeDescription(status: StudyBlockOutcomeStatus) {
  switch (status) {
    case 'completed':
      return 'This session happened as planned, so future scheduling can lean on similar timing.';
    case 'partial':
      return 'You got some of it done. The planner can keep the topic but may shorten the next block.';
    case 'skipped':
      return 'This slot did not happen. Future plans should avoid overloading similar windows.';
    case 'rescheduled':
      return 'You moved this work instead of doing it here. The planner can learn from that timing shift.';
  }
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
  calendars: GoogleCalendarController['calendars'];
  visibleCalendarIds: string[];
  selectedCalendarId: string;
  isLoading: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onToggleVisibility: (id: string) => void;
  onChooseCalendar: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
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
        <div className="mt-3 space-y-1.5">
          {calendars.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border-soft)] px-3 py-4 text-xs text-[var(--text-faint)]">
              No calendars loaded yet.
            </div>
          ) : (
            calendars.map(item => {
              const checked = visibleCalendarIds.includes(item.id);
              const isActive = selectedCalendarId === item.id;
              const color = item.backgroundColor || '#818cf8';

              return (
                <div
                  key={item.id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-2.5 py-2 transition',
                    checked ? 'bg-[var(--surface-muted)]' : 'hover:bg-[var(--surface-muted)]'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onToggleVisibility(item.id)}
                    aria-pressed={checked}
                    className="flex h-5 w-5 items-center justify-center rounded-[6px] border-2 transition"
                    style={{
                      borderColor: color,
                      backgroundColor: checked ? color : 'transparent',
                      color: checked ? '#111827' : 'transparent',
                    }}
                    title={checked ? 'Hide calendar' : 'Show calendar'}
                  >
                    <Check size={12} strokeWidth={3} />
                  </button>
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
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
                    onClick={() => onChooseCalendar(item.id)}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium transition',
                      isActive
                        ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'bg-[var(--surface)] text-[var(--text-faint)]'
                    )}
                  >
                    {isActive ? 'Active' : 'Use'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
      {isLoading && <p className="mt-2 text-xs text-[var(--text-faint)]">Loading calendars...</p>}
    </div>
  );
}

function CalendarMiniMonth({
  year,
  month,
  selectedDate,
  onPrevMonth,
  onNextMonth,
  onSelectDate,
}: {
  year: number;
  month: number;
  selectedDate: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSelectDate: (date: string) => void;
}) {
  const today = new Date();
  const todayKey = formatDateKey(today);
  const monthLabel = new Date(year, month).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const cells = useMemo(() => {
    const first = startOfMonthGrid(year, month);
    const last = endOfMonthGrid(year, month);
    const days: { date: Date; dateKey: string; isCurrentMonth: boolean }[] = [];

    for (let cursor = new Date(first); cursor <= last; cursor = addDays(cursor, 1)) {
      days.push({
        date: new Date(cursor),
        dateKey: formatDateKey(cursor),
        isCurrentMonth: cursor.getMonth() === month,
      });
    }

    return days;
  }, [month, year]);

  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrevMonth}
            className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
            aria-label="Previous month"
          >
            <ChevronDown size={14} className="rotate-90" />
          </button>
          <button
            type="button"
            onClick={onNextMonth}
            className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
            aria-label="Next month"
          >
            <ChevronDown size={14} className="-rotate-90" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center text-[10px] font-medium text-[var(--text-faint)]">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
          <div key={`${day}-${index}`} className="py-1">
            {day}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-y-1">
        {cells.map(({ date, dateKey, isCurrentMonth }) => {
          const isToday = dateKey === todayKey;
          const isSelected = dateKey === selectedDate;

          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => onSelectDate(dateKey)}
              className={cn(
                'mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition',
                isSelected
                  ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                  : isToday
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : isCurrentMonth
                      ? 'text-[var(--text-primary)] hover:bg-[var(--surface-muted)]'
                      : 'text-[var(--text-faint)] hover:bg-[var(--surface-muted)]/70'
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface CalendarViewProps {
  calendar: GoogleCalendarController;
  deadlines?: import('../types').Deadline[];
  studyBlockOutcomes: StudyBlockOutcomeMap;
  getStudyBlockOutcome: (event: GoogleCalendarEvent) => StudyBlockOutcome | undefined;
  studyBlockOutcomesLoading: boolean;
  onSetStudyBlockOutcome: (event: GoogleCalendarEvent, status: StudyBlockOutcomeStatus) => Promise<boolean>;
}

function DayPanel({
  dateStr,
  events,
  deadlines = [],
  onDelete,
  onEdit,
  onOpenDetails,
  deletingId,
  onCreateEvent,
  studyBlockOutcomes,
  getStudyBlockOutcome,
  studyBlockOutcomesLoading,
  onSetStudyBlockOutcome,
}: {
  dateStr: string;
  events: GoogleCalendarEvent[];
  deadlines?: import('../types').Deadline[];
  onDelete: (id: string) => void;
  onEdit: (event: GoogleCalendarEvent) => void;
  onOpenDetails: (event: GoogleCalendarEvent) => void;
  deletingId: string | null;
  onCreateEvent: () => void;
  studyBlockOutcomes: StudyBlockOutcomeMap;
  getStudyBlockOutcome: (event: GoogleCalendarEvent) => StudyBlockOutcome | undefined;
  studyBlockOutcomesLoading: boolean;
  onSetStudyBlockOutcome: (event: GoogleCalendarEvent, status: StudyBlockOutcomeStatus) => Promise<boolean>;
}) {
  const [savingOutcomeId, setSavingOutcomeId] = useState<string | null>(null);

  if (!dateStr) {
    return (
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-dashed border-[var(--border-soft)] text-sm text-[var(--text-faint)]">
          Select a day to see its events.
        </div>
      </div>
    );
  }

  const dayDeadlines = deadlines.filter(d => d.dueDate === dateStr);
  const reviewableStudyBlocks = events.filter(event => {
    if (!isStudyBlockLikeCalendarEvent(event)) return false;
    const eventDateKey = getEventDateKey(event);
    if (eventDateKey !== dateStr) return false;
    return hasEventEnded(event);
  });
  const futureStudyBlocks = events.filter(event => {
    if (!isStudyBlockLikeCalendarEvent(event)) return false;
    const eventDateKey = getEventDateKey(event);
    if (eventDateKey !== dateStr) return false;
    return !hasEventEnded(event);
  });
  const dateLabel = new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const handleOutcomeClick = async (event: GoogleCalendarEvent, status: StudyBlockOutcomeStatus) => {
    setSavingOutcomeId(event.id);
    await onSetStudyBlockOutcome(event, status);
    setSavingOutcomeId(current => (current === event.id ? null : current));
  };

  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
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
        <div className="flex min-h-[120px] items-center justify-center rounded-lg border border-dashed border-[var(--border-soft)] text-sm text-[var(--text-faint)]">
          No events this day
        </div>
      ) : (
        <div className="space-y-3">
          {(reviewableStudyBlocks.length > 0 || futureStudyBlocks.length > 0) && (
            <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">Study review</h4>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Mark what actually happened so future study suggestions can become more realistic.
                  </p>
                </div>
                {studyBlockOutcomesLoading && (
                  <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-faint)]">Loading</span>
                )}
              </div>

              {reviewableStudyBlocks.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {reviewableStudyBlocks.map(event => {
                    const currentOutcome = getStudyBlockOutcome(event);
                    return (
                      <div
                        key={`review-${event.id}`}
                        className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h5 className="truncate text-sm font-medium text-[var(--text-primary)]">
                                {event.summary || 'Untitled event'}
                              </h5>
                              {currentOutcome && <OutcomeBadge status={currentOutcome.status} />}
                            </div>
                            <p className="mt-1 text-xs text-[var(--text-muted)]">
                              {getEventTimeLabel(event.start)}
                              {event.end?.dateTime ? ` - ${getEventTimeLabel(event.end)}` : ''}
                              {event.calendarSummary ? ` · ${event.calendarSummary}` : ''}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {STUDY_OUTCOME_OPTIONS.map(option => {
                            const selected = currentOutcome?.status === option.status;
                            return (
                              <button
                                key={option.status}
                                type="button"
                                onClick={() => void handleOutcomeClick(event, option.status)}
                                disabled={savingOutcomeId === event.id}
                                className={cn(
                                  'rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                                  selected
                                    ? getOutcomeTone(option.status)
                                    : 'border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
                                )}
                              >
                                {savingOutcomeId === event.id && selected ? 'Saving…' : option.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-[var(--border-soft)] px-3 py-4 text-xs text-[var(--text-faint)]">
                  No study blocks are ready for review yet.
                </div>
              )}

              {futureStudyBlocks.length > 0 && (
                <p className="mt-3 text-xs text-[var(--text-faint)]">
                  {futureStudyBlocks.length === 1
                    ? 'One study block on this date can be reviewed after it ends.'
                    : `${futureStudyBlocks.length} study blocks on this date can be reviewed after they end.`}
                </p>
              )}
            </div>
          )}

          {dayDeadlines.map(dl => (
            <div
              key={dl.id}
              className="flex items-start gap-3 rounded-lg bg-orange-400/6 p-3"
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
            (() => {
              const currentOutcome = getStudyBlockOutcome(event);
              const presentation = getCalendarEventPresentation(event);
              return (
                <button
                  key={getCalendarEventRenderKey(event)}
                  type="button"
                  onClick={() => onOpenDetails(event)}
                  className={cn(
                    'group flex w-full items-start gap-3 rounded-lg p-3 text-left transition hover:brightness-[1.02]',
                    presentation.isSuggested ? 'border' : 'bg-[var(--surface-muted)]'
                  )}
                  style={presentation.isSuggested ? {
                    backgroundColor: presentation.surfaceColor,
                    borderColor: presentation.borderColor,
                  } : undefined}
                >
                  <div
                    className="mt-1 flex h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: presentation.accentColor }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {event.summary || 'Untitled event'}
                      </h4>
                      {presentation.badgeLabel && (
                        <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                          {presentation.badgeLabel}
                        </span>
                      )}
                      {currentOutcome && <OutcomeBadge status={currentOutcome.status} />}
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {getEventTimeLabel(event.start)}
                    </p>
                    {presentation.metadata?.deadlineTitle && (
                      <p className="mt-1 text-[11px] font-medium text-[var(--accent)]">
                        Linked to {presentation.metadata.deadlineTitle}
                      </p>
                    )}
                    {presentation.description && (
                      <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--text-faint)]">
                        {presentation.description}
                      </p>
                    )}
                    {event.location && (
                      <p className="mt-1 text-xs text-[var(--text-faint)] truncate">{event.location}</p>
                    )}
                  </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={clickEvent => {
                    clickEvent.stopPropagation();
                    onEdit(event);
                  }}
                  className="rounded-full p-1.5 text-[var(--text-faint)] opacity-100 transition hover:text-[var(--text-primary)] md:opacity-0 md:group-hover:opacity-100"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  onClick={clickEvent => {
                    clickEvent.stopPropagation();
                    onDelete(event.id);
                  }}
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
                    onClick={clickEvent => clickEvent.stopPropagation()}
                    className="rounded-full p-1.5 text-[var(--text-faint)] transition hover:text-[var(--text-primary)]"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
                </button>
              );
            })()
          ))}
        </div>
      )}
    </div>
  );
}

function CalendarEventDetailModal({
  event,
  currentOutcome,
  isSavingOutcome,
  onClose,
  onEdit,
  onDelete,
  onSetOutcome,
}: {
  event: GoogleCalendarEvent;
  currentOutcome?: StudyBlockOutcome;
  isSavingOutcome: boolean;
  onClose: () => void;
  onEdit: (event: GoogleCalendarEvent) => void;
  onDelete: (eventId: string) => void;
  onSetOutcome: (event: GoogleCalendarEvent, status: StudyBlockOutcomeStatus) => Promise<void>;
}) {
  const presentation = getCalendarEventPresentation(event);
  const eventDateKey = getEventDateKey(event);
  const isStudyBlock = isStudyBlockLikeCalendarEvent(event);
  const eventEnded = hasEventEnded(event);
  const reviewReady = isStudyBlock && eventEnded;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-[26px] border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-[0_24px_80px_rgba(15,23,42,0.18)]"
        onClick={modalEvent => modalEvent.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-soft)] px-6 py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-tight text-[var(--text-primary)]">
                {event.summary || 'Untitled event'}
              </h2>
              {presentation.badgeLabel && (
                <span className="rounded-full bg-black/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                  {presentation.badgeLabel}
                </span>
              )}
              {currentOutcome && <OutcomeBadge status={currentOutcome.status} />}
            </div>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {getEventStartLabel(event.start)}
              {event.end?.dateTime ? ` · ${getEventTimeLabel(event.start)} – ${getEventTimeLabel(event.end)}` : ''}
              {event.calendarSummary ? ` · ${event.calendarSummary}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--border-soft)] p-2 text-[var(--text-faint)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">Timing</p>
              <p className="mt-2 text-sm text-[var(--text-primary)]">
                {getEventStartLabel(event.start)}
                {event.end?.dateTime ? ` · ${getEventTimeLabel(event.start)} – ${getEventTimeLabel(event.end)}` : ''}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">Context</p>
              <div className="mt-2 space-y-1.5 text-sm text-[var(--text-primary)]">
                <p>{presentation.badgeLabel ?? 'Manual or AI-assisted event'}</p>
                {presentation.metadata?.deadlineTitle ? (
                  <p className="font-medium text-[var(--accent)]">Linked to {presentation.metadata.deadlineTitle}</p>
                ) : (
                  <p className="text-[var(--text-muted)]">No linked deadline</p>
                )}
              </div>
            </div>
          </div>

          {event.location && (
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">Location</p>
              <p className="mt-2 text-sm text-[var(--text-primary)]">{event.location}</p>
            </div>
          )}

          {(presentation.metadata?.explanation || presentation.description) && (
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                {presentation.metadata?.explanation ? 'Why this slot' : 'Notes'}
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                {presentation.metadata?.explanation ?? presentation.description}
              </p>
            </div>
          )}

          {presentation.metadata?.notes && presentation.metadata.explanation && (
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">Notes</p>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{presentation.metadata.notes}</p>
            </div>
          )}

          {isStudyBlock && (
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">Study review</p>
                  <p className="mt-2 text-sm text-[var(--text-secondary)]">
                    {reviewReady
                      ? 'Mark what actually happened so the next plan gets smarter.'
                      : eventDateKey
                        ? `This block can be reviewed after it ends${eventDateKey ? ` on ${new Date(`${eventDateKey}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}.`
                        : 'This block can be reviewed after it ends.'}
                  </p>
                </div>
                {currentOutcome && <OutcomeBadge status={currentOutcome.status} />}
              </div>

              {reviewReady ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {STUDY_OUTCOME_OPTIONS.map(option => {
                    const selected = currentOutcome?.status === option.status;
                    return (
                      <button
                        key={option.status}
                        type="button"
                        onClick={() => void onSetOutcome(event, option.status)}
                        disabled={isSavingOutcome}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                          selected
                            ? getOutcomeTone(option.status)
                            : 'border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
                        )}
                      >
                        {isSavingOutcome && selected ? 'Saving…' : option.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {currentOutcome && (
                <p className="mt-3 text-xs leading-5 text-[var(--text-faint)]">
                  {getOutcomeDescription(currentOutcome.status)}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-soft)] px-6 py-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onEdit(event)}
              className="rounded-xl border border-[var(--border-soft)] px-3.5 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(event.id)}
              className="rounded-xl border border-red-500/20 px-3.5 py-2 text-sm font-medium text-red-400 transition hover:border-red-500/40"
            >
              Delete
            </button>
          </div>
          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl px-3.5 py-2 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)]"
            >
              Open in Google Calendar
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function WeekCalendarGrid({
  weekStart,
  events,
  deadlines = [],
  selectedDate,
  draftPreview,
  headerLabel,
  onPrevWeek,
  onNextWeek,
  onToday,
  onSelectDate,
  onOpenEventDetails,
  onEditEvent,
  onCreateEventAt,
}: {
  weekStart: Date;
  events: GoogleCalendarEvent[];
  deadlines?: import('../types').Deadline[];
  selectedDate: string;
  draftPreview: { dateKey: string; startMinutes: number; endMinutes: number } | null;
  headerLabel: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onSelectDate: (date: string) => void;
  onOpenEventDetails: (event: GoogleCalendarEvent) => void;
  onEditEvent: (event: GoogleCalendarEvent, anchorRect?: { top: number; left: number; width: number; height: number }) => void;
  onCreateEventAt: (
    date: string,
    startTime: string,
    endTime: string,
    anchorRect: { top: number; left: number; width: number; height: number }
  ) => void;
}) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekStartHour = 0;
  const hourRows = Array.from({ length: 24 }, (_, index) => weekStartHour + index);
  const rowHeight = 40;
  const todayKey = formatDateKey(new Date());
  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setNowMinutes(n.getHours() * 60 + n.getMinutes());
    };
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const [hoverSlot, setHoverSlot] = useState<{ dateKey: string; startMinutes: number } | null>(null);
  const [dragSelection, setDragSelection] = useState<{
    dateKey: string;
    startMinutes: number;
    currentMinutes: number;
    anchorRect: { top: number; left: number; width: number; height: number };
  } | null>(null);
  const dayColumnRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const finalizeDragSelection = (selection: NonNullable<typeof dragSelection>) => {
    const startMinutes = Math.min(selection.startMinutes, selection.currentMinutes);
    const endMinutes =
      selection.startMinutes === selection.currentMinutes
        ? Math.min(startMinutes + 60, 24 * 60)
        : Math.min(Math.max(selection.startMinutes, selection.currentMinutes) + 15, 24 * 60);

    const columnRect = dayColumnRefs.current[selection.dateKey]?.getBoundingClientRect();
    const anchorTop = columnRect
      ? columnRect.top + window.scrollY + ((startMinutes - weekStartHour * 60) / 60) * rowHeight
      : selection.anchorRect.top;

    onCreateEventAt(
      selection.dateKey,
      minutesToTime(startMinutes),
      minutesToTime(endMinutes),
      {
        top: anchorTop,
        left: selection.anchorRect.left,
        width: selection.anchorRect.width,
        height: Math.max(((endMinutes - startMinutes) / 60) * rowHeight, rowHeight),
      }
    );
    setDragSelection(null);
  };

  useEffect(() => {
    if (!dragSelection) return;

    const handleWindowMouseUp = () => {
      finalizeDragSelection(dragSelection);
    };

    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [dragSelection]);

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

  const layoutByDay = useMemo(() => {
    const layouts = new Map<string, Map<GoogleCalendarEvent, EventLayout>>();
    for (const [key, dayEvents] of eventsByDay) {
      layouts.set(
        key,
        computeOverlapLayout(
          dayEvents,
          e => getMinutesFromStart(e.start?.dateTime),
          e => getMinutesFromStart(e.end?.dateTime),
        ),
      );
    }
    return layouts;
  }, [eventsByDay]);

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
    <div className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
        <h2 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">{headerLabel}</h2>
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
            onClick={onPrevWeek}
            className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
            aria-label="Previous week"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={onNextWeek}
            className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
            aria-label="Next week"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

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
                  (() => {
                    const presentation = getCalendarEventPresentation(event);
                    return (
                      <div
                        key={getCalendarEventRenderKey(event)}
                        className={cn(
                          'flex items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-[10px] font-medium text-[var(--text-secondary)]',
                          presentation.isSuggested && 'border'
                        )}
                        style={presentation.isSuggested ? {
                          backgroundColor: presentation.mutedSurfaceColor,
                          borderColor: presentation.borderColor,
                        } : undefined}
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: presentation.accentColor }} />
                        <span className="truncate">{event.summary || 'Untitled'}</span>
                        {presentation.isSuggested && (
                          <span className="shrink-0 rounded-full bg-black/5 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                            AI
                          </span>
                        )}
                      </div>
                    );
                  })()
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
            const previewStartMinutes = dragSelection?.dateKey === key
              ? Math.min(dragSelection.startMinutes, dragSelection.currentMinutes)
              : hoverSlot?.dateKey === key
                ? hoverSlot.startMinutes
                : null;
            const previewEndMinutes = dragSelection?.dateKey === key
              ? Math.max(dragSelection.startMinutes, dragSelection.currentMinutes) + 15
              : previewStartMinutes !== null
                ? Math.min(previewStartMinutes + 15, 24 * 60)
                : null;

            return (
              <div
                key={key}
                ref={node => {
                  dayColumnRefs.current[key] = node;
                }}
                className={cn(
                  'relative border-r border-[var(--border-soft)] last:border-r-0',
                  isSelected && 'bg-[var(--accent-soft)]/40'
                )}
              >
                {hourRows.map(hour => (
                  <button
                    key={hour}
                    type="button"
                    onMouseMove={event => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const relativeY = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
                      const quarterIndex = Math.min(3, Math.floor((relativeY / rect.height) * 4));
                      const startMinutes = hour * 60 + quarterIndex * 15;
                      if (dragSelection?.dateKey === key) {
                        setDragSelection(current =>
                          current && current.dateKey === key
                            ? { ...current, currentMinutes: startMinutes }
                            : current
                        );
                      } else {
                        setHoverSlot({
                          dateKey: key,
                          startMinutes,
                        });
                      }
                    }}
                    onMouseLeave={() => {
                      if (!dragSelection || dragSelection.dateKey !== key) {
                        setHoverSlot(current => (current?.dateKey === key ? null : current));
                      }
                    }}
                    onMouseDown={event => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const relativeY = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
                      const quarterIndex = Math.min(3, Math.floor((relativeY / rect.height) * 4));
                      const startMinutes = hour * 60 + quarterIndex * 15;
                      const columnRect = dayColumnRefs.current[key]?.getBoundingClientRect() ?? rect;
                      setDragSelection({
                        dateKey: key,
                        startMinutes,
                        currentMinutes: startMinutes,
                        anchorRect: {
                          top: columnRect.top + window.scrollY + ((startMinutes - weekStartHour * 60) / 60) * rowHeight,
                          left: columnRect.left + window.scrollX,
                          width: columnRect.width,
                          height: rowHeight,
                        },
                      });
                      setHoverSlot({
                        dateKey: key,
                        startMinutes,
                      });
                    }}
                    className="block w-full border-b border-[var(--border-soft)] transition"
                    style={{ height: `${rowHeight}px` }}
                  />
                ))}

                {draftPreview?.dateKey === key && (
                  <div
                    className="pointer-events-none absolute left-1.5 right-1.5 z-10 overflow-hidden rounded-lg"
                    style={{
                      top: `${((draftPreview.startMinutes - weekStartHour * 60) / 60) * rowHeight}px`,
                      height: `${Math.max(((draftPreview.endMinutes - draftPreview.startMinutes) / 60) * rowHeight, rowHeight / 4)}px`,
                      backgroundColor: 'var(--accent-soft)',
                      borderLeft: '3px solid var(--accent)',
                    }}
                  >
                    <div className="px-2 py-1 text-[10px] font-medium text-[var(--accent)]">
                      (No title)
                    </div>
                  </div>
                )}

                {previewStartMinutes !== null && previewEndMinutes !== null && (
                  <div
                    className="pointer-events-none absolute left-1.5 right-1.5 z-20 overflow-hidden rounded-md bg-[var(--surface-muted)]/95"
                    style={{
                      top: `${((previewStartMinutes - weekStartHour * 60) / 60) * rowHeight}px`,
                      height: `${Math.max(((previewEndMinutes - previewStartMinutes) / 60) * rowHeight, rowHeight / 4)}px`,
                    }}
                  />
                )}

                {dayEvents.map(event => {
                  const startMinutes = getMinutesFromStart(event.start?.dateTime);
                  const endMinutes = getMinutesFromStart(event.end?.dateTime);
                  if (startMinutes === null || endMinutes === null) return null;
                  const presentation = getCalendarEventPresentation(event);

                  const top = ((startMinutes - weekStartHour * 60) / 60) * rowHeight;
                  const height = Math.max(((endMinutes - startMinutes) / 60) * rowHeight, 24);

                  if (top < 0 || top > hourRows.length * rowHeight) return null;

                  const dayLayout = layoutByDay.get(key);
                  const layout = dayLayout?.get(event);
                  const column = layout?.column ?? 0;
                  const totalColumns = layout?.totalColumns ?? 1;

                  // Percentage-based left/width with a small gap between columns
                  const colWidthPct = 100 / totalColumns;
                  const leftPct = column * colWidthPct;
                  // Small padding: 6px on the outer edges, 2px between columns
                  const paddingLeft = column === 0 ? 6 : 2;
                  const paddingRight = column === totalColumns - 1 ? 6 : 2;

                  return (
                    <button
                      key={getCalendarEventRenderKey(event)}
                      type="button"
                      onClick={e => {
                        onSelectDate(key);
                        onOpenEventDetails(event);
                      }}
                      className="absolute overflow-hidden rounded-lg px-2 py-1 text-left shadow-sm"
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: `calc(${leftPct}% + ${paddingLeft}px)`,
                        width: `calc(${colWidthPct}% - ${paddingLeft + paddingRight}px)`,
                        backgroundColor: presentation.surfaceColor,
                        borderLeft: `3px solid ${presentation.accentColor}`,
                        borderTop: presentation.isSuggested ? `1px solid ${presentation.borderColor}` : undefined,
                        borderRight: presentation.isSuggested ? `1px solid ${presentation.borderColor}` : undefined,
                        borderBottom: presentation.isSuggested ? `1px solid ${presentation.borderColor}` : undefined,
                        zIndex: column + 1,
                      }}
                    >
                      {presentation.badgeLabel && height >= 42 && (
                        <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                          {presentation.badgeLabel}
                        </div>
                      )}
                      <div className="text-[10px] font-semibold leading-tight text-[var(--text-primary)]">
                        {event.summary || 'Untitled event'}
                      </div>
                      <div className="text-[10px] leading-tight text-[var(--text-muted)]">
                        {getEventTimeLabel(event.start)}
                        {event.end?.dateTime ? ` - ${getEventTimeLabel(event.end)}` : ''}
                      </div>
                      {presentation.metadata?.deadlineTitle && height >= 68 && (
                        <div className="mt-0.5 truncate text-[9px] leading-tight text-[var(--accent)]">
                          {presentation.metadata.deadlineTitle}
                        </div>
                      )}
                    </button>
                  );
                })}

                {/* Current time indicator (red line + dot) */}
                {key === todayKey && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-30"
                    style={{ top: `${((nowMinutes - weekStartHour * 60) / 60) * rowHeight}px` }}
                  >
                    <div className="absolute -left-[5px] -top-[5px] h-[10px] w-[10px] rounded-full bg-red-500" />
                    <div className="absolute left-0 right-0 top-0 h-[2px] bg-red-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CalendarView({
  calendar,
  deadlines = [],
  studyBlockOutcomes,
  getStudyBlockOutcome,
  studyBlockOutcomesLoading,
  onSetStudyBlockOutcome,
}: CalendarViewProps) {
  const hasCalendarSurface = calendar.isConnected || calendar.isLoading;
  const [searchParams, setSearchParams] = useSearchParams();
  const viewMode = useMemo<CalendarViewMode>(
    () => parseCalendarViewMode(searchParams.get('view')),
    [searchParams],
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<GoogleCalendarEvent | null>(null);
  const [detailEvent, setDetailEvent] = useState<GoogleCalendarEvent | null>(null);
  const [createDate, setCreateDate] = useState<string | undefined>(undefined);
  const [createStartTime, setCreateStartTime] = useState<string | undefined>(undefined);
  const [createEndTime, setCreateEndTime] = useState<string | undefined>(undefined);
  const [createAnchorRect, setCreateAnchorRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [weekDraftPreview, setWeekDraftPreview] = useState<{ dateKey: string; startMinutes: number; endMinutes: number } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingDetailOutcomeId, setSavingDetailOutcomeId] = useState<string | null>(null);
  const [showCalendarList, setShowCalendarList] = useState(true);

  const now = new Date();
  const todayStr = formatDateKey(now);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [viewDate, setViewDate] = useState<string>(todayStr);
  const viewAnchor = useMemo(() => new Date(`${viewDate}T00:00:00`), [viewDate]);
  const year = viewAnchor.getFullYear();
  const month = viewAnchor.getMonth();
  const weekStart = useMemo(() => startOfWeek(viewAnchor), [viewAnchor]);
  const visibleRange = useMemo(() => {
    if (viewMode === 'week') {
      const rangeStart = new Date(weekStart);
      rangeStart.setHours(0, 0, 0, 0);
      const rangeEnd = addDays(rangeStart, 7);
      rangeEnd.setHours(0, 0, 0, 0);
      return {
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
      };
    }

    if (viewMode === 'month') {
      const rangeStart = startOfMonthGrid(year, month);
      const rangeEnd = endOfMonthGrid(year, month);
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd.setHours(0, 0, 0, 0);
      return {
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
      };
    }

    return {
      timeMin: new Date().toISOString(),
      timeMax: undefined,
    };
  }, [month, viewMode, weekStart, year]);

  useEffect(() => {
    calendar.setVisibleRange(visibleRange);
  }, [calendar, visibleRange]);

  const selectDate = (date: string) => {
    if (selectedDate === date) {
      setSelectedDate('');
      return;
    }
    setSelectedDate(date);
    setViewDate(date);
  };

  const handleShiftMonth = (delta: number) => {
    const nextDate = addMonths(viewAnchor, delta);
    setViewDate(formatDateKey(nextDate));
  };

  const handleToday = () => {
    setSelectedDate(todayStr);
    setViewDate(todayStr);
  };

  const handleSetViewMode = (nextView: CalendarViewMode) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('view', nextView);
    setSearchParams(nextParams);
  };

  const handleCreateFromDate = (date: string) => {
    setEditingEvent(null);
    if (!date) return;
    setCreateDate(date);
    setCreateStartTime(undefined);
    setCreateEndTime(undefined);
    setCreateAnchorRect(null);
    setWeekDraftPreview(null);
    setShowCreateModal(true);
  };

  const handleCreateFromWeekSlot = (
    date: string,
    startTime: string,
    endTime: string,
    anchorRect: { top: number; left: number; width: number; height: number }
  ) => {
    setEditingEvent(null);
    setCreateDate(date);
    setCreateStartTime(startTime);
    setCreateEndTime(endTime);
    setCreateAnchorRect(anchorRect);
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    setWeekDraftPreview({
      dateKey: date,
      startMinutes: startHour * 60 + startMinute,
      endMinutes: endHour * 60 + endMinute,
    });
    setShowCreateModal(true);
  };

  const handleCloseCreateModal = () => {
    setShowCreateModal(false);
    setWeekDraftPreview(null);
    setEditingEvent(null);
  };

  const handleSaveEvent = async (
    event: import('../lib/googleCalendar').NewGoogleCalendarEvent,
    options?: {
      calendarId?: string;
      linkedDeadlineId?: string | null;
      metadataOrigin?: import('../lib/academicPlanning').AcademicPlanOrigin | null;
    },
  ) => {
    const linkedDeadline = options?.linkedDeadlineId
      ? deadlines.find(deadline => deadline.id === options.linkedDeadlineId) ?? null
      : null;
    const existingMetadata = editingEvent ? parseAcademicPlanMetadata(editingEvent.description) : null;
    const eventDescription = event.description?.trim() || null;
    const eventToSave = linkedDeadline
      ? {
          ...event,
          description: buildAcademicPlanMetadataDescription({
            deadlineId: linkedDeadline.id,
            deadlineTitle: linkedDeadline.title,
            deadlineDate: linkedDeadline.dueDate,
            deadlineType: linkedDeadline.type,
            explanation: existingMetadata?.explanation ?? null,
            notes: eventDescription,
            origin: options?.metadataOrigin ?? existingMetadata?.origin ?? 'manual',
          }),
        }
      : {
          ...event,
          description: eventDescription || undefined,
        };
    const ok = editingEvent
      ? await calendar.updateEvent(editingEvent.id, eventToSave, options?.calendarId ?? editingEvent.calendarId, editingEvent)
      : await calendar.createEvent(eventToSave, options?.calendarId);
    if (ok) {
      setWeekDraftPreview(null);
      setEditingEvent(null);
    }
    return ok;
  };

  const handleDelete = async (eventId: string) => {
    if (detailEvent?.id === eventId) {
      setDetailEvent(null);
    }
    setDeletingId(eventId);
    await calendar.deleteEvent(eventId);
    setDeletingId(null);
  };

  const handleEditEvent = (
    event: GoogleCalendarEvent,
    anchorRect?: { top: number; left: number; width: number; height: number },
  ) => {
    setDetailEvent(null);
    setEditingEvent(event);
    setCreateDate(undefined);
    setCreateStartTime(undefined);
    setCreateEndTime(undefined);
    setCreateAnchorRect(anchorRect ?? null);
    setWeekDraftPreview(null);
    setShowCreateModal(true);
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

  const deadlineOptions = useMemo(() => (
    [...deadlines]
      .filter(deadline => deadline.status !== 'done' && deadline.status !== 'missed')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map(deadline => ({
        id: deadline.id,
        label: `${deadline.title} · ${new Date(`${deadline.dueDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      }))
  ), [deadlines]);

  const handleOpenEventDetails = (event: GoogleCalendarEvent) => {
    setDetailEvent(event);
  };

  const handleDetailOutcome = async (event: GoogleCalendarEvent, status: StudyBlockOutcomeStatus) => {
    setSavingDetailOutcomeId(event.id);
    await onSetStudyBlockOutcome(event, status);
    setSavingDetailOutcomeId(current => (current === event.id ? null : current));
  };

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">Calendar</h1>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {hasCalendarSurface && (
            <div className="flex overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)]">
              <button
                type="button"
                onClick={() => handleSetViewMode('month')}
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
                onClick={() => handleSetViewMode('week')}
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
                onClick={() => handleSetViewMode('list')}
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

          {hasCalendarSurface ? (
            <>
              <button
                type="button"
                onClick={() => { setCreateDate(undefined); setShowCreateModal(true); }}
                className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium bg-[var(--accent-strong)] text-[var(--accent-contrast)]"
               
              >
                <Plus size={16} />
                New Event
              </button>
              <button
                type="button"
                onClick={() => void calendar.refresh()}
                className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
              >
                <RefreshCcw size={15} />
                Refresh
              </button>
              <button
                type="button"
                onClick={calendar.disconnect}
                className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
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
              className="rounded-lg px-4 py-2.5 text-sm font-medium bg-[var(--accent-strong)] text-[var(--accent-contrast)] shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
             
            >
              {calendar.isConnecting ? 'Connecting...' : 'Connect Google Calendar'}
            </button>
          )}
        </div>
        </div>
      </div>

      {!calendar.isConfigured && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
          Add `VITE_GOOGLE_CLIENT_ID` to your local env and Vercel project settings before Google Calendar can connect.
        </div>
      )}

      {calendar.error && (
        <div className="rounded-lg border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
          {calendar.error}
        </div>
      )}

      {!hasCalendarSurface ? (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <section className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
            <div className="flex items-center gap-2">
              <CalendarDays size={18} className="text-[var(--accent)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Connected Calendar</h2>
            </div>
            <div className="mt-6 rounded-xl border border-dashed border-[var(--border-soft)] p-4 text-sm text-[var(--text-muted)]">
              Connect your Google account to view and create events here.
            </div>
          </section>
          <section className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
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
            onSelectDate={selectDate}
            onPrevMonth={() => handleShiftMonth(-1)}
            onNextMonth={() => handleShiftMonth(1)}
            onToday={handleToday}
            onCreateEvent={handleCreateFromDate}
          />

          <div className="space-y-4">
            <CalendarMiniMonth
              year={year}
              month={month}
              selectedDate={selectedDate}
              onPrevMonth={() => handleShiftMonth(-1)}
              onNextMonth={() => handleShiftMonth(1)}
              onSelectDate={selectDate}
            />

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
              onEdit={event => handleEditEvent(event)}
              onOpenDetails={handleOpenEventDetails}
              onDelete={id => void handleDelete(id)}
              deletingId={deletingId}
              onCreateEvent={() => handleCreateFromDate(selectedDate)}
              studyBlockOutcomes={studyBlockOutcomes}
              getStudyBlockOutcome={getStudyBlockOutcome}
              studyBlockOutcomesLoading={studyBlockOutcomesLoading}
              onSetStudyBlockOutcome={onSetStudyBlockOutcome}
            />
          </div>
        </div>
      ) : viewMode === 'week' ? (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <WeekCalendarGrid
              weekStart={weekStart}
              events={calendar.events}
              deadlines={deadlines}
              selectedDate={selectedDate}
              draftPreview={weekDraftPreview}
              headerLabel={formatWeekRangeLabel(weekStart)}
              onPrevWeek={() => setViewDate(formatDateKey(addDays(viewAnchor, -7)))}
              onNextWeek={() => setViewDate(formatDateKey(addDays(viewAnchor, 7)))}
              onToday={handleToday}
              onSelectDate={selectDate}
              onOpenEventDetails={handleOpenEventDetails}
              onEditEvent={handleEditEvent}
              onCreateEventAt={handleCreateFromWeekSlot}
            />

            <div className="space-y-4">
              <CalendarMiniMonth
                year={year}
                month={month}
                selectedDate={selectedDate}
                onPrevMonth={() => handleShiftMonth(-1)}
                onNextMonth={() => handleShiftMonth(1)}
                onSelectDate={selectDate}
              />

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
                onEdit={event => handleEditEvent(event)}
                onOpenDetails={handleOpenEventDetails}
                onDelete={id => void handleDelete(id)}
                deletingId={deletingId}
                onCreateEvent={() => handleCreateFromDate(selectedDate)}
                studyBlockOutcomes={studyBlockOutcomes}
                getStudyBlockOutcome={getStudyBlockOutcome}
                studyBlockOutcomesLoading={studyBlockOutcomesLoading}
                onSetStudyBlockOutcome={onSetStudyBlockOutcome}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
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
                        (() => {
                          const currentOutcome = getStudyBlockOutcome(event);
                          const presentation = getCalendarEventPresentation(event);
                          return (
                            <article
                              key={getCalendarEventRenderKey(event)}
                              onClick={() => handleOpenEventDetails(event)}
                              className={cn(
                                'group cursor-pointer rounded-lg p-4 transition hover:brightness-[1.02]',
                                presentation.isSuggested ? 'border' : 'bg-[var(--surface-muted)]'
                              )}
                              style={presentation.isSuggested ? {
                                backgroundColor: presentation.surfaceColor,
                                borderColor: presentation.borderColor,
                              } : undefined}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                                      {event.summary || 'Untitled event'}
                                    </h4>
                                    {presentation.badgeLabel && (
                                      <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                                        {presentation.badgeLabel}
                                      </span>
                                    )}
                                    {currentOutcome && <OutcomeBadge status={currentOutcome.status} />}
                                  </div>
                                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                                    {getEventStartLabel(event.start)}
                                  </p>
                                  {presentation.metadata?.deadlineTitle && (
                                    <p className="mt-2 text-xs font-medium text-[var(--accent)]">
                                      Linked to {presentation.metadata.deadlineTitle}
                                    </p>
                                  )}
                                  <p className="mt-2 text-xs text-[var(--text-faint)]">
                                    {event.location
                                      ? event.location
                                      : presentation.description
                                        ? presentation.metadata?.explanation
                                          ? 'Open details to see why this slot was chosen.'
                                          : presentation.description
                                        : 'Open details for the full context.'}
                                  </p>
                                </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={clickEvent => {
                                  clickEvent.stopPropagation();
                                  handleEditEvent(event);
                                }}
                                className="rounded-full border border-[var(--border-soft)] p-2 text-[var(--text-faint)] opacity-100 transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] md:opacity-0 md:group-hover:opacity-100"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={clickEvent => {
                                  clickEvent.stopPropagation();
                                  void handleDelete(event.id);
                                }}
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
                                  onClick={clickEvent => clickEvent.stopPropagation()}
                                  className="rounded-full border border-[var(--border-soft)] p-2 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                                >
                                  <ExternalLink size={14} />
                                </a>
                              )}
                            </div>
                              </div>
                            </article>
                          );
                        })()
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="space-y-4">
            <CalendarMiniMonth
              year={year}
              month={month}
              selectedDate={selectedDate}
              onPrevMonth={() => handleShiftMonth(-1)}
              onNextMonth={() => handleShiftMonth(1)}
              onSelectDate={selectDate}
            />

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
          </div>
        </div>
      )}

      {showCreateModal && (
        <CreateEventModal
          initialDate={editingEvent?.start?.date || (editingEvent?.start?.dateTime ? editingEvent.start.dateTime.slice(0, 10) : createDate)}
          initialEndDate={editingEvent?.end?.date ? formatDateKey(addDays(new Date(`${editingEvent.end.date}T00:00:00`), -1)) : undefined}
          initialStartTime={editingEvent?.start?.dateTime ? new Date(editingEvent.start.dateTime).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false }) : createStartTime}
          initialEndTime={editingEvent?.end?.dateTime ? new Date(editingEvent.end.dateTime).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false }) : createEndTime}
          initialSummary={editingEvent?.summary || ''}
          initialDescription={editingEvent ? (parseAcademicPlanMetadata(editingEvent.description)?.notes ?? editingEvent.description ?? '') : ''}
          initialLocation={editingEvent?.location || ''}
          initialAllDay={Boolean(editingEvent?.start?.date && !editingEvent?.start?.dateTime)}
          deadlineOptions={deadlineOptions}
          initialLinkedDeadlineId={editingEvent ? parseAcademicPlanMetadata(editingEvent.description)?.deadlineId ?? null : null}
          initialMetadataOrigin={editingEvent ? parseAcademicPlanMetadata(editingEvent.description)?.origin ?? null : null}
          calendars={calendar.calendars}
          initialCalendarId={editingEvent?.calendarId || calendar.selectedCalendarId}
          compact={viewMode === 'week'}
          anchorRect={createAnchorRect}
          mode={editingEvent ? 'edit' : 'create'}
          onSave={handleSaveEvent}
          onClose={handleCloseCreateModal}
        />
      )}

      {detailEvent && (
        <CalendarEventDetailModal
          event={detailEvent}
          currentOutcome={getStudyBlockOutcome(detailEvent)}
          isSavingOutcome={savingDetailOutcomeId === detailEvent.id}
          onClose={() => setDetailEvent(null)}
          onEdit={handleEditEvent}
          onDelete={handleDelete}
          onSetOutcome={handleDetailOutcome}
        />
      )}
    </div>
  );
}
