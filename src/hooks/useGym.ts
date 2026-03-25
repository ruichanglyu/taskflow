import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type {
  WorkoutPlan, WorkoutDayTemplate, Exercise,
  WorkoutDayExercise, WorkoutSession, WorkoutExerciseLog, WorkoutSetLog,
} from '../types';

export function useGym(userId: string) {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [dayTemplates, setDayTemplates] = useState<WorkoutDayTemplate[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [dayExercises, setDayExercises] = useState<WorkoutDayExercise[]>([]);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [exerciseLogs, setExerciseLogs] = useState<WorkoutExerciseLog[]>([]);
  const [setLogs, setSetLogs] = useState<WorkoutSetLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // --- Load all gym data ---
  const loadData = useCallback(async () => {
    if (!supabase) { setIsLoading(false); return; }
    try {
      const [
        { data: p }, { data: dt }, { data: ex },
        { data: de }, { data: s }, { data: el }, { data: sl },
      ] = await Promise.all([
        supabase.from('workout_plans').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
        supabase.from('workout_day_templates').select('*').eq('user_id', userId).order('position'),
        supabase.from('exercises').select('*').eq('user_id', userId).order('name'),
        supabase.from('workout_day_exercises').select('*').eq('user_id', userId).order('position'),
        supabase.from('workout_sessions').select('*').eq('user_id', userId).order('started_at', { ascending: false }),
        supabase.from('workout_exercise_logs').select('*').eq('user_id', userId).order('position'),
        supabase.from('workout_set_logs').select('*').eq('user_id', userId).order('set_number'),
      ]);

      setPlans((p ?? []).map(r => ({
        id: r.id, name: r.name, description: r.description,
        daysPerWeek: r.days_per_week, isActive: r.is_active, createdAt: r.created_at,
      })));
      setDayTemplates((dt ?? []).map(r => ({
        id: r.id, planId: r.plan_id, name: r.name, position: r.position, notes: r.notes,
      })));
      setExercises((ex ?? []).map(r => ({
        id: r.id, name: r.name, muscleGroup: r.muscle_group, notes: r.notes,
        referenceImageUrl: r.reference_image_url, createdAt: r.created_at,
      })));
      setDayExercises((de ?? []).map(r => ({
        id: r.id, workoutDayTemplateId: r.workout_day_template_id, exerciseId: r.exercise_id,
        position: r.position, targetSets: r.target_sets, targetReps: r.target_reps,
        restSeconds: r.rest_seconds, notes: r.notes,
      })));
      setSessions((s ?? []).map(r => ({
        id: r.id, planId: r.plan_id, workoutDayTemplateId: r.workout_day_template_id,
        startedAt: r.started_at, completedAt: r.completed_at, status: r.status, notes: r.notes,
      })));
      setExerciseLogs((el ?? []).map(r => ({
        id: r.id, workoutSessionId: r.workout_session_id, exerciseId: r.exercise_id,
        workoutDayExerciseId: r.workout_day_exercise_id, position: r.position, notes: r.notes,
      })));
      setSetLogs((sl ?? []).map(r => ({
        id: r.id, workoutExerciseLogId: r.workout_exercise_log_id, setNumber: r.set_number,
        weight: r.weight, reps: r.reps, completed: r.completed,
      })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gym data');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  // --- Plans ---
  const addPlan = useCallback(async (name: string, description: string, daysPerWeek: number): Promise<string | null> => {
    if (!supabase) return null;
    // Deactivate other plans
    await supabase.from('workout_plans').update({ is_active: false }).eq('user_id', userId);
    const { data, error: e } = await supabase.from('workout_plans')
      .insert({ user_id: userId, name, description, days_per_week: daysPerWeek, is_active: true })
      .select('*').single();
    if (e || !data) { setError(e?.message ?? 'Failed'); return null; }
    setPlans(prev => prev.map(p => ({ ...p, isActive: false })));
    setPlans(prev => [{ id: data.id, name: data.name, description: data.description, daysPerWeek: data.days_per_week, isActive: true, createdAt: data.created_at }, ...prev]);
    return data.id;
  }, [userId]);

  const updatePlan = useCallback(async (id: string, updates: Partial<Pick<WorkoutPlan, 'name' | 'description' | 'daysPerWeek' | 'isActive'>>): Promise<boolean> => {
    if (!supabase) return false;
    const row: Record<string, unknown> = {};
    if (updates.name !== undefined) row.name = updates.name;
    if (updates.description !== undefined) row.description = updates.description;
    if (updates.daysPerWeek !== undefined) row.days_per_week = updates.daysPerWeek;
    if (updates.isActive !== undefined) {
      row.is_active = updates.isActive;
      if (updates.isActive) {
        await supabase.from('workout_plans').update({ is_active: false }).eq('user_id', userId).neq('id', id);
        setPlans(prev => prev.map(p => p.id === id ? p : { ...p, isActive: false }));
      }
    }
    const { error: e } = await supabase.from('workout_plans').update(row).eq('id', id);
    if (e) { setError(e.message); return false; }
    setPlans(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    return true;
  }, [userId]);

  const deletePlan = useCallback(async (id: string) => {
    if (!supabase) return;
    await supabase.from('workout_plans').delete().eq('id', id);
    setPlans(prev => prev.filter(p => p.id !== id));
    setDayTemplates(prev => prev.filter(d => d.planId !== id));
  }, []);

  // --- Day Templates ---
  const addDayTemplate = useCallback(async (planId: string, name: string): Promise<string | null> => {
    if (!supabase) return null;
    const pos = dayTemplates.filter(d => d.planId === planId).length;
    const { data, error: e } = await supabase.from('workout_day_templates')
      .insert({ plan_id: planId, user_id: userId, name, position: pos })
      .select('*').single();
    if (e || !data) { setError(e?.message ?? 'Failed'); return null; }
    setDayTemplates(prev => [...prev, { id: data.id, planId: data.plan_id, name: data.name, position: data.position, notes: data.notes }]);
    return data.id;
  }, [userId, dayTemplates]);

  const updateDayTemplate = useCallback(async (id: string, updates: Partial<Pick<WorkoutDayTemplate, 'name' | 'notes' | 'position'>>): Promise<boolean> => {
    if (!supabase) return false;
    const row: Record<string, unknown> = {};
    if (updates.name !== undefined) row.name = updates.name;
    if (updates.notes !== undefined) row.notes = updates.notes;
    if (updates.position !== undefined) row.position = updates.position;
    const { error: e } = await supabase.from('workout_day_templates').update(row).eq('id', id);
    if (e) { setError(e.message); return false; }
    setDayTemplates(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
    return true;
  }, []);

  const deleteDayTemplate = useCallback(async (id: string) => {
    if (!supabase) return;
    await supabase.from('workout_day_templates').delete().eq('id', id);
    setDayTemplates(prev => prev.filter(d => d.id !== id));
    setDayExercises(prev => prev.filter(de => de.workoutDayTemplateId !== id));
  }, []);

  // --- Exercises ---
  const addExercise = useCallback(async (name: string, muscleGroup: string, notes: string, referenceImageUrl?: string): Promise<string | null> => {
    if (!supabase) return null;
    const { data, error: e } = await supabase.from('exercises')
      .insert({ user_id: userId, name, muscle_group: muscleGroup, notes, reference_image_url: referenceImageUrl ?? null })
      .select('*').single();
    if (e || !data) { setError(e?.message ?? 'Failed'); return null; }
    setExercises(prev => [...prev, { id: data.id, name: data.name, muscleGroup: data.muscle_group, notes: data.notes, referenceImageUrl: data.reference_image_url, createdAt: data.created_at }].sort((a, b) => a.name.localeCompare(b.name)));
    return data.id;
  }, [userId]);

  const updateExercise = useCallback(async (id: string, updates: Partial<Pick<Exercise, 'name' | 'muscleGroup' | 'notes' | 'referenceImageUrl'>>): Promise<boolean> => {
    if (!supabase) return false;
    const row: Record<string, unknown> = {};
    if (updates.name !== undefined) row.name = updates.name;
    if (updates.muscleGroup !== undefined) row.muscle_group = updates.muscleGroup;
    if (updates.notes !== undefined) row.notes = updates.notes;
    if (updates.referenceImageUrl !== undefined) row.reference_image_url = updates.referenceImageUrl;
    const { error: e } = await supabase.from('exercises').update(row).eq('id', id);
    if (e) { setError(e.message); return false; }
    setExercises(prev => prev.map(ex => ex.id === id ? { ...ex, ...updates } : ex));
    return true;
  }, []);

  const deleteExercise = useCallback(async (id: string) => {
    if (!supabase) return;
    await supabase.from('exercises').delete().eq('id', id);
    setExercises(prev => prev.filter(ex => ex.id !== id));
  }, []);

  // --- Day Exercises ---
  const addDayExercise = useCallback(async (dayTemplateId: string, exerciseId: string, targetSets: number, targetReps: string, restSeconds: number): Promise<string | null> => {
    if (!supabase) return null;
    const pos = dayExercises.filter(de => de.workoutDayTemplateId === dayTemplateId).length;
    const { data, error: e } = await supabase.from('workout_day_exercises')
      .insert({ workout_day_template_id: dayTemplateId, exercise_id: exerciseId, user_id: userId, position: pos, target_sets: targetSets, target_reps: targetReps, rest_seconds: restSeconds })
      .select('*').single();
    if (e || !data) { setError(e?.message ?? 'Failed'); return null; }
    setDayExercises(prev => [...prev, { id: data.id, workoutDayTemplateId: data.workout_day_template_id, exerciseId: data.exercise_id, position: data.position, targetSets: data.target_sets, targetReps: data.target_reps, restSeconds: data.rest_seconds, notes: data.notes }]);
    return data.id;
  }, [userId, dayExercises]);

  const updateDayExercise = useCallback(async (id: string, updates: Partial<Pick<WorkoutDayExercise, 'targetSets' | 'targetReps' | 'restSeconds' | 'notes' | 'position'>>): Promise<boolean> => {
    if (!supabase) return false;
    const row: Record<string, unknown> = {};
    if (updates.targetSets !== undefined) row.target_sets = updates.targetSets;
    if (updates.targetReps !== undefined) row.target_reps = updates.targetReps;
    if (updates.restSeconds !== undefined) row.rest_seconds = updates.restSeconds;
    if (updates.notes !== undefined) row.notes = updates.notes;
    if (updates.position !== undefined) row.position = updates.position;
    const { error: e } = await supabase.from('workout_day_exercises').update(row).eq('id', id);
    if (e) { setError(e.message); return false; }
    setDayExercises(prev => prev.map(de => de.id === id ? { ...de, ...updates } : de));
    return true;
  }, []);

  const deleteDayExercise = useCallback(async (id: string) => {
    if (!supabase) return;
    await supabase.from('workout_day_exercises').delete().eq('id', id);
    setDayExercises(prev => prev.filter(de => de.id !== id));
  }, []);

  // --- Sessions ---
  const startSession = useCallback(async (planId: string, dayTemplateId: string): Promise<string | null> => {
    if (!supabase) return null;
    const { data, error: e } = await supabase.from('workout_sessions')
      .insert({ user_id: userId, plan_id: planId, workout_day_template_id: dayTemplateId, status: 'in-progress' })
      .select('*').single();
    if (e || !data) { setError(e?.message ?? 'Failed'); return null; }
    const session: WorkoutSession = {
      id: data.id, planId: data.plan_id, workoutDayTemplateId: data.workout_day_template_id,
      startedAt: data.started_at, completedAt: data.completed_at, status: data.status, notes: data.notes,
    };
    setSessions(prev => [session, ...prev]);

    // Pre-create exercise logs for each planned exercise
    const planned = dayExercises.filter(de => de.workoutDayTemplateId === dayTemplateId).sort((a, b) => a.position - b.position);
    for (const de of planned) {
      const { data: logData } = await supabase.from('workout_exercise_logs')
        .insert({ workout_session_id: data.id, exercise_id: de.exerciseId, workout_day_exercise_id: de.id, user_id: userId, position: de.position })
        .select('*').single();
      if (logData) {
        setExerciseLogs(prev => [...prev, {
          id: logData.id, workoutSessionId: logData.workout_session_id, exerciseId: logData.exercise_id,
          workoutDayExerciseId: logData.workout_day_exercise_id, position: logData.position, notes: logData.notes,
        }]);
        // Pre-create set rows
        for (let s = 1; s <= de.targetSets; s++) {
          const { data: setData } = await supabase.from('workout_set_logs')
            .insert({ workout_exercise_log_id: logData.id, user_id: userId, set_number: s, completed: false })
            .select('*').single();
          if (setData) {
            setSetLogs(prev => [...prev, {
              id: setData.id, workoutExerciseLogId: setData.workout_exercise_log_id,
              setNumber: setData.set_number, weight: setData.weight, reps: setData.reps, completed: setData.completed,
            }]);
          }
        }
      }
    }
    return data.id;
  }, [userId, dayExercises]);

  const completeSession = useCallback(async (id: string, status: 'completed' | 'abandoned' = 'completed') => {
    if (!supabase) return;
    const now = new Date().toISOString();
    await supabase.from('workout_sessions').update({ status, completed_at: now }).eq('id', id);
    setSessions(prev => prev.map(s => s.id === id ? { ...s, status, completedAt: now } : s));
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    if (!supabase) return;
    // Cascade deletes exercise_logs and set_logs via FK
    await supabase.from('workout_sessions').delete().eq('id', id);
    const logIds = exerciseLogs.filter(el => el.workoutSessionId === id).map(el => el.id);
    setSessions(prev => prev.filter(s => s.id !== id));
    setExerciseLogs(prev => prev.filter(el => el.workoutSessionId !== id));
    setSetLogs(prev => prev.filter(sl => !logIds.includes(sl.workoutExerciseLogId)));
  }, [exerciseLogs]);

  // --- Set Logs ---
  const updateSetLog = useCallback(async (id: string, updates: Partial<Pick<WorkoutSetLog, 'weight' | 'reps' | 'completed'>>): Promise<boolean> => {
    if (!supabase) return false;
    const row: Record<string, unknown> = {};
    if (updates.weight !== undefined) row.weight = updates.weight;
    if (updates.reps !== undefined) row.reps = updates.reps;
    if (updates.completed !== undefined) row.completed = updates.completed;
    const { error: e } = await supabase.from('workout_set_logs').update(row).eq('id', id);
    if (e) { setError(e.message); return false; }
    setSetLogs(prev => prev.map(sl => sl.id === id ? { ...sl, ...updates } : sl));
    return true;
  }, []);

  // Helper: get the last session's performance for an exercise
  const getLastPerformance = useCallback((exerciseId: string, currentSessionId?: string): WorkoutSetLog[] => {
    // Find the most recent completed session that logged this exercise (excluding current)
    const relevantLogs = exerciseLogs
      .filter(el => el.exerciseId === exerciseId)
      .filter(el => {
        const session = sessions.find(s => s.id === el.workoutSessionId);
        return session && session.status === 'completed' && session.id !== currentSessionId;
      })
      .sort((a, b) => {
        const sa = sessions.find(s => s.id === a.workoutSessionId);
        const sb = sessions.find(s => s.id === b.workoutSessionId);
        return new Date(sb?.startedAt ?? 0).getTime() - new Date(sa?.startedAt ?? 0).getTime();
      });

    if (relevantLogs.length === 0) return [];
    const lastLog = relevantLogs[0];
    return setLogs.filter(sl => sl.workoutExerciseLogId === lastLog.id).sort((a, b) => a.setNumber - b.setNumber);
  }, [exerciseLogs, sessions, setLogs]);

  const activePlan = plans.find(p => p.isActive) ?? null;
  const activeSession = sessions.find(s => s.status === 'in-progress') ?? null;

  return {
    plans, dayTemplates, exercises, dayExercises,
    sessions, exerciseLogs, setLogs,
    activePlan, activeSession,
    isLoading, error, clearError, loadData,
    addPlan, updatePlan, deletePlan,
    addDayTemplate, updateDayTemplate, deleteDayTemplate,
    addExercise, updateExercise, deleteExercise,
    addDayExercise, updateDayExercise, deleteDayExercise,
    startSession, completeSession, deleteSession, updateSetLog,
    getLastPerformance,
  };
}
