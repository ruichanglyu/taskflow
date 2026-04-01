import type { GoogleCalendarEvent } from '../lib/googleCalendar';
import { parseAcademicPlanMetadata } from '../lib/academicPlanning';

function normalizeHexColor(color: string) {
  if (!color.startsWith('#')) return color;
  if (color.length === 4) {
    const [hash, r, g, b] = color;
    return `${hash}${r}${r}${g}${g}${b}${b}`;
  }
  return color;
}

function withAlpha(color: string, alphaHex: string) {
  const normalized = normalizeHexColor(color);
  return normalized.startsWith('#') && normalized.length === 7
    ? `${normalized}${alphaHex}`
    : normalized;
}

export function getCalendarEventPresentation(event: GoogleCalendarEvent) {
  const metadata = parseAcademicPlanMetadata(event.description);
  const accentColor = event.calendarColor || '#818cf8';
  const isSuggested = metadata?.origin === 'planner';
  const isLinked = Boolean(metadata);
  const description = metadata
    ? metadata.notes || metadata.explanation || null
    : event.description?.trim() || null;

  return {
    metadata,
    accentColor,
    isLinked,
    isSuggested,
    badgeLabel: isSuggested ? 'AI suggested' : null,
    description,
    surfaceColor: isSuggested ? withAlpha(accentColor, '36') : withAlpha(accentColor, '20'),
    mutedSurfaceColor: isSuggested ? withAlpha(accentColor, '24') : 'transparent',
    borderColor: isSuggested ? withAlpha(accentColor, '88') : accentColor,
  };
}
