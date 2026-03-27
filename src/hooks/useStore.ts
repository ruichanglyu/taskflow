import { useState, useEffect, useCallback } from 'react';
import { Task, Project, Subtask, TaskComment, TaskStatus, Priority, Recurrence } from '../types';
import { supabase } from '../lib/supabase';

const PROJECT_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];

const STORAGE_KEY_TASKS = 'taskflow_tasks';
const STORAGE_KEY_PROJECTS = 'taskflow_projects';

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage<T>(key: string, data: T): void {
  localStorage.setItem(key, JSON.stringify(data));
}

function getStorageKey(baseKey: string, userId: string): string {
  return `${baseKey}:${userId}`;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  color: string;
  created_at: string;
  canvas_course_id?: string | null;
}

interface SubtaskRow {
  id: string;
  task_id: string;
  title: string;
  done: boolean;
  position: number;
}

interface CommentRow {
  id: string;
  task_id: string;
  text: string;
  created_at: string;
}

interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  project_id: string | null;
  created_at: string;
  due_date: string | null;
  recurrence?: string;
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    createdAt: row.created_at,
    canvasCourseId: row.canvas_course_id ?? null,
  };
}

function mapSubtask(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    done: row.done,
    position: row.position,
  };
}

function mapComment(row: CommentRow): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    text: row.text,
    createdAt: row.created_at,
  };
}

function mapTask(row: TaskRow, subtasks: Subtask[] = [], comments: TaskComment[] = []): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    projectId: row.project_id,
    createdAt: row.created_at,
    dueDate: row.due_date,
    recurrence: (row.recurrence as Recurrence) ?? 'none',
    subtasks,
    comments,
  };
}

function getStoredSnapshot<T>(baseKey: string, userId: string): T | null {
  const userScoped = loadFromStorage<T | null>(getStorageKey(baseKey, userId), null);
  if (userScoped !== null) {
    return userScoped;
  }

  return loadFromStorage<T | null>(baseKey, null);
}

// Seed data
const seedProjects: Project[] = [
  { id: 'p1', name: 'Website Redesign', description: 'Revamp the company website with modern design', color: '#6366f1', createdAt: new Date(Date.now() - 7 * 86400000).toISOString(), canvasCourseId: null },
  { id: 'p2', name: 'Mobile App', description: 'Build the React Native mobile application', color: '#ec4899', createdAt: new Date(Date.now() - 14 * 86400000).toISOString(), canvasCourseId: null },
  { id: 'p3', name: 'API Integration', description: 'Integrate third-party APIs and services', color: '#10b981', createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), canvasCourseId: null },
];

