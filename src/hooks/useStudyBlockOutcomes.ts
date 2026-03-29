import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GoogleCalendarEvent } from '../lib/googleCalendar';
import { supabase } from '../lib/supabase';
import type { StudyBlockOutcomeStatus } from '../types';

export interface StudyBlockOutcome {
  id: string;
  eventId: string;
  calendarId: string | null;
  title: string;
  dateKey: string;
  status: StudyBlockOutcomeStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface StudyBlockOutcomeRow {
  id: string;
  user_id: string;
  event_id: string;
  calendar_id: string | null;
  title: string;
  date_key: string;
  status: StudyBlockOutcomeStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const STORAGE_PREFIX = 'taskflow_study_block_outcomes';

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`;
}

function eventDateKey(event: GoogleCalendarEvent) {
  if (event.start?.date) return event.start.date;
  if (event.start?.dateTime) return event.start.dateTime.slice(0, 10);
  return null;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildOutcomeMatchKey(params: {
  dateKey: string;
  title: string;
  calendarId?: string | null;
}) {
  return `${params.dateKey}::${normalizeText(params.title)}::${params.calendarId ?? ''}`;
}

function buildOutcomeMatchKeyFromEvent(event: GoogleCalendarEvent) {
  const dateKey = eventDateKey(event);
  if (!event.id || !dateKey || !event.summary) return null;
  return buildOutcomeMatchKey({
    dateKey,
    title: event.summary,
    calendarId: event.calendarId ?? null,
  });
}

function buildOutcomeMatchKeyFromOutcome(outcome: StudyBlockOutcome) {
  return buildOutcomeMatchKey({
    dateKey: outcome.dateKey,
    title: outcome.title,
    calendarId: outcome.calendarId,
  });
}

function isMissingTableError(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === '42P01',
  );
}

function mapRow(row: StudyBlockOutcomeRow): StudyBlockOutcome {
  return {
    id: row.id,
    eventId: row.event_id,
    calendarId: row.calendar_id,
    title: row.title,
    dateKey: row.date_key,
    status: row.status,
    notes: row.notes ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loadFromStorage(userId: string): StudyBlockOutcome[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(userId: string, rows: StudyBlockOutcome[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(storageKey(userId), JSON.stringify(rows.slice(-500)));
}

export function useStudyBlockOutcomes(userId: string) {
  const [outcomes, setOutcomes] = useState<StudyBlockOutcome[]>(() => loadFromStorage(userId));
  const [isLoading, setIsLoading] = useState(true);
  const [remoteAvailable, setRemoteAvailable] = useState(Boolean(supabase));

  useEffect(() => {
    const local = loadFromStorage(userId);
    setOutcomes(local);
    setIsLoading(true);

    if (!supabase) {
      setRemoteAvailable(false);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      const { data, error } = await supabase
        .from('study_block_outcomes')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (cancelled) return;

      if (error) {
        if (isMissingTableError(error)) {
          setRemoteAvailable(false);
        } else {
          console.warn('Failed to load study block outcomes from Supabase:', error);
        }
        setIsLoading(false);
        return;
      }

      const remote = (data ?? []).map(mapRow);
      setRemoteAvailable(true);
      setOutcomes(remote);
      saveToStorage(userId, remote);
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const outcomesByEventId = useMemo(
    () =>
      outcomes.reduce<Record<string, StudyBlockOutcome>>((acc, outcome) => {
        acc[outcome.eventId] = outcome;
        return acc;
      }, {}),
    [outcomes],
  );

  const outcomesByMatchKey = useMemo(
    () =>
      outcomes.reduce<Record<string, StudyBlockOutcome>>((acc, outcome) => {
        acc[buildOutcomeMatchKeyFromOutcome(outcome)] = outcome;
        return acc;
      }, {}),
    [outcomes],
  );

  const getOutcomeForEvent = useCallback((event: GoogleCalendarEvent) => {
    if (!event.id) return undefined;
    const direct = outcomesByEventId[event.id];
    if (direct) return direct;
    const matchKey = buildOutcomeMatchKeyFromEvent(event);
    return matchKey ? outcomesByMatchKey[matchKey] : undefined;
  }, [outcomesByEventId, outcomesByMatchKey]);

  const setOutcome = useCallback(async (
    event: GoogleCalendarEvent,
    status: StudyBlockOutcomeStatus,
    notes = '',
  ): Promise<boolean> => {
    if (!event.id) return false;
    const dateKey = eventDateKey(event);
    if (!dateKey) return false;

    const previousOutcomes = outcomes;
    const existing = getOutcomeForEvent(event);
    const now = new Date().toISOString();
    const next: StudyBlockOutcome = {
      id: existing?.id ?? crypto.randomUUID(),
      eventId: event.id,
      calendarId: event.calendarId ?? null,
      title: event.summary ?? 'Untitled event',
      dateKey,
      status,
      notes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const merged = [next, ...outcomes.filter(item => item.eventId !== event.id)].sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    );
    setOutcomes(merged);
    saveToStorage(userId, merged);

    if (!supabase || !remoteAvailable) {
      return true;
    }

    const { error } = await supabase.from('study_block_outcomes').upsert(
      {
        user_id: userId,
        event_id: next.eventId,
        calendar_id: next.calendarId,
        title: next.title,
        date_key: next.dateKey,
        status: next.status,
        notes: next.notes || null,
        created_at: next.createdAt,
        updated_at: next.updatedAt,
      },
      { onConflict: 'user_id,event_id' },
    );

    if (error) {
      if (isMissingTableError(error)) {
        setRemoteAvailable(false);
        return true;
      }
      setOutcomes(previousOutcomes);
      saveToStorage(userId, previousOutcomes);
      console.warn('Failed to save study block outcome to Supabase:', error);
      return false;
    }

    return true;
  }, [getOutcomeForEvent, outcomes, remoteAvailable, userId]);

  return {
    outcomes,
    outcomesByEventId,
    outcomesByMatchKey,
    getOutcomeForEvent,
    isLoading,
    setOutcome,
  };
}
