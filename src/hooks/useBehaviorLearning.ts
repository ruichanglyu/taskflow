import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GoogleCalendarEvent, NewGoogleCalendarEvent } from '../lib/googleCalendar';

type LearningSource = 'manual' | 'ai';
type LearningAction = 'create' | 'reschedule' | 'delete';

interface BehaviorLearningEvent {
  id: string;
  source: LearningSource;
  action: LearningAction;
  title: string;
  calendarId: string | null;
  calendarSummary: string | null;
  dateKey: string;
  weekday: number;
  startMinutes: number;
  durationMinutes: number;
  previousDateKey: string | null;
  previousWeekday: number | null;
  previousStartMinutes: number | null;
  previousDurationMinutes: number | null;
  createdAt: string;
}

interface TimedBehaviorSnapshot {
  title: string;
  calendarId: string | null;
  calendarSummary: string | null;
  dateKey: string;
  weekday: number;
  startMinutes: number;
  durationMinutes: number;
}

const STORAGE_PREFIX = 'taskflow_behavior_learning_events';
const AI_TESTING_PREFIX = 'taskflow_behavior_learning_ai_testing';
const BEHAVIOR_EVENT_NAME = 'taskflow-behavior-learning-updated';

function eventsStorageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`;
}

function aiTestingStorageKey(userId: string) {
  return `${AI_TESTING_PREFIX}:${userId}`;
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function normalizeCalendarSummary(value: string) {
  return normalizeText(value).replace(/\s*\((primary|read-only|read only|owner)\)\s*$/i, '').trim();
}

function isStudyBlockLike(title: string, calendarSummary?: string | null) {
  const normalizedTitle = normalizeText(title);
  const normalizedCalendar = normalizeCalendarSummary(calendarSummary ?? '');
  return (
    normalizedTitle.includes('study block') ||
    normalizedCalendar.includes('study blocks') ||
    normalizedCalendar.includes('exam prep')
  );
}

function parseTimedPayload(payload: NewGoogleCalendarEvent, calendarId?: string | null, calendarSummary?: string | null): TimedBehaviorSnapshot | null {
  if (!('dateTime' in payload.start) || !('dateTime' in payload.end)) return null;

  const start = new Date(payload.start.dateTime);
  const end = new Date(payload.end.dateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const durationMinutes = endMinutes - startMinutes;
  if (durationMinutes <= 0) return null;

  return {
    title: payload.summary,
    calendarId: calendarId ?? null,
    calendarSummary: calendarSummary ?? null,
    dateKey: formatDateKey(start),
    weekday: start.getDay(),
    startMinutes,
    durationMinutes,
  };
}

function parseTimedCalendarEvent(event: GoogleCalendarEvent): TimedBehaviorSnapshot | null {
  if (!event.start?.dateTime || !event.end?.dateTime) return null;

  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const durationMinutes = endMinutes - startMinutes;
  if (durationMinutes <= 0) return null;

  return {
    title: event.summary || 'Untitled event',
    calendarId: event.calendarId ?? null,
    calendarSummary: event.calendarSummary ?? null,
    dateKey: formatDateKey(start),
    weekday: start.getDay(),
    startMinutes,
    durationMinutes,
  };
}

function bucketMinutes(value: number) {
  const bucket = Math.round(value / 15) * 15;
  return Math.max(0, Math.min(bucket, 23 * 60 + 45));
}

function loadEventsFromStorage(userId: string): BehaviorLearningEvent[] {
  if (typeof window === 'undefined') return [];

  try {
    const saved = localStorage.getItem(eventsStorageKey(userId));
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEventsToStorage(userId: string, events: BehaviorLearningEvent[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(eventsStorageKey(userId), JSON.stringify(events.slice(-250)));
}

function loadAiTestingMode(userId: string) {
  if (typeof window === 'undefined') return true;
  try {
    const saved = localStorage.getItem(aiTestingStorageKey(userId));
    return saved === null ? true : saved === 'true';
  } catch {
    return true;
  }
}

function saveAiTestingMode(userId: string, value: boolean) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(aiTestingStorageKey(userId), String(value));
}

function broadcastBehaviorUpdate(userId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BEHAVIOR_EVENT_NAME, { detail: { userId } }));
}

function buildScoreMaps(events: BehaviorLearningEvent[]) {
  const weekdayScores = Array.from({ length: 7 }, () => new Map<number, number>());
  const overallScores = new Map<number, number>();

  const addScore = (weekday: number, minute: number, score: number) => {
    const bucket = bucketMinutes(minute);
    weekdayScores[weekday].set(bucket, (weekdayScores[weekday].get(bucket) ?? 0) + score);
    overallScores.set(bucket, (overallScores.get(bucket) ?? 0) + score);
  };

  for (const event of events) {
    const isAi = event.source === 'ai';
    if (event.action === 'create') {
      addScore(event.weekday, event.startMinutes, isAi ? 1 : 2);
      continue;
    }

    if (event.action === 'delete') {
      addScore(event.weekday, event.startMinutes, -3);
      continue;
    }

    if (event.action === 'reschedule') {
      addScore(event.weekday, event.startMinutes, isAi ? 1 : 2);
      if (event.previousWeekday !== null && event.previousStartMinutes !== null) {
        addScore(event.previousWeekday, event.previousStartMinutes, -2);
      }
    }
  }

  return { weekdayScores, overallScores };
}

function choosePreferredStartMinute(
  events: BehaviorLearningEvent[],
  dateKey: string,
  fallbackStartMinutes: number,
) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return fallbackStartMinutes;

  const { weekdayScores, overallScores } = buildScoreMaps(events);
  const weekday = date.getDay();
  const weekdayBuckets = weekdayScores[weekday];
  const fallbackBucket = bucketMinutes(fallbackStartMinutes);

  const candidateMinutes = new Set<number>([
    ...weekdayBuckets.keys(),
    ...overallScores.keys(),
    fallbackBucket,
  ]);

  let bestMinute = fallbackBucket;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const minute of candidateMinutes) {
    const weekdayScore = weekdayBuckets.get(minute) ?? 0;
    const overallScore = overallScores.get(minute) ?? 0;
    const distancePenalty = Math.abs(minute - fallbackBucket) / 120;
    const score = weekdayScore * 1.6 + overallScore * 0.5 - distancePenalty;
    if (score > bestScore) {
      bestScore = score;
      bestMinute = minute;
    }
  }

  const fallbackScore =
    (weekdayBuckets.get(fallbackBucket) ?? 0) * 1.6 +
    (overallScores.get(fallbackBucket) ?? 0) * 0.5;

  if (bestScore < 2 || bestScore < fallbackScore + 0.75) {
    return fallbackStartMinutes;
  }

  return bestMinute;
}

function appendBehaviorEvent(
  previous: BehaviorLearningEvent[],
  nextEvent: BehaviorLearningEvent,
) {
  const next = [...previous, nextEvent].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return next.slice(-250);
}

export function useBehaviorLearning(userId: string) {
  const [events, setEvents] = useState<BehaviorLearningEvent[]>(() => loadEventsFromStorage(userId));
  const [aiTestingMode, setAiTestingModeState] = useState<boolean>(() => loadAiTestingMode(userId));

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (!detail?.userId || detail.userId !== userId) return;
      setEvents(loadEventsFromStorage(userId));
      setAiTestingModeState(loadAiTestingMode(userId));
    };

    window.addEventListener(BEHAVIOR_EVENT_NAME, handleUpdate as EventListener);
    return () => window.removeEventListener(BEHAVIOR_EVENT_NAME, handleUpdate as EventListener);
  }, [userId]);

  const persistEvent = useCallback((event: BehaviorLearningEvent) => {
    setEvents(previous => {
      const next = appendBehaviorEvent(previous, event);
      saveEventsToStorage(userId, next);
      return next;
    });
    broadcastBehaviorUpdate(userId);
  }, [userId]);

  const setAiTestingMode = useCallback((value: boolean) => {
    setAiTestingModeState(value);
    saveAiTestingMode(userId, value);
    broadcastBehaviorUpdate(userId);
  }, [userId]);

  const recordCalendarCreate = useCallback((
    payload: NewGoogleCalendarEvent,
    options: { source: LearningSource; calendarId?: string | null; calendarSummary?: string | null },
  ) => {
    const snapshot = parseTimedPayload(payload, options.calendarId, options.calendarSummary);
    if (!snapshot || !isStudyBlockLike(snapshot.title, snapshot.calendarSummary)) return;

    persistEvent({
      id: crypto.randomUUID(),
      source: options.source,
      action: 'create',
      title: snapshot.title,
      calendarId: snapshot.calendarId,
      calendarSummary: snapshot.calendarSummary,
      dateKey: snapshot.dateKey,
      weekday: snapshot.weekday,
      startMinutes: snapshot.startMinutes,
      durationMinutes: snapshot.durationMinutes,
      previousDateKey: null,
      previousWeekday: null,
      previousStartMinutes: null,
      previousDurationMinutes: null,
      createdAt: new Date().toISOString(),
    });
  }, [persistEvent]);

  const recordCalendarUpdate = useCallback((
    previousEvent: GoogleCalendarEvent,
    payload: NewGoogleCalendarEvent,
    options: { source: LearningSource; calendarId?: string | null; calendarSummary?: string | null },
  ) => {
    const previousSnapshot = parseTimedCalendarEvent(previousEvent);
    const nextSnapshot = parseTimedPayload(
      payload,
      options.calendarId ?? previousEvent.calendarId,
      options.calendarSummary ?? previousEvent.calendarSummary,
    );
    const title = nextSnapshot?.title ?? previousSnapshot?.title ?? previousEvent.summary ?? '';
    const calendarSummary = nextSnapshot?.calendarSummary ?? previousSnapshot?.calendarSummary;

    if (!isStudyBlockLike(title, calendarSummary)) return;
    if (!nextSnapshot) return;

    const changedTime =
      !previousSnapshot ||
      previousSnapshot.dateKey !== nextSnapshot.dateKey ||
      previousSnapshot.startMinutes !== nextSnapshot.startMinutes ||
      previousSnapshot.durationMinutes !== nextSnapshot.durationMinutes;

    if (!changedTime) return;

    persistEvent({
      id: crypto.randomUUID(),
      source: options.source,
      action: 'reschedule',
      title: nextSnapshot.title,
      calendarId: nextSnapshot.calendarId,
      calendarSummary: nextSnapshot.calendarSummary,
      dateKey: nextSnapshot.dateKey,
      weekday: nextSnapshot.weekday,
      startMinutes: nextSnapshot.startMinutes,
      durationMinutes: nextSnapshot.durationMinutes,
      previousDateKey: previousSnapshot?.dateKey ?? null,
      previousWeekday: previousSnapshot?.weekday ?? null,
      previousStartMinutes: previousSnapshot?.startMinutes ?? null,
      previousDurationMinutes: previousSnapshot?.durationMinutes ?? null,
      createdAt: new Date().toISOString(),
    });
  }, [persistEvent]);

  const recordCalendarDelete = useCallback((event: GoogleCalendarEvent, options: { source: LearningSource }) => {
    const snapshot = parseTimedCalendarEvent(event);
    if (!snapshot || !isStudyBlockLike(snapshot.title, snapshot.calendarSummary)) return;

    persistEvent({
      id: crypto.randomUUID(),
      source: options.source,
      action: 'delete',
      title: snapshot.title,
      calendarId: snapshot.calendarId,
      calendarSummary: snapshot.calendarSummary,
      dateKey: snapshot.dateKey,
      weekday: snapshot.weekday,
      startMinutes: snapshot.startMinutes,
      durationMinutes: snapshot.durationMinutes,
      previousDateKey: snapshot.dateKey,
      previousWeekday: snapshot.weekday,
      previousStartMinutes: snapshot.startMinutes,
      previousDurationMinutes: snapshot.durationMinutes,
      createdAt: new Date().toISOString(),
    });
  }, [persistEvent]);

  const getPreferredStudyStartMinutes = useCallback((dateKey: string, fallbackStartMinutes: number) => {
    return choosePreferredStartMinute(events, dateKey, fallbackStartMinutes);
  }, [events]);

  const preferenceSummary = useMemo(() => {
    const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const { weekdayScores } = buildScoreMaps(events);
    return weekdayNames.map((name, weekday) => {
      const buckets = Array.from(weekdayScores[weekday].entries()).sort((a, b) => b[1] - a[1]);
      return {
        weekday,
        name,
        preferredStartMinutes: buckets[0]?.[1] >= 2 ? buckets[0]?.[0] ?? null : null,
      };
    });
  }, [events]);

  return {
    aiTestingMode,
    setAiTestingMode,
    behaviorEvents: events,
    getPreferredStudyStartMinutes,
    preferenceSummary,
    recordCalendarCreate,
    recordCalendarUpdate,
    recordCalendarDelete,
  };
}