const seedTasks: Task[] = [
  { id: 't1', title: 'Design homepage mockup', description: 'Create wireframes and high-fidelity mockups for the new homepage', status: 'done', priority: 'high', projectId: 'p1', createdAt: new Date(Date.now() - 6 * 86400000).toISOString(), dueDate: new Date(Date.now() - 1 * 86400000).toISOString(), recurrence: 'none', subtasks: [], comments: [] },
  { id: 't2', title: 'Set up CI/CD pipeline', description: 'Configure GitHub Actions for automated testing and deployment', status: 'in-progress', priority: 'high', projectId: 'p1', createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), dueDate: new Date(Date.now() + 2 * 86400000).toISOString(), recurrence: 'none', subtasks: [], comments: [] },
  { id: 't3', title: 'User authentication flow', description: 'Implement login, signup, and password reset', status: 'in-progress', priority: 'high', projectId: 'p2', createdAt: new Date(Date.now() - 4 * 86400000).toISOString(), dueDate: new Date(Date.now() + 3 * 86400000).toISOString(), recurrence: 'none', subtasks: [], comments: [] },
  { id: 't4', title: 'Design system components', description: 'Build reusable UI components library', status: 'todo', priority: 'medium', projectId: 'p1', createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), dueDate: new Date(Date.now() + 5 * 86400000).toISOString(), recurrence: 'none', subtasks: [], comments: [] },
  { id: 't5', title: 'Payment gateway integration', description: 'Integrate Stripe for payment processing', status: 'todo', priority: 'high', projectId: 'p3', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), dueDate: new Date(Date.now() + 7 * 86400000).toISOString(), recurrence: 'none', subtasks: [], comments: [] },
  { id: 't6', title: 'Write unit tests', description: 'Add comprehensive test coverage for core modules', status: 'todo', priority: 'medium', projectId: 'p2', createdAt: new Date(Date.now() - 1 * 86400000).toISOString(), dueDate: new Date(Date.now() + 10 * 86400000).toISOString(), recurrence: 'none', subtasks: [], comments: [] },
  { id: 't7', title: 'Performance optimization', description: 'Audit and optimize page load times and bundle size', status: 'todo', priority: 'low', projectId: 'p1', createdAt: new Date().toISOString(), dueDate: null, recurrence: 'none', subtasks: [], comments: [] },
  { id: 't8', title: 'Push notifications', description: 'Implement push notification service for mobile', status: 'todo', priority: 'medium', projectId: 'p2', createdAt: new Date().toISOString(), dueDate: new Date(Date.now() + 14 * 86400000).toISOString(), recurrence: 'none', subtasks: [], comments: [] },
  { id: 't9', title: 'API documentation', description: 'Write comprehensive API docs with examples', status: 'done', priority: 'low', projectId: 'p3', createdAt: new Date(Date.now() - 10 * 86400000).toISOString(), dueDate: new Date(Date.now() - 3 * 86400000).toISOString(), recurrence: 'none', subtasks: [], comments: [] },
];

