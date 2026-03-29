import type { GoogleCalendarEvent } from '../lib/googleCalendar';

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function hasAny(text: string, phrases: string[]) {
  return phrases.some(phrase => text.includes(phrase));
}

const POSITIVE_KEYWORDS = [
  'study',
  'review',
  'prep',
  'practice',
  'post class review',
  'study session',
];

const NEGATIVE_KEYWORDS = [
  'class time',
  'class times',
  'lecture',
  'recitation',
  'lab',
  'office hour',
  'meeting',
  'workout',
  'gym',
];

export function normalizeCalendarSummary(value: string) {
  return normalize(value).replace(/\s*\((primary|read-only|read only|owner)\)\s*$/i, '').trim();
}

export function isStudyBlockLikeEvent(params: {
  title?: string | null;
  calendarSummary?: string | null;
  description?: string | null;
}) {
  const title = normalize(params.title ?? '');
  const calendarSummary = normalizeCalendarSummary(params.calendarSummary ?? '');
  const description = normalize(params.description ?? '');

  const titlePositive = hasAny(title, POSITIVE_KEYWORDS);
  const calendarPositive = hasAny(calendarSummary, POSITIVE_KEYWORDS);
  const descriptionPositive = hasAny(description, POSITIVE_KEYWORDS);
  const titleNegative = hasAny(title, NEGATIVE_KEYWORDS);

  if (titlePositive) return true;
  if (titleNegative) return false;
  if (descriptionPositive) return true;
  if (calendarPositive) return true;

  return false;
}

export function isStudyBlockLikeCalendarEvent(event: GoogleCalendarEvent) {
  return isStudyBlockLikeEvent({
    title: event.summary,
    calendarSummary: event.calendarSummary,
    description: event.description,
  });
}
