import { useState, useMemo } from 'react';
import { CalendarDays, ExternalLink, List, LayoutGrid, Plus, RefreshCcw, Trash2, Unplug } from 'lucide-react';
import { useGoogleCalendar } from '../hooks/useGoogleCalendar';
import { GoogleCalendarEvent } from '../lib/googleCalendar';
import { CreateEventModal } from './CreateEventModal';
import { CalendarGrid } from './CalendarGrid';
import { cn } from '../utils/cn';

type CalendarViewMode = 'month' | 'list';

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

interface CalendarViewProps {
  userId: string;
}

function DayPanel({
  dateStr,
  events,
  onDelete,
  deletingId,
  onCreateEvent,
}: {
  dateStr: string;
  events: GoogleCalendarEvent[];
  onDelete: (id: string) => void;
  deletingId: string | null;
  onCreateEvent: () => void;
}) {
  const dateLabel = new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{dateLabel}</h3>
        <button
          type="button"
          onClick={onCreateEvent}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)]"
        >
          <Plus size={14} /> Add event
        </button>
      </div>

      {events.length === 0 ? (
        <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-dashed border-[var(--border-soft)] text-sm text-[var(--text-faint)]">
          No events this day
        </div>
      ) : (
        <div className="space-y-2">
          {events.map(event => (
            <div
              key={event.id}
              className="group flex items-start gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3"
            >
              <div className="mt-0.5 flex h-8 w-1 shrink-0 rounded-full bg-indigo-400" />
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
                  className="rounded-full p-1.5 text-[var(--text-faint)] opacity-0 transition group-hover:opacity-100 hover:text-red-400 disabled:opacity-50"
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

export function CalendarView({ userId }: CalendarViewProps) {
  const calendar = useGoogleCalendar(userId);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createDate, setCreateDate] = useState<string | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Calendar</h1>
          <p className="mt-1 text-[var(--text-muted)]">
            View and create Google Calendar events from TaskFlow.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {calendar.isConnected && (
            <div className="flex rounded-lg border border-[var(--border-soft)] overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode('month')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
                  viewMode === 'month'
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                )}
              >
                <LayoutGrid size={14} /> Month
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-l border-[var(--border-soft)]',
                  viewMode === 'list'
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
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
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-[var(--accent-contrast)]"
                style={{ backgroundColor: 'var(--accent-strong)' }}
              >
                <Plus size={16} />
                New Event
              </button>
              <button
                type="button"
                onClick={() => void calendar.refresh()}
                className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
              >
                <RefreshCcw size={15} />
                Refresh
              </button>
              <button
                type="button"
                onClick={calendar.disconnect}
                className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
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
              className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent-strong)' }}
            >
              {calendar.isConnecting ? 'Connecting...' : 'Connect Google Calendar'}
            </button>
          )}
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
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <section className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
            <div className="flex items-center gap-2">
              <CalendarDays size={18} className="text-[var(--accent)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Connected Calendar</h2>
            </div>
            <div className="mt-6 rounded-xl border border-dashed border-[var(--border-soft)] p-4 text-sm text-[var(--text-muted)]">
              Connect your Google account to view and create events here.
            </div>
          </section>
          <section className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
            <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-[var(--border-soft)] text-sm text-[var(--text-muted)]">
              Connect Google Calendar to populate this view.
            </div>
          </section>
        </div>
      ) : viewMode === 'month' ? (
        /* ── Month View ── */
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <CalendarGrid
            year={year}
            month={month}
            events={calendar.events}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
            onToday={handleToday}
            onCreateEvent={handleCreateFromDate}
          />

          <div className="space-y-4">
            {/* Calendar picker */}
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
              <div className="flex items-center gap-2 mb-3">
                <CalendarDays size={18} className="text-[var(--accent)]" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Calendar</h2>
              </div>
              <select
                value={calendar.selectedCalendarId}
                onChange={event => void calendar.chooseCalendar(event.target.value)}
                className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              >
                {calendar.calendars.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.summary}
                    {item.primary ? ' (Primary)' : ''}
                  </option>
                ))}
              </select>
              {calendar.isLoading && <p className="mt-2 text-xs text-[var(--text-faint)]">Loading...</p>}
            </div>

            {/* Day detail panel */}
            <DayPanel
              dateStr={selectedDate}
              events={selectedDayEvents}
              onDelete={id => void handleDelete(id)}
              deletingId={deletingId}
              onCreateEvent={() => handleCreateFromDate(selectedDate)}
            />
          </div>
        </div>
      ) : (
        /* ── List View ── */
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <section className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays size={18} className="text-[var(--accent)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Calendar</h2>
            </div>
            <select
              value={calendar.selectedCalendarId}
              onChange={event => void calendar.chooseCalendar(event.target.value)}
              className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            >
              {calendar.calendars.map(item => (
                <option key={item.id} value={item.id}>
                  {item.summary}
                  {item.primary ? ' (Primary)' : ''}
                </option>
              ))}
            </select>
            {calendar.isLoading && <p className="mt-2 text-xs text-[var(--text-faint)]">Loading...</p>}
          </section>

          <section className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
            <div className="flex items-center justify-between gap-3 mb-6">
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
                          className="group rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4"
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
                                className="rounded-full border border-[var(--border-soft)] p-2 text-[var(--text-faint)] opacity-0 transition group-hover:opacity-100 hover:border-red-500/30 hover:text-red-400 disabled:opacity-50"
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
          onSave={calendar.createEvent}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