export function useStore(userId: string) {
  const taskStorageKey = getStorageKey(STORAGE_KEY_TASKS, userId);
  const projectStorageKey = getStorageKey(STORAGE_KEY_PROJECTS, userId);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const persistLocalSnapshot = useCallback((nextProjects: Project[], nextTasks: Task[]) => {
    saveToStorage(projectStorageKey, nextProjects);
    saveToStorage(taskStorageKey, nextTasks);
  }, [projectStorageKey, taskStorageKey]);

  const clearError = useCallback(() => setError(null), []);

  const loadData = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [{ data: projectRows, error: projectError }, { data: taskRows, error: taskError }, { data: subtaskRows, error: subtaskError }, { data: commentRows, error: commentError }] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name, description, color, created_at, canvas_course_id')
          .order('created_at', { ascending: false }),
        supabase
          .from('tasks')
          .select('id, title, description, status, priority, project_id, created_at, due_date, recurrence')
          .order('created_at', { ascending: false }),
        supabase
          .from('subtasks')
          .select('id, task_id, title, done, position')
          .order('position', { ascending: true }),
        supabase
          .from('task_comments')
          .select('id, task_id, text, created_at')
          .order('created_at', { ascending: true }),
      ]);

      if (projectError) throw projectError;
      if (taskError) throw taskError;
      if (subtaskError) throw subtaskError;
      if (commentError) throw commentError;

      const allSubtasks = (subtaskRows ?? []).map(mapSubtask);
      const subtasksByTask = new Map<string, Subtask[]>();
      for (const st of allSubtasks) {
        const list = subtasksByTask.get(st.taskId) ?? [];
        list.push(st);
        subtasksByTask.set(st.taskId, list);
      }

      const allComments = (commentRows ?? []).map(mapComment);
      const commentsByTask = new Map<string, TaskComment[]>();
      for (const c of allComments) {
        const list = commentsByTask.get(c.taskId) ?? [];
        list.push(c);
        commentsByTask.set(c.taskId, list);
      }

      let nextProjects = (projectRows ?? []).map(mapProject);
      let nextTasks = (taskRows ?? []).map(row => mapTask(row, subtasksByTask.get(row.id) ?? [], commentsByTask.get(row.id) ?? []));

      if (nextProjects.length === 0 && nextTasks.length === 0) {
        const storedProjects = getStoredSnapshot<Project[]>(STORAGE_KEY_PROJECTS, userId);
        const storedTasks = getStoredSnapshot<Task[]>(STORAGE_KEY_TASKS, userId);
        const legacyProjects = storedProjects ?? seedProjects;
        const legacyTasks = storedTasks ?? seedTasks;
        const projectIdMap = new Map<string, string>();

        if (legacyProjects.length > 0) {
          const { data: insertedProjects, error: importProjectError } = await supabase
            .from('projects')
            .insert(
              legacyProjects.map(project => ({
                user_id: userId,
                name: project.name,
                description: project.description,
                color: project.color,
                created_at: project.createdAt,
              }))
            )
            .select('id, name, description, color, created_at, canvas_course_id');

          if (importProjectError) throw importProjectError;

          legacyProjects.forEach((project, index) => {
            const insertedProject = insertedProjects?.[index];
            if (insertedProject) {
              projectIdMap.set(project.id, insertedProject.id);
            }
          });
        }

        if (legacyTasks.length > 0) {
          const { error: importTaskError } = await supabase.from('tasks').insert(
            legacyTasks.map(task => ({
              user_id: userId,
              project_id: task.projectId ? projectIdMap.get(task.projectId) ?? null : null,
              title: task.title,
              description: task.description,
              status: task.status,
              priority: task.priority,
              due_date: task.dueDate,
              created_at: task.createdAt,
            }))
          );

          if (importTaskError) throw importTaskError;
        }

        if (legacyProjects.length > 0 || legacyTasks.length > 0) {
          const [{ data: importedProjects, error: reloadedProjectError }, { data: importedTasks, error: reloadedTaskError }] = await Promise.all([
            supabase
              .from('projects')
              .select('id, name, description, color, created_at, canvas_course_id')
              .order('created_at', { ascending: false }),
            supabase
              .from('tasks')
              .select('id, title, description, status, priority, project_id, created_at, due_date')
              .order('created_at', { ascending: false }),
          ]);

          if (reloadedProjectError) throw reloadedProjectError;
          if (reloadedTaskError) throw reloadedTaskError;

          nextProjects = (importedProjects ?? []).map(mapProject);
          nextTasks = (importedTasks ?? []).map(row => mapTask(row));
        }
      }

      setProjects(nextProjects);
      setTasks(nextTasks);
      persistLocalSnapshot(nextProjects, nextTasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data from Supabase.');
    } finally {
      setIsLoading(false);
    }
  }, [persistLocalSnapshot, userId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const addTask = useCallback(async (title: string, description: string, priority: Priority, projectId: string | null, dueDate: string | null, recurrence: Recurrence = 'none'): Promise<string | null> => {
    if (!supabase) return null;

    setError(null);

    try {
      const { data, error: insertError } = await supabase
        .from('tasks')
        .insert({
          user_id: userId,
          title,
          description,
          status: 'todo',
          priority,
          project_id: projectId,
          due_date: dueDate,
          recurrence,
        })
        .select('id, title, description, status, priority, project_id, created_at, due_date, recurrence')
        .single();

      if (insertError) throw insertError;

      setTasks(prev => {
        const nextTasks = [mapTask(data), ...prev];
        persistLocalSnapshot(projects, nextTasks);
        return nextTasks;
      });
      return data.id as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task.');
      return null;
    }
  }, [persistLocalSnapshot, projects, userId]);

  const spawnNextRecurrence = useCallback(async (task: Task) => {
    if (!supabase || task.recurrence === 'none' || !task.dueDate) return;
    const due = new Date(task.dueDate);
    if (task.recurrence === 'daily') due.setDate(due.getDate() + 1);
    else if (task.recurrence === 'weekly') due.setDate(due.getDate() + 7);
    else if (task.recurrence === 'monthly') due.setMonth(due.getMonth() + 1);

    const { data, error: insertError } = await supabase
      .from('tasks')
      .insert({
        user_id: userId,
        title: task.title,
        description: task.description,
        status: 'todo',
        priority: task.priority,
        project_id: task.projectId,
        due_date: due.toISOString(),
        recurrence: task.recurrence,
      })
      .select('id, title, description, status, priority, project_id, created_at, due_date, recurrence')
      .single();

    if (!insertError && data) {
      setTasks(prev => {
        const nextTasks = [mapTask(data), ...prev];
        persistLocalSnapshot(projects, nextTasks);
        return nextTasks;
      });
    }
  }, [persistLocalSnapshot, projects, userId]);

  const updateTaskStatus = useCallback(async (id: string, status: TaskStatus) => {
    if (!supabase) return;

    setError(null);

    try {
      const task = tasks.find(t => t.id === id);
      const { error: updateError } = await supabase
        .from('tasks')
        .update({ status })
        .eq('id', id)
        .eq('user_id', userId);

      if (updateError) throw updateError;

      setTasks(prev => {
        const nextTasks = prev.map(t => t.id === id ? { ...t, status } : t);
        persistLocalSnapshot(projects, nextTasks);
        return nextTasks;
      });

      // Spawn next occurrence when recurring task is marked done
      if (status === 'done' && task && task.recurrence !== 'none') {
        await spawnNextRecurrence(task);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task.');
    }
  }, [persistLocalSnapshot, projects, tasks, userId, spawnNextRecurrence]);

  const updateTask = useCallback(async (id: string, updates: { title?: string; description?: string; priority?: Priority; projectId?: string | null; dueDate?: string | null; recurrence?: Recurrence }): Promise<boolean> => {
    if (!supabase) return false;

    setError(null);

    try {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.title !== undefined) dbUpdates.title = updates.title;
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.priority !== undefined) dbUpdates.priority = updates.priority;
      if (updates.projectId !== undefined) dbUpdates.project_id = updates.projectId;
      if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate;
      if (updates.recurrence !== undefined) dbUpdates.recurrence = updates.recurrence;

      const { error: updateError } = await supabase
        .from('tasks')
        .update(dbUpdates)
        .eq('id', id)
        .eq('user_id', userId);

      if (updateError) throw updateError;

      setTasks(prev => {
        const nextTasks = prev.map(task => task.id === id ? { ...task, ...updates } : task);
        persistLocalSnapshot(projects, nextTasks);
        return nextTasks;
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task.');
      return false;
    }
  }, [persistLocalSnapshot, projects, userId]);

  const deleteTask = useCallback(async (id: string): Promise<boolean> => {
    if (!supabase) return false;

    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('tasks')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (deleteError) throw deleteError;

      setTasks(prev => {
        const nextTasks = prev.filter(task => task.id !== id);
        persistLocalSnapshot(projects, nextTasks);
        return nextTasks;
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task.');
      return false;
    }
  }, [persistLocalSnapshot, projects, userId]);

  const addProject = useCallback(async (name: string, description: string): Promise<string | null> => {
    if (!supabase) return null;

    setError(null);

    try {
      const { data, error: insertError } = await supabase
        .from('projects')
        .insert({
          user_id: userId,
          name,
          description,
          color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
        })
        .select('id, name, description, color, created_at, canvas_course_id')
        .single();

      if (insertError) throw insertError;

      setProjects(prev => {
        const nextProjects = [mapProject(data), ...prev];
        persistLocalSnapshot(nextProjects, tasks);
        return nextProjects;
      });
      return data.id as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project.');
      return null;
    }
  }, [persistLocalSnapshot, projects.length, tasks, userId]);

  const deleteProject = useCallback(async (id: string) => {
    if (!supabase) return;

    setError(null);

    try {
      const { error: orphanError } = await supabase
        .from('tasks')
        .update({ project_id: null })
        .eq('project_id', id)
        .eq('user_id', userId);

      if (orphanError) throw orphanError;

      const { error: deleteError } = await supabase
        .from('projects')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (deleteError) throw deleteError;

      setProjects(prev => {
        const nextProjects = prev.filter(project => project.id !== id);
        setTasks(currentTasks => {
          const nextTasks = currentTasks.map(task => task.projectId === id ? { ...task, projectId: null } : task);
          persistLocalSnapshot(nextProjects, nextTasks);
          return nextTasks;
        });
        return nextProjects;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project.');
    }
  }, [persistLocalSnapshot, userId]);

  const addSubtask = useCallback(async (taskId: string, title: string): Promise<boolean> => {
    if (!supabase) return false;
    setError(null);
    try {
      const task = tasks.find(t => t.id === taskId);
      const position = task ? task.subtasks.length : 0;
      const { data, error: insertError } = await supabase
        .from('subtasks')
        .insert({ task_id: taskId, user_id: userId, title, position })
        .select('id, task_id, title, done, position')
        .single();
      if (insertError) throw insertError;
      setTasks(prev => {
        const nextTasks = prev.map(t =>
          t.id === taskId ? { ...t, subtasks: [...t.subtasks, mapSubtask(data)] } : t
        );
        persistLocalSnapshot(projects, nextTasks);
        return nextTasks;
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add subtask.');
      return false;
    }
  }, [persistLocalSnapshot, projects, tasks, userId]);

  const toggleSubtask = useCallback(async (subtaskId: string, done: boolean) => {
    if (!supabase) return;
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from('subtasks')
        .update({ done })
        .eq('id', subtaskId)
        .eq('user_id', userId);
      if (updateError) throw updateError;
      setTasks(prev => {
        const nextTasks = prev.map(t => ({
          ...t,
          subtasks: t.subtasks.map(st => st.id === subtaskId ? { ...st, done } : st),
        }));
        persistLocalSnapshot(projects, nextTasks);
        return nextTasks;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update subtask.');
    }
  }, [persistLocalSnapshot, projects, userId]);

  const deleteSubtask = useCallback(async (subtaskId: string) => {
    if (!supabase) return;
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from('subtasks')
        .delete()
        .eq('id', subtaskId)
        .eq('user_id', userId);
      if (deleteError) throw deleteError;
      setTasks(prev => {
        const nextTasks = prev.map(t => ({
          ...t,
          subtasks: t.subtasks.filter(st => st.id !== subtaskId),
        }));
        persistLocalSnapshot(projects, nextTasks);
        return nextTasks;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete subtask.');
    }
  }, [persistLocalSnapshot, projects, userId]);

  const addComment = useCallback(async (taskId: string, text: string): Promise<boolean> => {
    if (!supabase) return false;
    setError(null);
    try {
      const { data, error: insertError } = await supabase
        .from('task_comments')
        .insert({ task_id: taskId, user_id: userId, text })
        .select('id, task_id, text, created_at')
        .single();
      if (insertError) throw insertError;
      setTasks(prev => {
        const nextTasks = prev.map(t =>
          t.id === taskId ? { ...t, comments: [...t.comments, mapComment(data)] } : t
        );
        persistLocalSnapshot(projects, nextTasks);
        return nextTasks;
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add comment.');
      return false;
    }
  }, [persistLocalSnapshot, projects, userId]);

  const deleteComment = useCallback(async (commentId: string) => {
    if (!supabase) return;
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from('task_comments')
        .delete()
        .eq('id', commentId)
        .eq('user_id', userId);
      if (deleteError) throw deleteError;
      setTasks(prev => {
        const nextTasks = prev.map(t => ({
          ...t,
          comments: t.comments.filter(c => c.id !== commentId),
        }));
        persistLocalSnapshot(projects, nextTasks);
        return nextTasks;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete comment.');
    }
  }, [persistLocalSnapshot, projects, userId]);

  const updateTaskDueDate = useCallback(async (id: string, dueDate: string | null): Promise<boolean> => {
    if (!supabase) return false;
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from('tasks')
        .update({ due_date: dueDate })
        .eq('id', id)
        .eq('user_id', userId);
      if (updateError) throw updateError;
      setTasks(prev => {
        const nextTasks = prev.map(task => task.id === id ? { ...task, dueDate } : task);
        persistLocalSnapshot(projects, nextTasks);
        return nextTasks;
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update due date.');
      return false;
    }
  }, [persistLocalSnapshot, projects, userId]);

  return { tasks, projects, isLoading, error, clearError, loadData, addTask, updateTask, updateTaskStatus, deleteTask, addProject, deleteProject, addSubtask, toggleSubtask, deleteSubtask, addComment, deleteComment, updateTaskDueDate };
}
