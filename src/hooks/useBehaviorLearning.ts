import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GoogleCalendarEvent, NewGoogleCalendarEvent } from '../lib/googleCalendar';
import { supabase } from '../lib/supabase';
import type { StudyBlockOutcomeStatus } from '../types';
import { isStudyBlockLikeEvent } from '../utils/studyBlockDetection';
import { addDays, formatDateKey } from '../utils/dateHelpers';

type LearningSource = 'manual' | 'ai';
type LearningAction = 'create' | 'reschedule' | 'delete';
type TaskStatusLike = 'todo' | 'in-progress' | 'done' | 'not-started' | 'missed';
type AppBehaviorEntity = 'task' | 'deadline' | 'project' | 'habit' | 'deadline-link' | 'calendar' | 'ai' | 'study-review' | 'study-block';
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

interface ParsedTaskDueDetail {
  dueDate: string | null;
  previousDueDate: string | null;
  nextDueDate: string | null;
  previousStatus: string | null;
  nextStatus: string | null;
}

interface BehaviorInsightSummary {
  summary: string;
  proactivePrompts: string[];
}

type InsightConfidence = 'low' | 'medium' | 'high';

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

function parseTaskDueDetail(detail: string | null | undefined): ParsedTaskDueDetail {
  return {
    dueDate: getDetailToken(detail, 'due'),
    previousDueDate: getDetailToken(detail, 'from'),
    nextDueDate: getDetailToken(detail, 'to'),
    previousStatus: getDetailToken(detail, 'from-status'),
    nextStatus: getDetailToken(detail, 'to-status'),
  };
}

