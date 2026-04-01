/**
 * Shared calendar-event helpers used by Dashboard, CalendarView, CalendarGrid, and AIPanel.
 */
import type { GoogleCalendarEvent } from '../lib/googleCalendar';

export function getEventDateKey(event: GoogleCalendarEvent): string | null {
  if (event.start?.date) return event.start.date;
  if (event.start?.dateTime) return event.start.dateTime.slice(0, 10);
  return null;
}

export function hasEventEnded(event: GoogleCalendarEvent, now = new Date()) {
  if (event.end?.dateTime) {
    return new Date(event.end.dateTime).getTime() <= now.getTime();
  }
  if (event.end?.date) {
    return new Date(`${event.end.date}T00:00:00`).getTime() <= now.getTime();
  }
  const dateKey = getEventDateKey(event);
  if (!dateKey) return false;
  return new Date(`${dateKey}T23:59:59`).getTime() <= now.getTime();
}

export function getEventTimeLabel(date?: { date?: string; dateTime?: string }) {
  if (date?.date) return 'All day';
  if (date?.dateTime) {
    return new Date(date.dateTime).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return '';
}
