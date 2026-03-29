import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GoogleCalendarEvent, NewGoogleCalendarEvent } from '../lib/googleCalendar';
import { supabase } from '../lib/supabase';
import type { StudyBlockOutcomeStatus } from '../types';
import { isStudyBlockLikeEvent } from '../utils/studyBlockDetection';

type LearningSource = 'manual' | 'ai';
type LearningAction = 'create' | 'reschedule' | 'delete';
type TaskStatusLike = 'todo' | 'in-progress' | 'done' | 'not-started' | 'missed';
type AppBehaviorEntity = 'task' | 'deadline' | 'project' | 'habit' | 'deadline-link' | 'calendar';
export type BehaviorLearningSeedPreset = 'early-bird' | 'normal-grinder' | 'night-owl';

export interface BehaviorLearningActionOptions {
  source?: LearningSource;
  learn?: boolean;
}

interface AppBehaviorEvent {
  id: string;
  source: LearningSource;
  entity: AppBehaviorEntity;
  action: string;
  title: string;
  detail: string | null;
  countsForLearning: boolean;
  createdAt: string;
}

interface ParsedStudyBlockOutcomeDetail {
  dateKey: string;
  startMinutes: number;
  durationMinutes: number;
  weekday: number;
}

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
  countsForLearning: boolean;
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

interface BehaviorLearningSettingsRow {
  user_id: string;
  ai_testing_mode: boolean;
  created_at: string;
  updated_at: string;
}

interface BehaviorLearningScheduleEventRow {
  id: string;
  user_id: string;
  source: LearningSource;
  action: LearningAction;
  title: string;
  calendar_id: string | null;
  calendar_summary: string | null;
  date_key: string;
  weekday: number;
  start_minutes: number;
  duration_minutes: number;
  previous_date_key: string | null;
  previous_weekday: number | null;
  previous_start_minutes: number | null;
  previous_duration_minutes: number | null;
  counts_for_learning: boolean;
  created_at: string;
}

interface BehaviorLearningAppEventRow {
  id: string;
  user_id: string;
  source: LearningSource;
  entity: AppBehaviorEntity;
  action: string;
  title: string;
  detail: string | null;
  counts_for_learning: boolean;
  created_at: string;
}

const STORAGE_PREFIX = 'taskflow_behavior_learning_events';
const APP_STORAGE_PREFIX = 'taskflow_behavior_learning_app_events';
const AI_TESTING_PREFIX = 'taskflow_behavior_learning_ai_testing';
const MIGRATED_PREFIX = 'taskflow_behavior_learning_migrated';
const BEHAVIOR_EVENT_NAME = 'taskflow-behavior-learning-updated';

function eventsStorageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`;
}

function aiTestingStorageKey(userId: string) {
  return `${AI_TESTING_PREFIX}:${userId}`;
}

function appEventsStorageKey(userId: string) {
  return `${APP_STORAGE_PREFIX}:${userId}`;
}

function migratedStorageKey(userId: string) {
  return `${MIGRATED_PREFIX}:${userId}`;
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getDetailToken(detail: string | null | undefined, prefix: string) {
  if (!detail) return null;
  const token = detail
    .split('·')
    .map(part => part.trim())
    .find(part => part.toLowerCase().startsWith(`${prefix.toLowerCase()}:`));
  if (!token) return null;
  return token.slice(prefix.length + 1).trim();
}

function parseStudyBlockOutcomeDetail(detail: string | null | undefined): ParsedStudyBlockOutcomeDetail | null {
  const dateKey = getDetailToken(detail, 'date');
  const startRaw = getDetailToken(detail, 'start');
  const durationRaw = getDetailToken(detail, 'duration');
  if (!dateKey || !startRaw || !durationRaw) return null;

  const startMinutes = Number(startRaw);
  const durationMinutes = Number(durationRaw);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(durationMinutes)) return null;

  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  return {
    dateKey,
    startMinutes,
    durationMinutes,
    weekday: date.getDay(),
  };
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
    return Array.isArray(parsed)
      ? parsed.map((event) => ({
          ...event,
          countsForLearning: event?.countsForLearning ?? true,
        }))
      : [];
  } catch {
    return [];
  }
}

function saveEventsToStorage(userId: string, events: BehaviorLearningEvent[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(eventsStorageKey(userId), JSON.stringify(events.slice(-250)));
}

function loadAppEventsFromStorage(userId: string): AppBehaviorEvent[] {
  if (typeof window === 'undefined') return [];

  try {
    const saved = localStorage.getItem(appEventsStorageKey(userId));
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed)
      ? parsed.map((event) => ({
          ...event,
          countsForLearning: event?.countsForLearning ?? true,
        }))
      : [];
  } catch {
    return [];
  }
}

function saveAppEventsToStorage(userId: string, events: AppBehaviorEvent[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(appEventsStorageKey(userId), JSON.stringify(events.slice(-500)));
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

function loadHasMigrated(userId: string) {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(migratedStorageKey(userId)) === 'true';
  } catch {
    return false;
  }
}

function saveHasMigrated(userId: string, value: boolean) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(migratedStorageKey(userId), String(value));
}

function clearBehaviorStorage(userId: string) {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(eventsStorageKey(userId));
  localStorage.removeItem(appEventsStorageKey(userId));
}

function broadcastBehaviorUpdate(userId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BEHAVIOR_EVENT_NAME, { detail: { userId } }));
}

function mapScheduleRowToEvent(row: BehaviorLearningScheduleEventRow): BehaviorLearningEvent {
  return {
    id: row.id,
    source: row.source,
    action: row.action,
    title: row.title,
    calendarId: row.calendar_id,
    calendarSummary: row.calendar_summary,
    dateKey: row.date_key,
    weekday: row.weekday,
    startMinutes: row.start_minutes,
    durationMinutes: row.duration_minutes,
    previousDateKey: row.previous_date_key,
    previousWeekday: row.previous_weekday,
    previousStartMinutes: row.previous_start_minutes,
    previousDurationMinutes: row.previous_duration_minutes,
    countsForLearning: row.counts_for_learning,
    createdAt: row.created_at,
  };
}

function mapEventToScheduleRow(userId: string, event: BehaviorLearningEvent): BehaviorLearningScheduleEventRow {
  return {
    id: event.id,
    user_id: userId,
    source: event.source,
    action: event.action,
    title: event.title,
    calendar_id: event.calendarId,
    calendar_summary: event.calendarSummary,
    date_key: event.dateKey,
    weekday: event.weekday,
    start_minutes: event.startMinutes,
    duration_minutes: event.durationMinutes,
    previous_date_key: event.previousDateKey,
    previous_weekday: event.previousWeekday,
    previous_start_minutes: event.previousStartMinutes,
    previous_duration_minutes: event.previousDurationMinutes,
    counts_for_learning: event.countsForLearning,
    created_at: event.createdAt,
  };
}

function mapAppRowToEvent(row: BehaviorLearningAppEventRow): AppBehaviorEvent {
  return {
    id: row.id,
    source: row.source,
    entity: row.entity,
    action: row.action,
    title: row.title,
    detail: row.detail,
    countsForLearning: row.counts_for_learning,
    createdAt: row.created_at,
  };
}

function mapAppEventToRow(userId: string, event: AppBehaviorEvent): BehaviorLearningAppEventRow {
  return {
    id: event.id,
    user_id: userId,
    source: event.source,
    entity: event.entity,
    action: event.action,
    title: event.title,
    detail: event.detail,
    counts_for_learning: event.countsForLearning,
    created_at: event.createdAt,
  };
}

async function upsertBehaviorSettings(userId: string, aiTestingMode: boolean) {
  if (!supabase) return;
  const { error } = await supabase.from('behavior_learning_settings').upsert(
    {
      user_id: userId,
      ai_testing_mode: aiTestingMode,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) {
    console.warn('[BehaviorLearning] Failed to upsert settings', error);
  }
}

function buildScoreMaps(events: BehaviorLearningEvent[], appEvents: AppBehaviorEvent[] = []) {
  const weekdayScores = Array.from({ length: 7 }, () => new Map<number, number>());
  const overallScores = new Map<number, number>();

  const addScore = (weekday: number, minute: number, score: number) => {
    const bucket = bucketMinutes(minute);
    weekdayScores[weekday].set(bucket, (weekdayScores[weekday].get(bucket) ?? 0) + score);
    overallScores.set(bucket, (overallScores.get(bucket) ?? 0) + score);
  };

  for (const event of events) {
    if (!event.countsForLearning) continue;
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

  for (const event of appEvents) {
    if (!event.countsForLearning || event.entity !== 'calendar') continue;
    if (!event.action.startsWith('study-block-')) continue;

    const parsed = parseStudyBlockOutcomeDetail(event.detail);
    if (!parsed) continue;

    if (event.action === 'study-block-complete') {
      addScore(parsed.weekday, parsed.startMinutes, 4);
      continue;
    }

    if (event.action === 'study-block-partial') {
      addScore(parsed.weekday, parsed.startMinutes, 1.5);
      continue;
    }

    if (event.action === 'study-block-skip') {
      addScore(parsed.weekday, parsed.startMinutes, -4);
      continue;
    }

    if (event.action === 'study-block-reschedule') {
      addScore(parsed.weekday, parsed.startMinutes, -2.5);
    }
  }

  return { weekdayScores, overallScores };
}

function choosePreferredStartMinute(
  events: BehaviorLearningEvent[],
  appEvents: AppBehaviorEvent[],
  dateKey: string,
  fallbackStartMinutes: number,
) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return fallbackStartMinutes;

  const { weekdayScores, overallScores } = buildScoreMaps(events, appEvents);
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

function scoreStudySlotFromEvents(
  events: BehaviorLearningEvent[],
  appEvents: AppBehaviorEvent[],
  dateKey: string,
  startMinutes: number,
  durationMinutes: number,
) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;

  const bucket = bucketMinutes(startMinutes);
  const durationBias = durationMinutes >= 90 ? 0.2 : 0;
  const { weekdayScores, overallScores } = buildScoreMaps(events, appEvents);
  const weekday = date.getDay();
  const weekdayScore = weekdayScores[weekday].get(bucket) ?? 0;
  const overallScore = overallScores.get(bucket) ?? 0;
  return weekdayScore * 1.6 + overallScore * 0.5 + durationBias;
}

function appendBehaviorEvent(
  previous: BehaviorLearningEvent[],
  nextEvent: BehaviorLearningEvent,
) {
  const next = [...previous, nextEvent].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return next.slice(-250);
}

function shouldLearn(options?: BehaviorLearningActionOptions) {
  return options?.learn !== false;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function createSeedEvent(
  createdAt: Date,
  dateKey: string,
  weekday: number,
  startMinutes: number,
  durationMinutes: number,
  title: string,
  action: LearningAction,
  previousStartMinutes?: number | null,
): BehaviorLearningEvent {
  return {
    id: crypto.randomUUID(),
    source: 'manual',
    action,
    title,
    calendarId: 'seeded-exam-prep',
    calendarSummary: 'Exam Prep',
    dateKey,
    weekday,
    startMinutes,
    durationMinutes,
    previousDateKey: action === 'reschedule' ? dateKey : action === 'delete' ? dateKey : null,
    previousWeekday: action === 'reschedule' ? weekday : action === 'delete' ? weekday : null,
    previousStartMinutes: action === 'reschedule' ? previousStartMinutes ?? null : action === 'delete' ? startMinutes : null,
    previousDurationMinutes: action === 'reschedule' ? durationMinutes : action === 'delete' ? durationMinutes : null,
    countsForLearning: true,
    createdAt: createdAt.toISOString(),
  };
}

function buildSeedEvents(preset: BehaviorLearningSeedPreset) {
  const titleMap: Record<BehaviorLearningSeedPreset, string> = {
    'early-bird': 'Seeded early bird study preference',
    'normal-grinder': 'Seeded normal grinder study preference',
    'night-owl': 'Seeded night owl study preference',
  };

  const profile = {
    'early-bird': {
      preferred: [480, 540, 630],
      avoided: [915, 1005, 1200],
      rescheduleTarget: 540,
    },
    'normal-grinder': {
      preferred: [1005, 1050, 1185, 1200],
      avoided: [495, 540, 825],
      rescheduleTarget: 1185,
    },
    'night-owl': {
      preferred: [1200, 1275, 1320],
      avoided: [540, 825, 960],
      rescheduleTarget: 1275,
    },
  }[preset];

  const events: BehaviorLearningEvent[] = [];
  const now = new Date();
  const durationMinutes = 90;
  const title = titleMap[preset];

  for (let week = 8; week >= 1; week -= 1) {
    const base = addDays(now, -week * 7);

    profile.preferred.forEach((minute, index) => {
      const date = addDays(base, [1, 3, 5, 6][index % 4]);
      const createdAt = new Date(date);
      createdAt.setHours(12, index * 3, 0, 0);
      events.push(
        createSeedEvent(createdAt, formatDateKey(date), date.getDay(), minute, durationMinutes, title, 'create'),
      );
    });

    profile.avoided.forEach((minute, index) => {
      const date = addDays(base, [2, 4, 0][index % 3]);
      const createdAt = new Date(date);
      createdAt.setHours(13, index * 5, 0, 0);
      events.push(
        createSeedEvent(createdAt, formatDateKey(date), date.getDay(), minute, durationMinutes, title, 'delete'),
      );
    });

    const rescheduleDate = addDays(base, 2);
    const rescheduleCreatedAt = new Date(rescheduleDate);
    rescheduleCreatedAt.setHours(14, 30, 0, 0);
    events.push(
      createSeedEvent(
        rescheduleCreatedAt,
        formatDateKey(rescheduleDate),
        rescheduleDate.getDay(),
        profile.rescheduleTarget,
        durationMinutes,
        title,
        'reschedule',
        825,
      ),
    );
  }

  return events.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function useBehaviorLearning(userId: string) {
  const [events, setEvents] = useState<BehaviorLearningEvent[]>(() => loadEventsFromStorage(userId));
  const [appEvents, setAppEvents] = useState<AppBehaviorEvent[]>(() => loadAppEventsFromStorage(userId));
  const [aiTestingMode, setAiTestingModeState] = useState<boolean>(() => loadAiTestingMode(userId));

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (!detail?.userId || detail.userId !== userId) return;
      setEvents(loadEventsFromStorage(userId));
      setAppEvents(loadAppEventsFromStorage(userId));
      setAiTestingModeState(loadAiTestingMode(userId));
    };

    window.addEventListener(BEHAVIOR_EVENT_NAME, handleUpdate as EventListener);
    return () => window.removeEventListener(BEHAVIOR_EVENT_NAME, handleUpdate as EventListener);
  }, [userId]);

  useEffect(() => {
    if (!userId || !supabase) return;

    let cancelled = false;

    async function hydrateFromSupabase() {
      const localEvents = loadEventsFromStorage(userId);
      const localAppEvents = loadAppEventsFromStorage(userId);
      const localTestingMode = loadAiTestingMode(userId);

      try {
        let [
          { data: settingsRow, error: settingsError },
          { data: scheduleRows, error: scheduleError },
          { data: appRows, error: appError },
        ] = await Promise.all([
          supabase
            .from('behavior_learning_settings')
            .select('user_id, ai_testing_mode, created_at, updated_at')
            .eq('user_id', userId)
            .maybeSingle(),
          supabase
            .from('behavior_learning_schedule_events')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(250)
            .returns<BehaviorLearningScheduleEventRow[]>(),
          supabase
            .from('behavior_learning_app_events')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(500)
            .returns<BehaviorLearningAppEventRow[]>(),
        ]);

        if (settingsError || scheduleError || appError) {
          if (cancelled) return;
          setEvents(localEvents);
          setAppEvents(localAppEvents);
          setAiTestingModeState(localTestingMode);
          return;
        }

        let migrated = false;

        if (!settingsRow) {
          await upsertBehaviorSettings(userId, localTestingMode);
          migrated = true;
        }

        const hasMigrated = loadHasMigrated(userId);
        const canMigrateLocal = !hasMigrated;

        if ((!scheduleRows || scheduleRows.length === 0) && localEvents.length > 0 && canMigrateLocal) {
          const rows = localEvents.map((event) => mapEventToScheduleRow(userId, event));
          const { error } = await supabase.from('behavior_learning_schedule_events').insert(rows);
          if (!error) migrated = true;
        }

        if ((!appRows || appRows.length === 0) && localAppEvents.length > 0 && canMigrateLocal) {
          const rows = localAppEvents.map((event) => mapAppEventToRow(userId, event));
          const { error } = await supabase.from('behavior_learning_app_events').insert(rows);
          if (!error) migrated = true;
        }

        if (migrated) {
          [
            { data: settingsRow, error: settingsError },
            { data: scheduleRows, error: scheduleError },
            { data: appRows, error: appError },
          ] = await Promise.all([
            supabase
              .from('behavior_learning_settings')
              .select('user_id, ai_testing_mode, created_at, updated_at')
              .eq('user_id', userId)
              .maybeSingle(),
            supabase
              .from('behavior_learning_schedule_events')
              .select('*')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(250)
              .returns<BehaviorLearningScheduleEventRow[]>(),
            supabase
              .from('behavior_learning_app_events')
              .select('*')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(500)
              .returns<BehaviorLearningAppEventRow[]>(),
          ]);

          if (settingsError || scheduleError || appError) {
            if (cancelled) return;
            setEvents(localEvents);
            setAppEvents(localAppEvents);
            setAiTestingModeState(localTestingMode);
            return;
          }
        }

        if (cancelled) return;

        const nextEvents = (scheduleRows ?? []).map(mapScheduleRowToEvent).reverse();
        const nextAppEvents = (appRows ?? []).map(mapAppRowToEvent).reverse();
        const nextTestingMode = settingsRow?.ai_testing_mode ?? localTestingMode;

        if (hasMigrated && nextEvents.length === 0 && nextAppEvents.length === 0) {
          clearBehaviorStorage(userId);
        }

        setEvents(nextEvents);
        setAppEvents(nextAppEvents);
        setAiTestingModeState(nextTestingMode);
        saveEventsToStorage(userId, nextEvents);
        saveAppEventsToStorage(userId, nextAppEvents);
        saveAiTestingMode(userId, nextTestingMode);
        saveHasMigrated(userId, true);
      } catch {
        if (cancelled) return;
        setEvents(localEvents);
        setAppEvents(localAppEvents);
        setAiTestingModeState(localTestingMode);
      }
    }

    void hydrateFromSupabase();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const persistEvent = useCallback((event: BehaviorLearningEvent) => {
    setEvents(previous => {
      const next = appendBehaviorEvent(previous, event);
      saveEventsToStorage(userId, next);
      return next;
    });
    if (supabase) {
      void (async () => {
        const { error } = await supabase
          .from('behavior_learning_schedule_events')
          .insert(mapEventToScheduleRow(userId, event));
        if (error) {
          console.warn('[BehaviorLearning] Failed to persist schedule event', error, event);
        }
      })();
    }
    broadcastBehaviorUpdate(userId);
  }, [userId]);

  const persistAppEvent = useCallback((event: AppBehaviorEvent) => {
    setAppEvents(previous => {
      const next = [...previous, event].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-500);
      saveAppEventsToStorage(userId, next);
      return next;
    });
    if (supabase) {
      void (async () => {
        const { error } = await supabase
          .from('behavior_learning_app_events')
          .insert(mapAppEventToRow(userId, event));
        if (error) {
          console.warn('[BehaviorLearning] Failed to persist app event', error, event);
        }
      })();
    }
    broadcastBehaviorUpdate(userId);
  }, [userId]);

  const setAiTestingMode = useCallback((value: boolean) => {
    setAiTestingModeState(value);
    saveAiTestingMode(userId, value);
    if (supabase) {
      void upsertBehaviorSettings(userId, value);
    }
    broadcastBehaviorUpdate(userId);
  }, [userId]);

  const clearBehaviorHistory = useCallback(() => {
    setEvents([]);
    setAppEvents([]);
    clearBehaviorStorage(userId);
    saveHasMigrated(userId, true);
    if (supabase) {
      void (async () => {
        const [{ error: scheduleError }, { error: appError }] = await Promise.all([
          supabase.from('behavior_learning_schedule_events').delete().eq('user_id', userId),
          supabase.from('behavior_learning_app_events').delete().eq('user_id', userId),
        ]);
        if (scheduleError) {
          console.warn('[BehaviorLearning] Failed to clear schedule history', scheduleError);
        }
        if (appError) {
          console.warn('[BehaviorLearning] Failed to clear app history', appError);
        }
      })();
    }
    broadcastBehaviorUpdate(userId);
  }, [userId]);

  const seedLearningProfile = useCallback((preset: BehaviorLearningSeedPreset) => {
    const seededEvents = buildSeedEvents(preset);
    if (seededEvents.length === 0) return;

    setEvents(previous => {
      const next = [...previous, ...seededEvents]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-250);
      saveEventsToStorage(userId, next);
      return next;
    });

    setAppEvents(previous => {
      const nextEvent: AppBehaviorEvent = {
        id: crypto.randomUUID(),
        source: 'manual',
        entity: 'calendar',
        action: 'seed-profile',
        title: `Seeded ${preset} learning profile`,
        detail: 'Synthetic behavior-learning events only. No calendar events were created.',
        countsForLearning: false,
        createdAt: new Date().toISOString(),
      };
      const next = [...previous, nextEvent]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-500);
      saveAppEventsToStorage(userId, next);
      return next;
    });

    if (supabase) {
      const scheduleRows = seededEvents.map((event) => mapEventToScheduleRow(userId, event));
      void (async () => {
        const [{ error: scheduleError }, { error: appError }] = await Promise.all([
          supabase.from('behavior_learning_schedule_events').insert(scheduleRows),
          supabase.from('behavior_learning_app_events').insert({
            id: crypto.randomUUID(),
            user_id: userId,
            source: 'manual',
            entity: 'calendar',
            action: 'seed-profile',
            title: `Seeded ${preset} learning profile`,
            detail: 'Synthetic behavior-learning events only. No calendar events were created.',
            counts_for_learning: false,
            created_at: new Date().toISOString(),
          }),
        ]);
        if (scheduleError) {
          console.warn('[BehaviorLearning] Failed to seed schedule events', scheduleError, preset);
        }
        if (appError) {
          console.warn('[BehaviorLearning] Failed to log seeded profile', appError, preset);
        }
      })();
    }

    broadcastBehaviorUpdate(userId);
  }, [userId]);

  const recordAppAction = useCallback((
    entity: AppBehaviorEntity,
    action: string,
    title: string,
    options?: BehaviorLearningActionOptions,
    detail?: string | null,
  ) => {
    const countsForLearning = shouldLearn(options);
    persistAppEvent({
      id: crypto.randomUUID(),
      source: options?.source ?? 'manual',
      entity,
      action,
      title,
      detail: detail ?? null,
      countsForLearning,
      createdAt: new Date().toISOString(),
    });
  }, [persistAppEvent]);

  const recordCalendarCreate = useCallback((
    payload: NewGoogleCalendarEvent,
    options: { source: LearningSource; calendarId?: string | null; calendarSummary?: string | null; countsForLearning: boolean },
  ) => {
    const snapshot = parseTimedPayload(payload, options.calendarId, options.calendarSummary);
    if (!snapshot || !isStudyBlockLikeEvent({
      title: snapshot.title,
      calendarSummary: snapshot.calendarSummary,
      description: payload.description,
    })) return;

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
      countsForLearning: options.countsForLearning,
      createdAt: new Date().toISOString(),
    });
  }, [persistEvent]);

  const recordCalendarUpdate = useCallback((
    previousEvent: GoogleCalendarEvent,
    payload: NewGoogleCalendarEvent,
    options: { source: LearningSource; calendarId?: string | null; calendarSummary?: string | null; countsForLearning: boolean },
  ) => {
    const previousSnapshot = parseTimedCalendarEvent(previousEvent);
    const nextSnapshot = parseTimedPayload(
      payload,
      options.calendarId ?? previousEvent.calendarId,
      options.calendarSummary ?? previousEvent.calendarSummary,
    );
    const title = nextSnapshot?.title ?? previousSnapshot?.title ?? previousEvent.summary ?? '';
    const calendarSummary = nextSnapshot?.calendarSummary ?? previousSnapshot?.calendarSummary;

    if (!isStudyBlockLikeEvent({
      title,
      calendarSummary,
      description: updates.description ?? event.description,
    })) return;
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
      countsForLearning: options.countsForLearning,
      createdAt: new Date().toISOString(),
    });
  }, [persistEvent]);

  const recordCalendarDelete = useCallback((event: GoogleCalendarEvent, options: { source: LearningSource; countsForLearning: boolean }) => {
    const snapshot = parseTimedCalendarEvent(event);
    if (!snapshot || !isStudyBlockLikeEvent({
      title: snapshot.title,
      calendarSummary: snapshot.calendarSummary,
      description: event.description,
    })) return;

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
      countsForLearning: options.countsForLearning,
      createdAt: new Date().toISOString(),
    });
  }, [persistEvent]);

  const getPreferredStudyStartMinutes = useCallback((dateKey: string, fallbackStartMinutes: number) => {
    return choosePreferredStartMinute(events, appEvents, dateKey, fallbackStartMinutes);
  }, [appEvents, events]);

  const preferenceSummary = useMemo(() => {
    const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const { weekdayScores } = buildScoreMaps(events, appEvents);
    return weekdayNames.map((name, weekday) => {
      const buckets = Array.from(weekdayScores[weekday].entries()).sort((a, b) => b[1] - a[1]);
      return {
        weekday,
        name,
        preferredStartMinutes: buckets[0]?.[1] >= 2 ? buckets[0]?.[0] ?? null : null,
      };
    });
  }, [appEvents, events]);

  const aiLearningEnabled = !aiTestingMode;
  const setAiLearningEnabled = useCallback((enabled: boolean) => {
    setAiTestingMode(!enabled);
  }, [setAiTestingMode]);

  const scoreStudySlot = useCallback((dateKey: string, startMinutes: number, durationMinutes: number) => {
    return scoreStudySlotFromEvents(events, appEvents, dateKey, startMinutes, durationMinutes);
  }, [appEvents, events]);

  const logTaskCreated = useCallback((_: {
    title: string;
    projectId: string | null;
    dueDate: string | null;
    status?: TaskStatusLike;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'task',
      'create',
      _.title,
      _.options,
      [_.projectId ? `project:${_.projectId}` : null, _.dueDate ? `due:${_.dueDate}` : null, _.status ? `status:${_.status}` : null]
        .filter(Boolean)
        .join(' · ') || null,
    );
  }, [recordAppAction]);

  const logTaskUpdated = useCallback((_: {
    title: string;
    projectId: string | null;
    dueDate: string | null;
    status?: TaskStatusLike;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'task',
      'update',
      _.title,
      _.options,
      [_.projectId ? `project:${_.projectId}` : null, _.dueDate ? `due:${_.dueDate}` : null, _.status ? `status:${_.status}` : null]
        .filter(Boolean)
        .join(' · ') || null,
    );
  }, [recordAppAction]);

  const logTaskStatusChanged = useCallback((params: {
    title: string;
    projectId: string | null;
    dueDate: string | null;
    previousStatus: TaskStatusLike;
    nextStatus: TaskStatusLike;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'task',
      'status-change',
      params.title,
      params.options,
      [
        params.projectId ? `project:${params.projectId}` : null,
        params.dueDate ? `due:${params.dueDate}` : null,
        `from:${params.previousStatus}`,
        `to:${params.nextStatus}`,
      ].filter(Boolean).join(' · '),
    );
  }, [recordAppAction]);

  const logTaskDueDateChanged = useCallback((params: {
    title: string;
    projectId: string | null;
    previousDueDate: string | null;
    nextDueDate: string | null;
    status?: TaskStatusLike;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'task',
      'due-date-change',
      params.title,
      params.options,
      [
        params.projectId ? `project:${params.projectId}` : null,
        params.previousDueDate ? `from:${params.previousDueDate}` : 'from:none',
        params.nextDueDate ? `to:${params.nextDueDate}` : 'to:none',
        params.status ? `status:${params.status}` : null,
      ].filter(Boolean).join(' · '),
    );
  }, [recordAppAction]);

  const logTaskSubtaskCreated = useCallback((params: {
    taskTitle: string;
    subtaskTitle: string;
    projectId: string | null;
    dueDate: string | null;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'task',
      'subtask-create',
      params.taskTitle,
      params.options,
      [
        params.projectId ? `project:${params.projectId}` : null,
        params.dueDate ? `due:${params.dueDate}` : null,
        `subtask:${params.subtaskTitle}`,
      ].filter(Boolean).join(' · '),
    );
  }, [recordAppAction]);

  const logTaskSubtaskToggled = useCallback((params: {
    taskTitle: string;
    subtaskTitle: string;
    projectId: string | null;
    dueDate: string | null;
    done: boolean;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'task',
      params.done ? 'subtask-complete' : 'subtask-uncomplete',
      params.taskTitle,
      params.options,
      [
        params.projectId ? `project:${params.projectId}` : null,
        params.dueDate ? `due:${params.dueDate}` : null,
        `subtask:${params.subtaskTitle}`,
      ].filter(Boolean).join(' · '),
    );
  }, [recordAppAction]);

  const logTaskSubtaskDeleted = useCallback((params: {
    taskTitle: string;
    subtaskTitle: string;
    projectId: string | null;
    dueDate: string | null;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'task',
      'subtask-delete',
      params.taskTitle,
      params.options,
      [
        params.projectId ? `project:${params.projectId}` : null,
        params.dueDate ? `due:${params.dueDate}` : null,
        `subtask:${params.subtaskTitle}`,
      ].filter(Boolean).join(' · '),
    );
  }, [recordAppAction]);

  const logTaskCommentAdded = useCallback((params: {
    taskTitle: string;
    projectId: string | null;
    dueDate: string | null;
    commentPreview: string;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'task',
      'comment-add',
      params.taskTitle,
      params.options,
      [
        params.projectId ? `project:${params.projectId}` : null,
        params.dueDate ? `due:${params.dueDate}` : null,
        `comment:${params.commentPreview}`,
      ].filter(Boolean).join(' · '),
    );
  }, [recordAppAction]);

  const logTaskCommentDeleted = useCallback((params: {
    taskTitle: string;
    projectId: string | null;
    dueDate: string | null;
    commentPreview: string;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'task',
      'comment-delete',
      params.taskTitle,
      params.options,
      [
        params.projectId ? `project:${params.projectId}` : null,
        params.dueDate ? `due:${params.dueDate}` : null,
        `comment:${params.commentPreview}`,
      ].filter(Boolean).join(' · '),
    );
  }, [recordAppAction]);

  const logTaskDeleted = useCallback((params: {
    title: string;
    projectId: string | null;
    dueDate: string | null;
    status?: TaskStatusLike;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'task',
      'delete',
      params.title,
      params.options,
      [params.projectId ? `project:${params.projectId}` : null, params.dueDate ? `due:${params.dueDate}` : null, params.status ? `status:${params.status}` : null]
        .filter(Boolean)
        .join(' · ') || null,
    );
  }, [recordAppAction]);

  const logCalendarCreated = useCallback((
    payload: NewGoogleCalendarEvent,
    calendarSummary?: string | null,
    options?: BehaviorLearningActionOptions,
  ) => {
    recordAppAction('calendar', 'create', payload.summary, options, calendarSummary ?? null);
    recordCalendarCreate(payload, {
      source: options?.source ?? 'manual',
      calendarSummary,
      countsForLearning: shouldLearn(options),
    });
  }, [recordAppAction, recordCalendarCreate]);

  const logCalendarUpdated = useCallback((
    previousEvent: GoogleCalendarEvent,
    payload: Partial<NewGoogleCalendarEvent>,
    calendarSummary?: string | null,
    options?: BehaviorLearningActionOptions,
  ) => {
    recordAppAction(
      'calendar',
      'update',
      payload.summary ?? previousEvent.summary ?? 'Untitled event',
      options,
      calendarSummary ?? previousEvent.calendarSummary ?? null,
    );

    const mergedPayload: NewGoogleCalendarEvent = {
      summary: payload.summary ?? previousEvent.summary ?? 'Untitled event',
      ...(payload.description !== undefined || previousEvent.description ? { description: payload.description ?? previousEvent.description ?? undefined } : {}),
      ...(payload.location !== undefined || previousEvent.location ? { location: payload.location ?? previousEvent.location ?? undefined } : {}),
      start: payload.start ?? (
        previousEvent.start?.dateTime
          ? { dateTime: previousEvent.start.dateTime, ...(previousEvent.start.timeZone ? { timeZone: previousEvent.start.timeZone } : {}) }
          : { date: previousEvent.start?.date ?? '' }
      ),
      end: payload.end ?? (
        previousEvent.end?.dateTime
          ? { dateTime: previousEvent.end.dateTime, ...(previousEvent.end.timeZone ? { timeZone: previousEvent.end.timeZone } : {}) }
          : { date: previousEvent.end?.date ?? previousEvent.start?.date ?? '' }
      ),
    };

    recordCalendarUpdate(previousEvent, mergedPayload, {
      source: options?.source ?? 'manual',
      calendarId: previousEvent.calendarId,
      calendarSummary: calendarSummary ?? previousEvent.calendarSummary,
      countsForLearning: shouldLearn(options),
    });
  }, [recordAppAction, recordCalendarUpdate]);

  const logCalendarDeleted = useCallback((
    event: GoogleCalendarEvent,
    options?: BehaviorLearningActionOptions,
  ) => {
    recordAppAction('calendar', 'delete', event.summary ?? 'Untitled event', options, event.calendarSummary ?? null);
    recordCalendarDelete(event, {
      source: options?.source ?? 'manual',
      countsForLearning: shouldLearn(options),
    });
  }, [recordAppAction, recordCalendarDelete]);

  const logStudyBlockOutcome = useCallback((params: {
    title: string;
    calendarSummary: string | null;
    dateKey: string;
    startMinutes: number;
    durationMinutes: number;
    status: StudyBlockOutcomeStatus;
    options?: BehaviorLearningActionOptions;
  }) => {
    const actionByStatus: Record<StudyBlockOutcomeStatus, string> = {
      completed: 'study-block-complete',
      partial: 'study-block-partial',
      skipped: 'study-block-skip',
      rescheduled: 'study-block-reschedule',
    };

    recordAppAction(
      'calendar',
      actionByStatus[params.status],
      params.title,
      params.options,
      [
        params.calendarSummary ? `calendar:${params.calendarSummary}` : null,
        `date:${params.dateKey}`,
        `start:${params.startMinutes}`,
        `duration:${params.durationMinutes}`,
      ].filter(Boolean).join(' · '),
    );
  }, [recordAppAction]);

  const logDeadlineCreated = useCallback((params: {
    title: string;
    projectId: string | null;
    dueDate: string;
    dueTime: string | null;
    type: string;
    status?: string;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'deadline',
      'create',
      params.title,
      params.options,
      [params.projectId ? `project:${params.projectId}` : null, `date:${params.dueDate}`, params.dueTime ? `time:${params.dueTime}` : null, `type:${params.type}`, params.status ? `status:${params.status}` : null]
      .filter(Boolean)
        .join(' · '),
    );
  }, [recordAppAction]);

  const logDeadlineUpdated = useCallback((params: {
    title: string;
    projectId: string | null;
    dueDate: string;
    dueTime: string | null;
    type: string;
    status?: string;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'deadline',
      'update',
      params.title,
      params.options,
      [params.projectId ? `project:${params.projectId}` : null, `date:${params.dueDate}`, params.dueTime ? `time:${params.dueTime}` : null, `type:${params.type}`, params.status ? `status:${params.status}` : null]
        .filter(Boolean)
        .join(' · '),
    );
  }, [recordAppAction]);

  const logDeadlineDeleted = useCallback((params: {
    title: string;
    projectId: string | null;
    dueDate: string;
    dueTime: string | null;
    type?: string;
    status?: string;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'deadline',
      'delete',
      params.title,
      params.options,
      [params.projectId ? `project:${params.projectId}` : null, `date:${params.dueDate}`, params.dueTime ? `time:${params.dueTime}` : null, params.type ? `type:${params.type}` : null, params.status ? `status:${params.status}` : null]
        .filter(Boolean)
        .join(' · '),
    );
  }, [recordAppAction]);

  const logProjectCreated = useCallback((params: {
    name: string;
    description?: string;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction('project', 'create', params.name, params.options, params.description?.trim() || null);
  }, [recordAppAction]);

  const logProjectDeleted = useCallback((params: {
    name: string;
    description?: string;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction('project', 'delete', params.name, params.options, params.description?.trim() || null);
  }, [recordAppAction]);

  const logDeadlineLinked = useCallback((params: {
    deadlineTitle: string;
    taskTitle: string;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction('deadline-link', 'create', params.deadlineTitle, params.options, `task:${params.taskTitle}`);
  }, [recordAppAction]);

  const logDeadlineUnlinked = useCallback((params: {
    deadlineTitle: string;
    taskTitle: string;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction('deadline-link', 'delete', params.deadlineTitle, params.options, `task:${params.taskTitle}`);
  }, [recordAppAction]);

  const logHabitCreated = useCallback((params: {
    title: string;
    frequency: 'daily' | 'weekly';
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction('habit', 'create', params.title, params.options, `frequency:${params.frequency}`);
  }, [recordAppAction]);

  const logHabitToggled = useCallback((params: {
    title: string;
    completed: boolean;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction('habit', params.completed ? 'complete' : 'uncomplete', params.title, params.options, null);
  }, [recordAppAction]);

  const logHabitDeleted = useCallback((params: {
    title: string;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction('habit', 'delete', params.title, params.options, null);
  }, [recordAppAction]);

  return {
    aiTestingMode,
    aiLearningEnabled,
    setAiTestingMode,
    setAiLearningEnabled,
    clearBehaviorHistory,
    behaviorEvents: events,
    appBehaviorEvents: appEvents,
    getPreferredStudyStartMinutes,
    preferenceSummary,
    scoreStudySlot,
    logTaskCreated,
    logTaskUpdated,
    logTaskStatusChanged,
    logTaskDueDateChanged,
    logTaskDeleted,
    logTaskSubtaskCreated,
    logTaskSubtaskToggled,
    logTaskSubtaskDeleted,
    logTaskCommentAdded,
    logTaskCommentDeleted,
    logCalendarCreated,
    logCalendarUpdated,
    logCalendarDeleted,
    logStudyBlockOutcome,
    logDeadlineCreated,
    logDeadlineUpdated,
    logDeadlineDeleted,
    logProjectCreated,
    logProjectDeleted,
    logDeadlineLinked,
    logDeadlineUnlinked,
    logHabitCreated,
    logHabitToggled,
    logHabitDeleted,
    recordCalendarCreate,
    recordCalendarUpdate,
    recordCalendarDelete,
    seedLearningProfile,
  };
}