function parseTaskStatusDetail(detail: string | null | undefined) {
  return {
    dueDate: getDetailToken(detail, 'due'),
    previousStatus: getDetailToken(detail, 'from'),
    nextStatus: getDetailToken(detail, 'to'),
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

function getTimeWindowLabel(startMinutes: number) {
  if (startMinutes < 12 * 60) return 'morning';
  if (startMinutes < 17 * 60) return 'afternoon';
  if (startMinutes < 21 * 60) return 'evening';
  return 'late night';
}

function classifyConfidence(sampleSize: number, spread = 0) {
  if (sampleSize >= 10 && spread >= 4) return 'high' as InsightConfidence;
  if (sampleSize >= 5 && spread >= 2) return 'medium' as InsightConfidence;
  return 'low' as InsightConfidence;
}

function daysBetween(dateA: string, dateB: string) {
  const a = new Date(`${dateA}T00:00:00`);
  const b = new Date(`${dateB}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function normalizeCreatedAt(value: unknown) {
  if (typeof value !== 'string') return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : value;
}

function getCreatedDateKey(value: string | null | undefined) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeStoredBehaviorEvent(event: unknown): BehaviorLearningEvent | null {
  if (!event || typeof event !== 'object') return null;
  const value = event as Record<string, unknown>;
  if (typeof value.title !== 'string' || typeof value.dateKey !== 'string') return null;

  const source: LearningSource = value.source === 'ai' ? 'ai' : 'manual';
  const action: LearningAction =
    value.action === 'reschedule' || value.action === 'delete' ? value.action : 'create';

  return {
    id: typeof value.id === 'string' && value.id ? value.id : crypto.randomUUID(),
    source,
    action,
    title: value.title,
    calendarId: typeof value.calendarId === 'string' ? value.calendarId : null,
    calendarSummary: typeof value.calendarSummary === 'string' ? value.calendarSummary : null,
    dateKey: value.dateKey,
    weekday: typeof value.weekday === 'number' && Number.isFinite(value.weekday) ? value.weekday : 0,
    startMinutes: typeof value.startMinutes === 'number' && Number.isFinite(value.startMinutes) ? value.startMinutes : 0,
    durationMinutes: typeof value.durationMinutes === 'number' && Number.isFinite(value.durationMinutes) ? value.durationMinutes : 60,
    previousDateKey: typeof value.previousDateKey === 'string' ? value.previousDateKey : null,
    previousWeekday: typeof value.previousWeekday === 'number' && Number.isFinite(value.previousWeekday) ? value.previousWeekday : null,
    previousStartMinutes: typeof value.previousStartMinutes === 'number' && Number.isFinite(value.previousStartMinutes) ? value.previousStartMinutes : null,
    previousDurationMinutes: typeof value.previousDurationMinutes === 'number' && Number.isFinite(value.previousDurationMinutes) ? value.previousDurationMinutes : null,
    countsForLearning: typeof value.countsForLearning === 'boolean' ? value.countsForLearning : true,
    createdAt: normalizeCreatedAt(value.createdAt),
  };
}

function normalizeStoredAppBehaviorEvent(event: unknown): AppBehaviorEvent | null {
  if (!event || typeof event !== 'object') return null;
  const value = event as Record<string, unknown>;
  if (typeof value.action !== 'string' || typeof value.title !== 'string') return null;

  const entity: AppBehaviorEntity =
    value.entity === 'task' ||
    value.entity === 'deadline' ||
    value.entity === 'project' ||
    value.entity === 'habit' ||
    value.entity === 'deadline-link' ||
    value.entity === 'calendar' ||
    value.entity === 'ai' ||
    value.entity === 'study-review' ||
    value.entity === 'study-block'
      ? value.entity
      : 'task';

  return {
    id: typeof value.id === 'string' && value.id ? value.id : crypto.randomUUID(),
    source: value.source === 'ai' ? 'ai' : 'manual',
    entity,
    action: value.action,
    title: value.title,
    detail: typeof value.detail === 'string' ? value.detail : null,
    countsForLearning: typeof value.countsForLearning === 'boolean' ? value.countsForLearning : true,
    createdAt: normalizeCreatedAt(value.createdAt),
  };
}

function loadEventsFromStorage(userId: string): BehaviorLearningEvent[] {
  if (typeof window === 'undefined') return [];

  try {
    const saved = localStorage.getItem(eventsStorageKey(userId));
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed)
      ? parsed
          .map(normalizeStoredBehaviorEvent)
          .filter((event): event is BehaviorLearningEvent => Boolean(event))
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
      ? parsed
          .map(normalizeStoredAppBehaviorEvent)
          .filter((event): event is AppBehaviorEvent => Boolean(event))
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

function shouldTreatAppEventAsLearningSignal(entity: AppBehaviorEntity, action: string) {
  if (entity === 'ai' && (action === 'view-open' || action === 'panel-open')) {
    return false;
  }

  return true;
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

function buildBehaviorInsightSummary(
  events: BehaviorLearningEvent[],
  appEvents: AppBehaviorEvent[],
): BehaviorInsightSummary {
  const learningEvents = events.filter(event => event.countsForLearning);
  const learningAppEvents = appEvents.filter(event => event.countsForLearning);
  const recentStudyOutcomes = learningAppEvents.filter(event => event.entity === 'calendar' && event.action.startsWith('study-block-'));
  const completedOutcomes = recentStudyOutcomes.filter(event => event.action === 'study-block-complete');
  const partialOutcomes = recentStudyOutcomes.filter(event => event.action === 'study-block-partial');
  const skippedOutcomes = recentStudyOutcomes.filter(event => event.action === 'study-block-skip');
  const rescheduledOutcomes = recentStudyOutcomes.filter(event => event.action === 'study-block-reschedule');

  const windowScores = new Map<string, number>();
  recentStudyOutcomes.forEach(event => {
    const parsed = parseStudyBlockOutcomeDetail(event.detail);
    if (!parsed) return;
    const bucket = getTimeWindowLabel(parsed.startMinutes);
    const delta =
      event.action === 'study-block-complete' ? 2 :
      event.action === 'study-block-partial' ? 0.75 :
      event.action === 'study-block-skip' ? -2 :
      -1;
    windowScores.set(bucket, (windowScores.get(bucket) ?? 0) + delta);
  });
  const strongestWindow = [...windowScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const weakestWindow = [...windowScores.entries()].sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
  const sortedWindowScores = [...windowScores.entries()].sort((a, b) => b[1] - a[1]);
  const timeWindowSpread = sortedWindowScores.length >= 2 ? sortedWindowScores[0][1] - sortedWindowScores[1][1] : Math.abs(sortedWindowScores[0]?.[1] ?? 0);
  const timeWindowConfidence = classifyConfidence(recentStudyOutcomes.length, timeWindowSpread);

  let laterReschedules = 0;
  let earlierReschedules = 0;
  let otherDayReschedules = 0;
  learningEvents.forEach(event => {
    if (event.action !== 'reschedule' || event.previousStartMinutes === null || event.previousDateKey === null) return;
    if (event.previousDateKey !== event.dateKey) otherDayReschedules += 1;
    const diff = event.startMinutes - event.previousStartMinutes;
    if (diff > 0) laterReschedules += 1;
    if (diff < 0) earlierReschedules += 1;
  });

  const plannedByDate = new Map<string, number>();
  learningEvents.forEach(event => {
    if (event.action === 'create' || event.action === 'reschedule') {
      plannedByDate.set(event.dateKey, (plannedByDate.get(event.dateKey) ?? 0) + 1);
    }
  });

  const completedByDate = new Map<string, number>();
  recentStudyOutcomes.forEach(event => {
    const parsed = parseStudyBlockOutcomeDetail(event.detail);
    if (!parsed) return;
    const value = event.action === 'study-block-complete' ? 1 : event.action === 'study-block-partial' ? 0.5 : 0;
    completedByDate.set(parsed.dateKey, (completedByDate.get(parsed.dateKey) ?? 0) + value);
  });

  let sameDayOutcomeResponses = 0;
  let laterOutcomeResponses = 0;
  recentStudyOutcomes.forEach(event => {
    const parsed = parseStudyBlockOutcomeDetail(event.detail);
    if (!parsed) return;
    const responseDate = getCreatedDateKey(event.createdAt);
    if (!responseDate) return;
    const diff = daysBetween(parsed.dateKey, responseDate);
    if (diff === null) return;
    if (diff <= 0) sameDayOutcomeResponses += 1;
    else laterOutcomeResponses += 1;
  });

  let overloadedDayCount = 0;
  let overloadedDayCompletionAverage = 0;
  let manageableDayCompletionAverage = 0;
  let overloadedDaysSeen = 0;
  let manageableDaysSeen = 0;
  [...plannedByDate.entries()].forEach(([dateKey, planned]) => {
    const completed = completedByDate.get(dateKey) ?? 0;
    if (planned >= 3) {
      overloadedDayCount += 1;
      overloadedDaysSeen += 1;
      overloadedDayCompletionAverage += completed;
    } else {
      manageableDaysSeen += 1;
      manageableDayCompletionAverage += completed;
    }
  });
  overloadedDayCompletionAverage = overloadedDaysSeen > 0 ? overloadedDayCompletionAverage / overloadedDaysSeen : 0;
  manageableDayCompletionAverage = manageableDaysSeen > 0 ? manageableDayCompletionAverage / manageableDaysSeen : 0;
  const workloadSpread = manageableDayCompletionAverage - overloadedDayCompletionAverage;
  const workloadConfidence = classifyConfidence(overloadedDaysSeen + manageableDaysSeen, Math.abs(workloadSpread));

  const completionDates = [...new Set(completedOutcomes
    .map(event => parseStudyBlockOutcomeDetail(event.detail)?.dateKey)
    .filter((value): value is string => Boolean(value))
    .sort(),
  )];
  let currentStudyStreak = 0;
  let longestStudyStreak = 0;
  let previousDate: string | null = null;
  completionDates.forEach(dateKey => {
    if (!previousDate) {
      currentStudyStreak = 1;
      longestStudyStreak = 1;
      previousDate = dateKey;
      return;
    }
    const diff = daysBetween(previousDate, dateKey);
    currentStudyStreak = diff === 1 ? currentStudyStreak + 1 : 1;
    longestStudyStreak = Math.max(longestStudyStreak, currentStudyStreak);
    previousDate = dateKey;
  });

  const taskDoneEvents = learningAppEvents.filter(event => event.entity === 'task' && event.action === 'status-change');
  const taskStartedEvents = learningAppEvents.filter(event => event.entity === 'task' && event.action === 'status-change');
  let doneEarly = 0;
  let doneOnTime = 0;
  let doneLate = 0;
  let startedEarly = 0;
  let startedLastMinute = 0;
  taskDoneEvents.forEach(event => {
    const statusDetail = parseTaskStatusDetail(event.detail);
    if (statusDetail.nextStatus !== 'done' || !statusDetail.dueDate) return;
    const completionDate = getCreatedDateKey(event.createdAt);
    if (!completionDate) return;
    const diff = daysBetween(completionDate, statusDetail.dueDate);
    if (diff === null) return;
    if (diff > 0) doneEarly += 1;
    else if (diff === 0) doneOnTime += 1;
    else doneLate += 1;
  });
  taskStartedEvents.forEach(event => {
    const statusDetail = parseTaskStatusDetail(event.detail);
    if (statusDetail.nextStatus !== 'in-progress' || !statusDetail.dueDate) return;
    const startDate = getCreatedDateKey(event.createdAt);
    if (!startDate) return;
    const diff = daysBetween(startDate, statusDetail.dueDate);
    if (diff === null) return;
    if (diff >= 2) startedEarly += 1;
    else startedLastMinute += 1;
  });
  const deadlineApproachSpread = Math.abs(startedEarly - startedLastMinute);
  const deadlineApproachConfidence = classifyConfidence(taskStartedEvents.length, deadlineApproachSpread);
  const taskTimingSpread = Math.max(doneEarly, doneOnTime, doneLate) - Math.min(doneEarly, doneOnTime, doneLate);
  const taskTimingConfidence = classifyConfidence(taskDoneEvents.length, taskTimingSpread);

  const dueDateChangeEvents = learningAppEvents.filter(event => event.entity === 'task' && event.action === 'due-date-change');
  let dueDatesMovedLater = 0;
  let dueDatesMovedEarlier = 0;
  dueDateChangeEvents.forEach(event => {
    const dueDetail = parseTaskDueDetail(event.detail);
    if (!dueDetail.previousDueDate || !dueDetail.nextDueDate) return;
    const diff = daysBetween(dueDetail.previousDueDate, dueDetail.nextDueDate);
    if (diff === null || diff === 0) return;
    if (diff > 0) dueDatesMovedLater += 1;
    else dueDatesMovedEarlier += 1;
  });
  const dueDateDriftConfidence = classifyConfidence(dueDateChangeEvents.length, Math.abs(dueDatesMovedLater - dueDatesMovedEarlier));

  const aiPromptCount = learningAppEvents.filter(event => event.entity === 'ai' && event.action === 'prompt-submit').length;
  const aiApplyCount = learningAppEvents.filter(event => event.entity === 'ai' && event.action === 'actions-apply').length;
  const aiSuggestionAcceptedCount = learningAppEvents.filter(event => event.entity === 'ai' && event.action === 'suggestion-accepted').length;
  const aiSuggestionEditedCount = learningAppEvents.filter(event => event.entity === 'ai' && event.action === 'suggestion-edited').length;
  const aiSuggestionRejectedCount = learningAppEvents.filter(event => event.entity === 'ai' && event.action === 'suggestion-rejected').length;
  const aiPromptAcceptance = aiPromptCount > 0 ? Math.round((aiApplyCount / aiPromptCount) * 100) : null;
  const aiPanelOpenCount = learningAppEvents.filter(event => event.entity === 'ai' && event.action === 'panel-open').length;
  const viewOpenEvents = learningAppEvents.filter(event => event.entity === 'ai' && event.action === 'view-open');
  const topViews = [...viewOpenEvents.reduce<Map<string, number>>((acc, event) => {
    acc.set(event.title, (acc.get(event.title) ?? 0) + 1);
    return acc;
  }, new Map()).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([view, count]) => `${view} (${count})`);
  const aiEngagementConfidence = classifyConfidence(aiPromptCount, Math.abs(aiApplyCount - (aiPromptCount - aiApplyCount)));

  const lines: string[] = [
    `Study outcomes tracked: ${completedOutcomes.length} completed, ${partialOutcomes.length} partial, ${skippedOutcomes.length} skipped, ${rescheduledOutcomes.length} marked rescheduled.`,
  ];
  const proactivePrompts: string[] = [];

  if (plannedByDate.size >= 3) {
    lines.push(`Plan realism: ${[...plannedByDate.values()].reduce((sum, value) => sum + value, 0)} planned study blocks versus ${Math.round([...completedByDate.values()].reduce((sum, value) => sum + value, 0) * 10) / 10} completed-equivalent blocks.`);
  } else {
    lines.push('Plan realism: still learning from your recent study scheduling history.');
  }

  if (timeWindowConfidence === 'high') {
    lines.push(`Time-of-day pattern: strong signal toward ${strongestWindow}${weakestWindow && weakestWindow !== strongestWindow ? `, while ${weakestWindow} is noticeably weaker` : ''}.`);
    proactivePrompts.push(`Build my next study plan around my ${strongestWindow} study window.`);
  } else if (timeWindowConfidence === 'medium') {
    lines.push(`Time-of-day pattern: early signal that ${strongestWindow} may fit better${weakestWindow && weakestWindow !== strongestWindow ? ` than ${weakestWindow}` : ''}.`);
    proactivePrompts.push(`Suggest study blocks that lean toward my ${strongestWindow} window.`);
  } else {
    lines.push('Time-of-day pattern: still learning which study window is strongest for you.');
  }

  if (laterReschedules || earlierReschedules || otherDayReschedules) {
    lines.push(`Reschedule pattern: ${laterReschedules} moved later, ${earlierReschedules} moved earlier, ${otherDayReschedules} moved to another day.`);
  } else {
    lines.push('Reschedule pattern: not enough reschedule history yet.');
  }

  if (workloadConfidence === 'high') {
    lines.push(`Workload tolerance: strong signal that days with 3+ planned blocks average ${overloadedDayCompletionAverage.toFixed(1)} completions, versus ${manageableDayCompletionAverage.toFixed(1)} on lighter days.`);
    if (manageableDayCompletionAverage > overloadedDayCompletionAverage) {
      proactivePrompts.push('Make this week’s study plan more realistic based on how many blocks I usually finish in a day.');
    }
  } else if (workloadConfidence === 'medium') {
    lines.push(`Workload tolerance: there is some signal that lighter days average ${manageableDayCompletionAverage.toFixed(1)} completions, versus ${overloadedDayCompletionAverage.toFixed(1)} on heavier days.`);
    if (manageableDayCompletionAverage > overloadedDayCompletionAverage) {
      proactivePrompts.push('Lighten my study plan using my recent completion pattern.');
    }
  } else {
    lines.push('Workload tolerance: still learning how much you can realistically get through in one day.');
  }

  if (recentStudyOutcomes.length >= 4) {
    lines.push(`Study review follow-through: ${sameDayOutcomeResponses} outcomes were logged the same day, ${laterOutcomeResponses} were logged later.`);
  } else {
    lines.push('Study review follow-through: still learning how quickly you confirm study outcomes.');
  }

  if (longestStudyStreak > 0) {
    lines.push(`Study consistency: longest completion streak is ${longestStudyStreak} day${longestStudyStreak === 1 ? '' : 's'}.`);
  } else {
    lines.push('Study consistency: no completed study streaks recorded yet.');
  }

  if (deadlineApproachConfidence === 'high') {
    lines.push(`Deadline approach: strong signal that ${startedEarly} task starts happened 2+ days before the due date, while ${startedLastMinute} started within the last day.`);
    if (startedLastMinute > startedEarly) {
      proactivePrompts.push('Help me start upcoming deadlines earlier based on my recent procrastination pattern.');
    }
  } else if (deadlineApproachConfidence === 'medium') {
    lines.push(`Deadline approach: some signal from recent tasks shows ${startedEarly} early starts versus ${startedLastMinute} last-minute starts.`);
    if (startedLastMinute > startedEarly) {
      proactivePrompts.push('Suggest an earlier start plan for my upcoming deadlines.');
    }
  } else {
    lines.push('Deadline approach: still learning how early you usually begin tasks.');
  }

  if (taskTimingConfidence === 'high') {
    lines.push(`Task completion timing: strong signal from completed tasks shows ${doneEarly} finished early, ${doneOnTime} on the due date, ${doneLate} after the due date.`);
  } else if (taskTimingConfidence === 'medium') {
    lines.push(`Task completion timing: some signal from completed tasks shows ${doneEarly} early, ${doneOnTime} on-time, and ${doneLate} late finishes.`);
  } else {
    lines.push('Task completion timing: still learning how your completed tasks line up with due dates.');
  }

  if (dueDateDriftConfidence === 'high') {
    lines.push(`Deadline drift: strong signal that ${dueDatesMovedLater} due dates were pushed later, versus ${dueDatesMovedEarlier} pulled earlier.`);
  } else if (dueDateDriftConfidence === 'medium') {
    lines.push(`Deadline drift: some recent due-date changes skew ${dueDatesMovedLater} later versus ${dueDatesMovedEarlier} earlier.`);
  } else {
    lines.push('Deadline drift: still learning whether your due dates tend to move later or earlier.');
  }

  if (aiEngagementConfidence === 'high') {
    lines.push(`AI engagement: strong signal from ${aiPromptCount} prompts with ${aiApplyCount} applied suggestion bundles${aiPromptAcceptance !== null ? ` (${aiPromptAcceptance}% apply rate)` : ''}; accepted ${aiSuggestionAcceptedCount}, edited ${aiSuggestionEditedCount}, rejected ${aiSuggestionRejectedCount}; AI panel opened ${aiPanelOpenCount} times${topViews.length > 0 ? `, most visited views: ${topViews.join(', ')}` : ''}.`);
  } else if (aiEngagementConfidence === 'medium') {
    lines.push(`AI engagement: early signal from ${aiPromptCount} prompts and ${aiApplyCount} applied suggestion bundles${aiPromptAcceptance !== null ? ` (${aiPromptAcceptance}% apply rate)` : ''}; accepted ${aiSuggestionAcceptedCount}, edited ${aiSuggestionEditedCount}, rejected ${aiSuggestionRejectedCount}.`);
  } else {
    lines.push('AI engagement: still learning how often AI suggestions turn into applied changes.');
  }

  return {
    summary: lines.join('\n'),
    proactivePrompts: Array.from(new Set(proactivePrompts)).slice(0, 3),
  };
}

function appendBehaviorEvent(
  previous: BehaviorLearningEvent[],
  nextEvent: BehaviorLearningEvent,
) {
  const next = [...previous, nextEvent].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return next.slice(-250);
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
  const hydrationVersionRef = useRef(0);

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
    const hydrateVersion = ++hydrationVersionRef.current;

    async function hydrateFromSupabase() {
      if (!supabase) return;
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
          if (cancelled || hydrateVersion !== hydrationVersionRef.current) return;
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
            if (cancelled || hydrateVersion !== hydrationVersionRef.current) return;
            setEvents(localEvents);
            setAppEvents(localAppEvents);
            setAiTestingModeState(localTestingMode);
            return;
          }
        }

        if (cancelled || hydrateVersion !== hydrationVersionRef.current) return;

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
        if (cancelled || hydrateVersion !== hydrationVersionRef.current) return;
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

  // Circuit breaker: stop remote writes after constraint/schema errors to avoid hammering the DB
  const remoteDisabledRef = useRef(false);

  const persistEvent = useCallback((event: BehaviorLearningEvent) => {
    setEvents(previous => {
      const next = appendBehaviorEvent(previous, event);
      saveEventsToStorage(userId, next);
      return next;
    });
    if (supabase && !remoteDisabledRef.current) {
      void (async () => {
        const { error } = await supabase
          .from('behavior_learning_schedule_events')
          .insert(mapEventToScheduleRow(userId, event));
        if (error) {
          console.warn('[BehaviorLearning] Failed to persist schedule event', error, event);
          if (error.code === '23514' || error.code === '42P01') remoteDisabledRef.current = true;
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
    if (supabase && !remoteDisabledRef.current) {
      void (async () => {
        const { error } = await supabase
          .from('behavior_learning_app_events')
          .insert(mapAppEventToRow(userId, event));
        if (error) {
          console.warn('[BehaviorLearning] Failed to persist app event', error, event);
          if (error.code === '23514' || error.code === '42P01') remoteDisabledRef.current = true;
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

  const shouldCountForLearning = useCallback((options?: BehaviorLearningActionOptions) => {
    if (aiTestingMode) return false;
    return options?.learn !== false;
  }, [aiTestingMode]);

  const clearBehaviorHistory = useCallback(() => {
    hydrationVersionRef.current += 1;
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
    const countsForLearning = shouldCountForLearning(options) && shouldTreatAppEventAsLearningSignal(entity, action);
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
  }, [persistAppEvent, shouldCountForLearning]);

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
      description: payload.description ?? previousEvent.description,
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

  const behaviorInsights = useMemo(() => buildBehaviorInsightSummary(events, appEvents), [appEvents, events]);

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
    const snapshot = parseTimedPayload(payload, null, calendarSummary ?? null);
    recordAppAction(
      'calendar',
      'create',
      payload.summary,
      options,
      [
        calendarSummary ? `calendar:${calendarSummary}` : null,
        snapshot?.dateKey ? `date:${snapshot.dateKey}` : null,
        snapshot ? `start:${snapshot.startMinutes}` : null,
        snapshot ? `duration:${snapshot.durationMinutes}` : null,
      ].filter(Boolean).join(' · ') || null,
    );
    recordCalendarCreate(payload, {
      source: options?.source ?? 'manual',
      calendarSummary,
      countsForLearning: shouldCountForLearning(options),
    });
  }, [recordAppAction, recordCalendarCreate, shouldCountForLearning]);

  const logCalendarUpdated = useCallback((
    previousEvent: GoogleCalendarEvent,
    payload: Partial<NewGoogleCalendarEvent>,
    calendarSummary?: string | null,
    options?: BehaviorLearningActionOptions,
  ) => {
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

    const nextSnapshot = parseTimedPayload(mergedPayload, previousEvent.calendarId, calendarSummary ?? previousEvent.calendarSummary);
    recordAppAction(
      'calendar',
      'update',
      payload.summary ?? previousEvent.summary ?? 'Untitled event',
      options,
      [
        calendarSummary ?? previousEvent.calendarSummary ? `calendar:${calendarSummary ?? previousEvent.calendarSummary}` : null,
        nextSnapshot?.dateKey ? `date:${nextSnapshot.dateKey}` : null,
        nextSnapshot ? `start:${nextSnapshot.startMinutes}` : null,
        nextSnapshot ? `duration:${nextSnapshot.durationMinutes}` : null,
      ].filter(Boolean).join(' · ') || null,
    );

    recordCalendarUpdate(previousEvent, mergedPayload, {
      source: options?.source ?? 'manual',
      calendarId: previousEvent.calendarId,
      calendarSummary: calendarSummary ?? previousEvent.calendarSummary,
      countsForLearning: shouldCountForLearning(options),
    });
  }, [recordAppAction, recordCalendarUpdate, shouldCountForLearning]);

  const logCalendarDeleted = useCallback((
    event: GoogleCalendarEvent,
    options?: BehaviorLearningActionOptions,
  ) => {
    const snapshot = parseTimedCalendarEvent(event);
    recordAppAction(
      'calendar',
      'delete',
      event.summary ?? 'Untitled event',
      options,
      [
        event.calendarSummary ? `calendar:${event.calendarSummary}` : null,
        snapshot?.dateKey ? `date:${snapshot.dateKey}` : null,
        snapshot ? `start:${snapshot.startMinutes}` : null,
        snapshot ? `duration:${snapshot.durationMinutes}` : null,
      ].filter(Boolean).join(' · ') || null,
    );
    recordCalendarDelete(event, {
      source: options?.source ?? 'manual',
      countsForLearning: shouldCountForLearning(options),
    });
  }, [recordAppAction, recordCalendarDelete, shouldCountForLearning]);

  const logStudyBlockOutcome = useCallback((params: {
    title: string;
    calendarSummary: string | null;
    dateKey: string;
    startMinutes: number;
    durationMinutes: number;
    status: StudyBlockOutcomeStatus;
    notes?: string;
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
        params.notes?.trim() ? `notes:${params.notes.trim().slice(0, 120)}` : null,
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

  const logProjectUpdated = useCallback((params: {
    name: string;
    description?: string;
    color?: string;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'project',
      'update',
      params.name,
      params.options,
      [params.description?.trim() || null, params.color ? `color:${params.color}` : null]
        .filter(Boolean)
        .join(' · ') || null,
    );
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

  const logAiPromptSubmitted = useCallback((params: {
    prompt: string;
    hasImages?: boolean;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'ai',
      'prompt-submit',
      params.prompt.trim().slice(0, 80) || '(empty prompt)',
      params.options,
      [
        `length:${params.prompt.trim().length}`,
        params.hasImages ? 'images:true' : null,
      ].filter(Boolean).join(' · '),
    );
  }, [recordAppAction]);

  const logAiActionsApplied = useCallback((params: {
    blockType: string;
    appliedCount: number;
    skippedCount?: number;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'ai',
      'actions-apply',
      params.blockType,
      params.options,
      [
        `applied:${params.appliedCount}`,
        params.skippedCount !== undefined ? `skipped:${params.skippedCount}` : null,
      ].filter(Boolean).join(' · '),
    );
  }, [recordAppAction]);

  const logAiSuggestionAccepted = useCallback((params: {
    blockType: string;
    actionCount: number;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'ai',
      'suggestion-accepted',
      params.blockType,
      params.options,
      `count:${params.actionCount}`,
    );
  }, [recordAppAction]);

  const logAiSuggestionEdited = useCallback((params: {
    blockType: string;
    actionCount: number;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'ai',
      'suggestion-edited',
      params.blockType,
      params.options,
      `count:${params.actionCount}`,
    );
  }, [recordAppAction]);

  const logAiSuggestionRejected = useCallback((params: {
    blockTypes: string[];
    actionCount: number;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'ai',
      'suggestion-rejected',
      params.blockTypes.join(', ') || 'unknown',
      params.options,
      `count:${params.actionCount}`,
    );
  }, [recordAppAction]);

  const logStudyBlockLinkedTarget = useCallback((params: {
    title: string;
    calendarSummary?: string | null;
    course?: string | null;
    deadlineTitle: string;
    deadlineDate: string;
    deadlineType?: string | null;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'study-block',
      'target-link',
      params.title,
      params.options,
      [
        params.calendarSummary ? `calendar:${params.calendarSummary}` : null,
        params.course ? `course:${params.course}` : null,
        `deadline:${params.deadlineTitle}`,
        `deadline-date:${params.deadlineDate}`,
        params.deadlineType ? `deadline-type:${params.deadlineType}` : null,
      ].filter(Boolean).join(' · '),
    );
  }, [recordAppAction]);

  const logStudySlotCandidates = useCallback((params: {
    title: string;
    calendarSummary?: string | null;
    course?: string | null;
    dateKey: string;
    durationMinutes: number;
    requestedStartMinutes: number;
    adjusted: boolean;
    deadlineTitle?: string | null;
    deadlineDate?: string | null;
    deadlineType?: string | null;
    candidates: Array<{
      startMinutes: number;
      endMinutes: number;
      score: number;
      distance: number;
      selected: boolean;
    }>;
    options?: BehaviorLearningActionOptions;
  }) => {
    if (params.candidates.length === 0) {
      recordAppAction(
        'study-block',
        'slot-no-fit',
        params.title,
        params.options,
        [
          params.calendarSummary ? `calendar:${params.calendarSummary}` : null,
          params.course ? `course:${params.course}` : null,
          `date:${params.dateKey}`,
          `duration:${params.durationMinutes}`,
          `requested:${params.requestedStartMinutes}`,
          params.adjusted ? 'adjusted:true' : 'adjusted:false',
          params.deadlineTitle ? `deadline:${params.deadlineTitle}` : null,
          params.deadlineDate ? `deadline-date:${params.deadlineDate}` : null,
          params.deadlineType ? `deadline-type:${params.deadlineType}` : null,
        ].filter(Boolean).join(' · '),
      );
      return;
    }

    params.candidates.forEach(candidate => {
      recordAppAction(
        'study-block',
        'slot-candidate',
        params.title,
        params.options,
        [
          params.calendarSummary ? `calendar:${params.calendarSummary}` : null,
          params.course ? `course:${params.course}` : null,
          `date:${params.dateKey}`,
          `duration:${params.durationMinutes}`,
          `requested:${params.requestedStartMinutes}`,
          `start:${candidate.startMinutes}`,
          `end:${candidate.endMinutes}`,
          `score:${candidate.score.toFixed(3)}`,
          `distance:${candidate.distance}`,
          `selected:${candidate.selected ? 'true' : 'false'}`,
          params.adjusted ? 'adjusted:true' : 'adjusted:false',
          params.deadlineTitle ? `deadline:${params.deadlineTitle}` : null,
          params.deadlineDate ? `deadline-date:${params.deadlineDate}` : null,
          params.deadlineType ? `deadline-type:${params.deadlineType}` : null,
        ].filter(Boolean).join(' · '),
      );
    });
  }, [recordAppAction]);

  const logAcademicPlanGenerated = useCallback((params: {
    proposalId: string;
    deadlineTitles: string[];
    blockCount: number;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'study-block',
      'plan-generated',
      params.deadlineTitles.join(', ') || 'Study plan proposal',
      params.options,
      [
        `proposal:${params.proposalId}`,
        `deadlines:${params.deadlineTitles.length}`,
        `blocks:${params.blockCount}`,
      ].join(' · '),
    );
  }, [recordAppAction]);

  const logAcademicPlanAccepted = useCallback((params: {
    proposalId: string;
    deadlineTitles: string[];
    blockCount: number;
    acceptedCount: number;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'study-block',
      'plan-accepted',
      params.deadlineTitles.join(', ') || 'Study plan proposal',
      params.options,
      [
        `proposal:${params.proposalId}`,
        `deadlines:${params.deadlineTitles.length}`,
        `blocks:${params.blockCount}`,
        `accepted:${params.acceptedCount}`,
      ].join(' · '),
    );
  }, [recordAppAction]);

  const logAcademicPlanEdited = useCallback((params: {
    proposalId: string;
    deadlineTitle: string;
    blockTitle: string;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'study-block',
      'plan-edited',
      params.deadlineTitle || 'Study plan proposal',
      params.options,
      [
        `proposal:${params.proposalId}`,
        `block:${params.blockTitle}`,
      ].join(' · '),
    );
  }, [recordAppAction]);

  const logAcademicPlanRejected = useCallback((params: {
    proposalId: string;
    deadlineTitles: string[];
    blockCount: number;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'study-block',
      'plan-rejected',
      params.deadlineTitles.join(', ') || 'Study plan proposal',
      params.options,
      [
        `proposal:${params.proposalId}`,
        `deadlines:${params.deadlineTitles.length}`,
        `blocks:${params.blockCount}`,
      ].join(' · '),
    );
  }, [recordAppAction]);

  const logStudyReviewPromptShown = useCallback((params: {
    count: number;
    options?: BehaviorLearningActionOptions;
  }) => {
    recordAppAction(
      'study-review',
      'prompt-shown',
      'End-of-day study review',
      params.options,
      `count:${params.count}`,
    );
  }, [recordAppAction]);

  const logAiPanelOpened = useCallback((options?: BehaviorLearningActionOptions) => {
    recordAppAction('ai', 'panel-open', 'AI Assistant', options, null);
  }, [recordAppAction]);

  const logViewOpened = useCallback((view: string, options?: BehaviorLearningActionOptions) => {
    recordAppAction('ai', 'view-open', view, options, null);
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
    behaviorInsights,
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
    logProjectUpdated,
    logProjectDeleted,
    logDeadlineLinked,
    logDeadlineUnlinked,
    logHabitCreated,
    logHabitToggled,
    logHabitDeleted,
    logAiPromptSubmitted,
    logAiActionsApplied,
    logAiSuggestionAccepted,
    logAiSuggestionEdited,
    logAiSuggestionRejected,
    logStudyReviewPromptShown,
    logAiPanelOpened,
    logViewOpened,
    logStudyBlockLinkedTarget,
    logStudySlotCandidates,
    logAcademicPlanGenerated,
    logAcademicPlanAccepted,
    logAcademicPlanEdited,
    logAcademicPlanRejected,
    recordCalendarCreate,
    recordCalendarUpdate,
    recordCalendarDelete,
    seedLearningProfile,
  };
}
