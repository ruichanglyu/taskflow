import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface Habit {
  id: string;
  userId: string;
  title: string;
  frequency: 'daily' | 'weekly';
  position: number;
  createdAt: string;
  doneToday: boolean;
  streak: number;
}

export function useHabits(userId: string | null) {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const loadHabits = useCallback(async () => {
    if (!userId || !supabase) return;
    setIsLoading(true);
    try {
      const [{ data: habitsData, error: habitsErr }, { data: completions, error: compErr }] =
        await Promise.all([
          supabase.from('habits').select('*').eq('user_id', userId).order('position'),
          supabase.from('habit_completions').select('habit_id, completed_date').eq('user_id', userId),
        ]);

      if (habitsErr) throw habitsErr;
      if (compErr) throw compErr;

      const todayDone = new Set(
        (completions ?? []).filter(c => c.completed_date === today).map(c => c.habit_id),
      );

      // Build sorted date lists per habit for streak calculation
      const byHabit = new Map<string, string[]>();
      for (const c of completions ?? []) {
        const arr = byHabit.get(c.habit_id) ?? [];
        arr.push(c.completed_date);
        byHabit.set(c.habit_id, arr);
      }

      const enriched: Habit[] = (habitsData ?? []).map(h => {
        const dates = new Set(byHabit.get(h.id) ?? []);
        let streak = 0;
        const d = new Date();
        for (let i = 0; i < 365; i++) {
          const dateStr = d.toISOString().slice(0, 10);
          if (dates.has(dateStr)) {
            streak++;
            d.setDate(d.getDate() - 1);
          } else {
            break;
          }
        }
        return {
          id: h.id,
          userId: h.user_id,
          title: h.title,
          frequency: h.frequency as 'daily' | 'weekly',
          position: h.position,
          createdAt: h.created_at,
          doneToday: todayDone.has(h.id),
          streak,
        };
      });

      setHabits(enriched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load habits');
    } finally {
      setIsLoading(false);
    }
  }, [userId, today]);

  useEffect(() => {
    loadHabits();
  }, [loadHabits]);

  const addHabit = useCallback(async (title: string, frequency: 'daily' | 'weekly' = 'daily') => {
    if (!userId || !supabase) return;
    const { error: err } = await supabase.from('habits').insert({
      user_id: userId,
      title: title.trim(),
      frequency,
      position: habits.length,
    });
    if (err) setError(err.message);
    else await loadHabits();
  }, [userId, habits.length, loadHabits]);

  const toggleToday = useCallback(async (habitId: string) => {
    if (!userId || !supabase) return;
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;

    // Optimistic update
    setHabits(prev => prev.map(h =>
      h.id === habitId
        ? { ...h, doneToday: !h.doneToday, streak: !h.doneToday ? h.streak + 1 : Math.max(0, h.streak - 1) }
        : h,
    ));

    if (habit.doneToday) {
      await supabase
        .from('habit_completions')
        .delete()
        .eq('habit_id', habitId)
        .eq('user_id', userId)
        .eq('completed_date', today);
    } else {
      await supabase.from('habit_completions').upsert({
        habit_id: habitId,
        user_id: userId,
        completed_date: today,
      });
    }
    // Reload to sync streak accurately
    await loadHabits();
  }, [userId, habits, today, loadHabits]);

  const deleteHabit = useCallback(async (habitId: string) => {
    if (!userId || !supabase) return;
    await supabase.from('habits').delete().eq('id', habitId).eq('user_id', userId);
    setHabits(prev => prev.filter(h => h.id !== habitId));
  }, [userId]);

  const clearError = useCallback(() => setError(null), []);

  return { habits, isLoading, error, clearError, addHabit, toggleToday, deleteHabit };
}
