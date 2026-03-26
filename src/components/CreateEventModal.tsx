import { useState } from 'react';
import { X } from 'lucide-react';
import { GoogleCalendarListItem, NewGoogleCalendarEvent } from '../lib/googleCalendar';

interface CreateEventModalProps {
  initialDate?: string;
  initialStartTime?: string;
  initialEndTime?: string;
  calendars?: GoogleCalendarListItem[];
  initialCalendarId?: string;
  compact?: boolean;
  anchorRect?: { top: number; left: number; width: number; height: number } | null;
  onSave: (event: NewGoogleCalendarEvent, calendarId?: string) => Promise<boolean>;
  onClose: () => void;
}

export function CreateEventModal({
  initialDate,
  initialStartTime,
  initialEndTime,
  calendars = [],
  initialCalendarId,
  compact = false,
  anchorRect,
  onSave,
  onClose,
}: CreateEventModalProps) {
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState(initialDate ?? '');
  const [startTime, setStartTime] = useState(initialStartTime ?? '09:00');
  const [endDate, setEndDate] = useState(initialDate ?? '');
  const [endTime, setEndTime] = useState(initialEndTime ?? '10:00');
  const [calendarId, setCalendarId] = useState(initialCalendarId ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim() || !startDate || isSaving) return;

    setIsSaving(true);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const event: NewGoogleCalendarEvent = {
        summary: summary.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        start: allDay
          ? { date: startDate }
          : { dateTime: `${startDate}T${startTime}:00`, timeZone },
        end: allDay
          ? { date: endDate || startDate }
          : { dateTime: `${endDate || startDate}T${endTime}:00`, timeZone },
      };

      const ok = await onSave(event, calendarId || undefined);
      if (ok) onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const compactTop = anchorRect ? Math.max(16, Math.min(anchorRect.top - 12, window.innerHeight - 520)) : 96;
  const compactLeft = anchorRect
    ? Math.max(16, Math.min(anchorRect.left + anchorRect.width + 12, window.innerWidth - 420))
    : Math.max(16, window.innerWidth - 420);

  return (
    <div
      className={compact ? 'fixed inset-0 z-50' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4'}
      onClick={onClose}
    >
      <div
        className={compact ? 'absolute w-full max-w-[380px] rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl' : 'w-full max-w-md rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl'}
        style={compact ? { top: `${compactTop}px`, left: `${compactLeft}px` } : undefined}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{compact ? 'Quick event' : 'New Event'}</h2>
          <button onClick={onClose} className="text-[var(--text-faint)] transition-colors hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className={compact ? 'space-y-4 p-4' : 'space-y-4 p-5'}>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Title *</label>
            <input
              type="text"
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="Event name"
              autoFocus
              className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>

          {!compact && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Description</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Add details..."
                  rows={2}
                  className="w-full resize-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Location</label>
                <input
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  placeholder="Add a location"
                  className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
            </>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={allDay}
              onChange={e => setAllDay(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--border-soft)] accent-[var(--accent)]"
            />
            <span className="text-sm text-[var(--text-secondary)]">All day</span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Start date *</label>
              <input
                type="date"
                value={startDate}
                onChange={e => { setStartDate(e.target.value); if (!endDate) setEndDate(e.target.value); }}
                className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            {!allDay && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Start time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">End date</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            {!allDay && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">End time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
            )}
          </div>

          {calendars.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Calendar</label>
              <select
                value={calendarId}
                onChange={e => setCalendarId(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              >
                <option value="">Active calendar</option>
                {calendars.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.summary}
                    {item.primary ? ' (Primary)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-[var(--border-soft)] py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!summary.trim() || !startDate || isSaving}
              className="flex-1 rounded-lg py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent-strong)' }}
            >
              {isSaving ? 'Creating...' : 'Create Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
