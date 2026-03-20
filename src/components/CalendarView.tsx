import { useState } from 'react';
import { CalendarDays, ExternalLink, Plus, RefreshCcw, Trash2, Unplug } from 'lucide-react';
import { useGoogleCalendar } from '../hooks/useGoogleCalendar';
import { CreateEventModal } from './CreateEventModal';

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

interface CalendarViewProps {
  userId: string;
}

export function CalendarView({ userId }: CalendarViewProps) {
  const calendar = useGoogleCalendar(userId);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const groupedEvents = calendar.events.reduce<Record<string, typeof calendar.events>>((groups, event) => {
    const key = getEventSectionLabel(event.start);
    groups[key] = groups[key] ?? [];
    groups[key].push(event);
    return groups;
  }, {});

  const handleDelete = async (eventId: string) => {
    setDeletingId(eventId);
    await calendar.deleteEvent(eventId);
    setDeletingId(null);
  };

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
          {calendar.isConnected ? (
            <>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
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

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2">
            <CalendarDays size={18} className="text-[var(--accent)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Connected Calendar</h2>
          </div>

          {!calendar.isConnected ? (
            <div className="mt-6 rounded-xl border border-dashed border-[var(--border-soft)] p-4 text-sm text-[var(--text-muted)]">
              Connect your Google account to view and create events here.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Calendar
                </span>
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
              </label>

              <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Mode</p>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  Read &amp; write — you can view events, create new ones, and delete existing ones from TaskFlow.
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Upcoming Events</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Showing your next 50 events from the selected Google Calendar.</p>
            </div>
            {calendar.isLoading && <span className="text-xs text-[var(--text-muted)]">Loading...</span>}
          </div>

          {!calendar.isConnected ? (
            <div className="mt-6 flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-[var(--border-soft)] text-sm text-[var(--text-muted)]">
              Connect Google Calendar to populate this view.
            </div>
          ) : calendar.events.length === 0 && !calendar.isLoading ? (
            <div className="mt-6 flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border-soft)] text-sm text-[var(--text-muted)]">
              <p>No upcoming events found for this calendar.</p>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)]"
              >
                <Plus size={14} /> Create your first event
              </button>
            </div>
          ) : (
            <div className="mt-6 space-y-6">
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

      {showCreateModal && (
        <CreateEventModal
          onSave={calendar.createEvent}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
