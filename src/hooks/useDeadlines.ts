import { useState, useEffect, useCallback } from 'react';
import { Deadline, DeadlineSource, DeadlineStatus, DeadlineType } from '../types';
import { supabase } from '../lib/supabase';

interface DeadlineRow {
  id: string;
  project_id: string | null;
  title: string;
  status: string;
  type: string;
  due_date: string;
  due_time: string | null;
  notes: string;
  created_at: string;
  source_type?: string;
  source_id?: string | null;
  source_url?: string | null;
  source_synced_at?: string | null;
}

interface DeadlineTaskRow {
  deadline_id: string;
  task_id: string;
}

function mapDeadline(row: DeadlineRow, linkedTaskIds: string[] = []): Deadline {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    status: row.status as DeadlineStatus,
    type: row.type as DeadlineType,
    dueDate: row.due_date,
    dueTime: row.due_time,
    notes: row.notes,
    createdAt: row.created_at,
    linkedTaskIds,
    sourceType: (row.source_type as DeadlineSource) ?? 'manual',
    sourceId: row.source_id ?? null,
    sourceUrl: row.source_url ?? null,
    sourceSyncedAt: row.source_synced_at ?? null,
  };
}

const DEADLINE_SELECT = 'id, project_id, title, status, type, due_date, due_time, notes, created_at, source_type, source_id, source_url, source_synced_at';

export function useDeadlines(userId: string) {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const loadDeadlines = useCallback(async () => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [{ data: deadlineRows, error: dlError }, { data: linkRows, error: linkError }] = await Promise.all([
        supabase
          .from('deadlines')
          .select(DEADLINE_SELECT)
          .order('due_date', { ascending: true }),
        supabase
          .from('deadline_tasks')
          .select('deadline_id, task_id'),
      ]);

      if (dlError) throw dlError;
      if (linkError) throw linkError;

      const linksByDeadline = new Map<string, string[]>();
      for (const link of (linkRows ?? []) as DeadlineTaskRow[]) {
        const list = linksByDeadline.get(link.deadline_id) ?? [];
        list.push(link.task_id);
        linksByDeadline.set(link.deadline_id, list);
      }

      setDeadlines((deadlineRows ?? []).map((row: DeadlineRow) => mapDeadline(row, linksByDeadline.get(row.id) ?? [])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deadlines.');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadDeadlines();
  }, [loadDeadlines]);

  const addDeadline = useCallback(async (
    title: string,
    projectId: string | null,
    type: DeadlineType,
    dueDate: string,
    dueTime: string | null,
    notes: string,
    status: DeadlineStatus = 'not-started',
    source?: { sourceType: DeadlineSource; sourceId: string; sourceUrl?: string },
  ): Promise<boolean> => {
    if (!supabase) return false;
    setError(null);
    try {
      const row: Record<string, unknown> = {
        user_id: userId,
        project_id: projectId,
        title,
        status,
        type,
        due_date: dueDate,
        due_time: dueTime,
        notes,
      };
      if (source) {
        row.source_type = source.sourceType;
        row.source_id = source.sourceId;
        row.source_url = source.sourceUrl ?? null;
        row.source_synced_at = new Date().toISOString();
      }
      const { data, error: insertError } = await supabase
        .from('deadlines')
        .insert(row)
        .select(DEADLINE_SELECT)
        .single();

      if (insertError) throw insertError;

      setDeadlines(prev => {
        const next = [...prev, mapDeadline(data)];
        next.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        return next;
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add deadline.');
      return false;
    }
  }, [userId]);

  const updateDeadline = useCallback(async (
    id: string,
    updates: {
      title?: string;
      projectId?: string | null;
      status?: DeadlineStatus;
      type?: DeadlineType;
      dueDate?: string;
      dueTime?: string | null;
      notes?: string;
    },
  ): Promise<boolean> => {
    if (!supabase) return false;
    setError(null);
    try {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.title !== undefined) dbUpdates.title = updates.title;
      if (updates.projectId !== undefined) dbUpdates.project_id = updates.projectId;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.type !== undefined) dbUpdates.type = updates.type;
      if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate;
      if (updates.dueTime !== undefined) dbUpdates.due_time = updates.dueTime;
      if (updates.notes !== undefined) dbUpdates.notes = updates.notes;

      const { error: updateError } = await supabase
        .from('deadlines')
        .update(dbUpdates)
        .eq('id', id)
        .eq('user_id', userId);

      if (updateError) throw updateError;

      setDeadlines(prev => {
        const next = prev.map(d => d.id === id ? { ...d, ...updates } : d);
        next.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        return next;
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update deadline.');
      return false;
    }
  }, [userId]);

  const deleteDeadline = useCallback(async (id: string) => {
    if (!supabase) return;
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from('deadlines')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (deleteError) throw deleteError;

      setDeadlines(prev => prev.filter(d => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete deadline.');
    }
  }, [userId]);

  const deleteAllDeadlines = useCallback(async (): Promise<boolean> => {
    if (!supabase) return false;
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from('deadlines')
        .delete()
        .eq('user_id', userId);

      if (deleteError) throw deleteError;

      setDeadlines([]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete all deadlines.');
      return false;
    }
  }, [userId]);

  const linkTask = useCallback(async (deadlineId: string, taskId: string): Promise<boolean> => {
    if (!supabase) return false;
    setError(null);
    try {
      const { error: insertError } = await supabase
        .from('deadline_tasks')
        .insert({ deadline_id: deadlineId, task_id: taskId });

      if (insertError) throw insertError;

      setDeadlines(prev =>
        prev.map(d => d.id === deadlineId ? { ...d, linkedTaskIds: [...d.linkedTaskIds, taskId] } : d)
      );
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link task.');
      return false;
    }
  }, []);

  const unlinkTask = useCallback(async (deadlineId: string, taskId: string) => {
    if (!supabase) return;
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from('deadline_tasks')
        .delete()
        .eq('deadline_id', deadlineId)
        .eq('task_id', taskId);

      if (deleteError) throw deleteError;

      setDeadlines(prev =>
        prev.map(d => d.id === deadlineId ? { ...d, linkedTaskIds: d.linkedTaskIds.filter(id => id !== taskId) } : d)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlink task.');
    }
  }, []);

  return {
    deadlines,
    isLoading,
    error,
    clearError,
    loadDeadlines,
    addDeadline,
    updateDeadline,
    deleteDeadline,
    deleteAllDeadlines,
    linkTask,
    unlinkTask,
  };
}
