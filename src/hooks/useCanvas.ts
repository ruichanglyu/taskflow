import { useState, useEffect, useCallback } from 'react';
import { CanvasConnection, DeadlineSource, DeadlineType, Project } from '../types';
import { supabase } from '../lib/supabase';
import {
  fetchCanvasCourses,
  fetchCanvasAssignments,
  fetchCanvasQuizzes,
  exchangeOAuthCode,
  CanvasCourse,
  CanvasAssignment,
  CanvasQuiz,
} from '../lib/canvas';

const PROJECT_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];

export interface SyncResult {
  coursesCreated: number;
  coursesMatched: number;
  deadlinesCreated: number;
  deadlinesUpdated: number;
  errors: string[];
}

// --- Connection storage (isolated — swap implementation later) ---

async function loadConnection(userId: string): Promise<CanvasConnection | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('canvas_connections')
    .select('id, base_url, canvas_user_id, last_synced_at, created_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    baseUrl: data.base_url,
    canvasUserId: data.canvas_user_id,
    lastSyncedAt: data.last_synced_at,
    createdAt: data.created_at,
  };
}

async function removeConnection(userId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('canvas_connections')
    .delete()
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

async function updateLastSynced(userId: string): Promise<void> {
  if (!supabase) return;
  await supabase
    .from('canvas_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', userId);
}

// --- Sync helpers ---

function canvasTypeToDeadlineType(assignment: CanvasAssignment): DeadlineType {
  const name = assignment.name.toLowerCase();
  if (assignment.is_quiz_assignment) return 'quiz';
  if (name.includes('exam') || name.includes('midterm') || name.includes('final')) return 'exam';
  if (name.includes('quiz')) return 'quiz';
  if (name.includes('lab')) return 'lab';
  if (name.includes('project')) return 'project';
  return 'assignment';
}

function quizTypeToDeadlineType(quiz: CanvasQuiz): DeadlineType {
  const title = quiz.title.toLowerCase();
  if (title.includes('exam') || title.includes('midterm') || title.includes('final')) return 'exam';
  return 'quiz';
}

function parseDueDate(dueAt: string): { date: string; time: string | null } {
  const d = new Date(dueAt);
  const date = d.toISOString().slice(0, 10);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const time = (hours === 0 && minutes === 0) ? null : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return { date, time };
}

// --- Main hook ---

export function useCanvas(userId: string, existingProjects: Project[]) {
  const [connection, setConnection] = useState<CanvasConnection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // Load connection on mount
  useEffect(() => {
    loadConnection(userId).then(conn => {
      setConnection(conn);
      setIsLoading(false);
    });
  }, [userId]);

  // Handle OAuth callback: check URL for ?canvas_code=...&canvas_state=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('canvas_code');
    const stateStr = params.get('canvas_state');

    if (!code || !stateStr) return;

    // Clean the URL immediately
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);

    // Exchange the code for tokens
    (async () => {
      try {
        const state = JSON.parse(atob(stateStr)) as { baseUrl: string };
        const conn = await exchangeOAuthCode(code, state.baseUrl);
        setConnection(conn);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Canvas OAuth failed');
      }
    })();
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await removeConnection(userId);
      setConnection(null);
      setLastSyncResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  }, [userId]);

  const sync = useCallback(async (): Promise<SyncResult | null> => {
    if (!supabase || !connection) return null;
    setIsSyncing(true);
    setError(null);
    const result: SyncResult = { coursesCreated: 0, coursesMatched: 0, deadlinesCreated: 0, deadlinesUpdated: 0, errors: [] };

    try {
      // 1. Fetch Canvas courses
      const canvasCourses = await fetchCanvasCourses();

      // 2. Map courses to projects (match by canvas_course_id only)
      const courseToProjectId = new Map<number, string>();

      for (const course of canvasCourses) {
        const existingProject = existingProjects.find(p => p.canvasCourseId === String(course.id));

        if (existingProject) {
          courseToProjectId.set(course.id, existingProject.id);
          result.coursesMatched++;
        } else {
          const { data, error: insertError } = await supabase
            .from('projects')
            .insert({
              user_id: userId,
              name: course.name,
              description: course.course_code || '',
              color: PROJECT_COLORS[(result.coursesCreated + existingProjects.length) % PROJECT_COLORS.length],
              canvas_course_id: String(course.id),
            })
            .select('id')
            .single();

          if (insertError) {
            result.errors.push(`Failed to create course "${course.name}": ${insertError.message}`);
            continue;
          }
          courseToProjectId.set(course.id, data.id);
          result.coursesCreated++;
        }
      }

      // 3. Fetch assignments + quizzes for each course, upsert as deadlines
      for (const course of canvasCourses) {
        const projectId = courseToProjectId.get(course.id) ?? null;

        try {
          await syncCourseItems(course, projectId, userId, result);
        } catch (err) {
          result.errors.push(`Failed to sync "${course.name}": ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      // 4. Mark sync timestamp
      await updateLastSynced(userId);
      setConnection(prev => prev ? { ...prev, lastSyncedAt: new Date().toISOString() } : prev);
      setLastSyncResult(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setError(msg);
      result.errors.push(msg);
      setLastSyncResult(result);
      return result;
    } finally {
      setIsSyncing(false);
    }
  }, [connection, existingProjects, userId]);

  return {
    connection,
    isLoading,
    isSyncing,
    error,
    lastSyncResult,
    clearError,
    disconnect,
    sync,
  };
}

// --- Sync course items (assignments + quizzes) ---

async function syncCourseItems(
  course: CanvasCourse,
  projectId: string | null,
  userId: string,
  result: SyncResult,
) {
  if (!supabase) return;

  const [assignments, quizzes] = await Promise.all([
    fetchCanvasAssignments(course.id),
    fetchCanvasQuizzes(course.id),
  ]);

  const quizAssignmentNames = new Set(quizzes.map(q => q.title));

  // Sync assignments
  for (const assignment of assignments) {
    if (!assignment.due_at) continue;
    if (assignment.is_quiz_assignment || quizAssignmentNames.has(assignment.name)) continue;

    const sourceType: DeadlineSource = 'canvas_assignment';
    const sourceId = String(assignment.id);
    const { date, time } = parseDueDate(assignment.due_at);

    await upsertDeadline({
      userId,
      projectId,
      title: assignment.name,
      type: canvasTypeToDeadlineType(assignment),
      dueDate: date,
      dueTime: time,
      sourceType,
      sourceId,
      sourceUrl: assignment.html_url,
    }, result);
  }

  // Sync quizzes
  for (const quiz of quizzes) {
    if (!quiz.due_at) continue;
    if (quiz.quiz_type === 'practice_quiz' || quiz.quiz_type === 'survey') continue;

    const sourceType: DeadlineSource = 'canvas_quiz';
    const sourceId = `quiz_${quiz.id}`;
    const { date, time } = parseDueDate(quiz.due_at);

    await upsertDeadline({
      userId,
      projectId,
      title: quiz.title,
      type: quizTypeToDeadlineType(quiz),
      dueDate: date,
      dueTime: time,
      sourceType,
      sourceId,
      sourceUrl: quiz.html_url,
    }, result);
  }
}

async function upsertDeadline(
  item: {
    userId: string;
    projectId: string | null;
    title: string;
    type: DeadlineType;
    dueDate: string;
    dueTime: string | null;
    sourceType: DeadlineSource;
    sourceId: string;
    sourceUrl: string;
  },
  result: SyncResult,
) {
  if (!supabase) return;

  const { data: existing } = await supabase
    .from('deadlines')
    .select('id')
    .eq('user_id', item.userId)
    .eq('source_type', item.sourceType)
    .eq('source_id', item.sourceId)
    .maybeSingle();

  if (existing) {
    // Update Canvas-controlled fields only; preserve status, notes, linked tasks
    const { error: updateError } = await supabase
      .from('deadlines')
      .update({
        title: item.title,
        type: item.type,
        due_date: item.dueDate,
        due_time: item.dueTime,
        project_id: item.projectId,
        source_url: item.sourceUrl,
        source_synced_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (updateError) {
      result.errors.push(`Failed to update "${item.title}": ${updateError.message}`);
    } else {
      result.deadlinesUpdated++;
    }
  } else {
    const { error: insertError } = await supabase
      .from('deadlines')
      .insert({
        user_id: item.userId,
        project_id: item.projectId,
        title: item.title,
        type: item.type,
        due_date: item.dueDate,
        due_time: item.dueTime,
        notes: '',
        source_type: item.sourceType,
        source_id: item.sourceId,
        source_url: item.sourceUrl,
        source_synced_at: new Date().toISOString(),
      });

    if (insertError) {
      result.errors.push(`Failed to create "${item.title}": ${insertError.message}`);
    } else {
      result.deadlinesCreated++;
    }
  }
}
