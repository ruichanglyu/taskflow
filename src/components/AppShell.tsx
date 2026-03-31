import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { LogOut, Menu, Search, CheckCircle2, AlertCircle, X, Sparkles, CheckCheck } from 'lucide-react';
import { User } from '@supabase/supabase-js';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { View } from '../types';
import { cn } from '../utils/cn';
import { useStore } from '../hooks/useStore';
import { useDeadlines } from '../hooks/useDeadlines';
import { useCanvas } from '../hooks/useCanvas';
import { useNotifications } from '../hooks/useNotifications';
import { Sidebar } from './Sidebar';
import { Dashboard } from './Dashboard';
import { DeadlinesPage } from './DeadlinesPage';
import { TaskBoard } from './TaskBoard';
import { ProjectList } from './ProjectList';
import { CalendarView } from './CalendarView';
import { TimelineView } from './TimelineView';
import { GlobalSearch } from './GlobalSearch';
import { CanvasConnect } from './CanvasConnect';
import { GymPage } from './GymPage';
import { useGym } from '../hooks/useGym';
import { supabase } from '../lib/supabase';
import { ThemeSwitcher } from './ThemeSwitcher';
import { ProfileModal } from './ProfileModal';
import { AIPanel } from './AIPanel';
import { HabitsPanel } from './HabitsPanel';
import { AuthOnboarding } from './AuthOnboarding';
import { migrateLegacyAIData } from '../hooks/useAI';
import { useHabits } from '../hooks/useHabits';
import { useGoogleCalendar } from '../hooks/useGoogleCalendar';
import { useBehaviorLearning, type BehaviorLearningActionOptions } from '../hooks/useBehaviorLearning';
import { useStudyBlockOutcomes } from '../hooks/useStudyBlockOutcomes';
import type { StudyBlockOutcomeStatus } from '../types';

interface AppShellProps {
  user: User;
}

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

function isBehaviorLearningActionOptions(value: unknown): value is BehaviorLearningActionOptions {
  return Boolean(value) && typeof value === 'object' && ('source' in (value as object) || 'learn' in (value as object));
}

const VIEW_PATHS: Record<View, string> = {
  dashboard: '/dashboard',
  deadlines: '/deadlines',
  tasks: '/tasks',
  projects: '/courses',
  calendar: '/calendar',
  timeline: '/timeline',
  gym: '/gym',
};

function getViewFromPath(pathname: string): View {
  if (pathname === '/deadlines') return 'deadlines';
  if (pathname === '/tasks') return 'tasks';
  if (pathname === '/courses') return 'projects';
  if (pathname === '/calendar') return 'calendar';
  if (pathname === '/timeline') return 'timeline';
  if (pathname === '/gym') return 'gym';
  return 'dashboard';
}

export function AppShell({ user }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentView = getViewFromPath(location.pathname);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState<boolean>(() => {
    const stored = window.localStorage.getItem('taskflow_sidebar_collapsed');
    return stored ? stored === 'true' : true;
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileInitialTab, setProfileInitialTab] = useState<'profile' | 'preferences' | 'data'>('profile');
  const [preferenceSetupOpen, setPreferenceSetupOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMode, setAiMode] = useState<'floating' | 'sidebar'>(() => {
    const stored = window.localStorage.getItem('taskflow_ai_panel_mode');
    return stored === 'sidebar' ? 'sidebar' : 'floating';
  });
  const [queuedAiPrompt, setQueuedAiPrompt] = useState<string | null>(null);
  const [habitsOpen, setHabitsOpen] = useState(false);
  const habitsButtonRef = useRef<HTMLButtonElement>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Migrate legacy AI data (global keys/chats) to this user on first load
  useState(() => { migrateLegacyAIData(user.id); });
  const store = useStore(user.id);
  const deadlineStore = useDeadlines(user.id);
  const canvasStore = useCanvas(user.id, store.projects);
  const gym = useGym(user.id);
  const calendar = useGoogleCalendar(user.id);
  const learning = useBehaviorLearning(user.id);
  const studyBlockOutcomes = useStudyBlockOutcomes(user.id);
  const { requestPermission } = useNotifications(store.tasks);
  const habits = useHabits(user.id);
  const searchParams = new URLSearchParams(location.search);
  const projectFocusId = searchParams.get('project');
  const deadlineCourseFilterId = searchParams.get('course');
  const deadlineFocusId = searchParams.get('deadline');
  const taskProjectFilterId = searchParams.get('project') ?? 'all';
  const openAiWithPrompt = useCallback((prompt: string) => {
    setQueuedAiPrompt(prompt);
    setAiOpen(true);
  }, []);

  const openAiPanel = useCallback(() => {
    learning.logAiPanelOpened({ source: 'manual', learn: true });
    setAiOpen(true);
  }, [learning]);

  const pushToast = useCallback((tone: ToastTone, title: string, message?: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts(prev => [...prev, { id, tone, title, message }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  // After Canvas sync, reload deadlines + projects
  const handleCanvasSync = async () => {
    const result = await canvasStore.sync();
    if (result) {
      await Promise.all([deadlineStore.loadDeadlines(), store.loadData()]);
      pushToast('success', 'Canvas sync complete', 'Courses and deadlines were refreshed.');
    } else {
      pushToast('error', 'Canvas sync failed', canvasStore.error ?? 'Please check your Canvas connection and try again.');
    }
  };

  // Request notification permission on first load
  useEffect(() => {
    requestPermission();
  }, [requestPermission]);

  // Global keyboard shortcut: Cmd/Ctrl+K for search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    window.localStorage.setItem('taskflow_sidebar_collapsed', String(desktopSidebarCollapsed));
  }, [desktopSidebarCollapsed]);

  useEffect(() => {
    window.localStorage.setItem('taskflow_ai_panel_mode', aiMode);
  }, [aiMode]);

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  // Force refresh user session after profile updates
  const handleUserUpdated = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.refreshSession();
  }, []);

  const navigateInApp = useCallback((to: string) => {
    if (location.pathname + location.search === to) return;
    navigate(to);
  }, [location.pathname, location.search, navigate]);

  const handleViewChange = useCallback((view: View) => {
    navigateInApp(VIEW_PATHS[view]);
  }, [navigateInApp]);

  const openCourse = useCallback((projectId: string) => {
    navigateInApp(`/courses?project=${encodeURIComponent(projectId)}`);
  }, [navigateInApp]);

  const openCourseTasks = useCallback((projectId: string) => {
    navigateInApp(`/tasks?project=${encodeURIComponent(projectId)}`);
  }, [navigateInApp]);

  const openCourseDeadlines = useCallback((projectId: string) => {
    navigateInApp(`/deadlines?course=${encodeURIComponent(projectId)}`);
  }, [navigateInApp]);

  const openDeadline = useCallback((deadlineId: string) => {
    const deadline = deadlineStore.deadlines.find(item => item.id === deadlineId);
    const params = new URLSearchParams();
    params.set('deadline', deadlineId);
    if (deadline?.projectId) params.set('course', deadline.projectId);
    navigateInApp(`/deadlines?${params.toString()}`);
  }, [deadlineStore.deadlines, navigateInApp]);

  useEffect(() => {
    learning.logViewOpened(currentView, { source: 'manual', learn: true });
  }, [currentView, learning.logViewOpened]);

  const handleAddDeadline = useCallback(async (...args: [...Parameters<typeof deadlineStore.addDeadline>, BehaviorLearningActionOptions?]) => {
    const lastArg = args.at(-1);
    const options = isBehaviorLearningActionOptions(lastArg) ? lastArg : { source: 'manual', learn: true };
    const baseArgs = (isBehaviorLearningActionOptions(lastArg) ? args.slice(0, -1) : args) as Parameters<typeof deadlineStore.addDeadline>;
    const ok = await deadlineStore.addDeadline(...baseArgs);
    if (ok) {
      pushToast('success', 'Deadline added', 'Your deadline was added to the tracker.');
      const [title, projectId, type, dueDate, dueTime, , status] = baseArgs;
      learning.logDeadlineCreated({
        title,
        projectId,
        dueDate,
        dueTime,
        type,
        status,
        options,
      });
    } else {
      pushToast('error', 'Could not add deadline', deadlineStore.error ?? 'Please try again.');
    }
    return ok;
  }, [deadlineStore, learning, pushToast]);

  const handleUpdateDeadline = useCallback(async (...args: Parameters<typeof deadlineStore.updateDeadline>) => {
    const [id, updates] = args;
    const currentDeadline = deadlineStore.deadlines.find(item => item.id === id);
    const ok = await deadlineStore.updateDeadline(...args);
    if (ok) {
      pushToast('success', 'Deadline updated');
      if (currentDeadline) {
        learning.logDeadlineUpdated({
          title: updates.title ?? currentDeadline.title,
          projectId: updates.projectId ?? currentDeadline.projectId,
          dueDate: updates.dueDate ?? currentDeadline.dueDate,
          dueTime: updates.dueTime ?? currentDeadline.dueTime,
          type: updates.type ?? currentDeadline.type,
          status: updates.status ?? currentDeadline.status,
          options: { source: 'manual', learn: true },
        });
      }
    } else {
      pushToast('error', 'Could not update deadline', deadlineStore.error ?? 'Please try again.');
    }
    return ok;
  }, [deadlineStore, learning, pushToast]);

  const handleDeleteDeadline = useCallback(async (id: string, _options?: BehaviorLearningActionOptions) => {
    const currentDeadline = deadlineStore.deadlines.find(item => item.id === id);
    await deadlineStore.deleteDeadline(id);
    if (!deadlineStore.error) {
      pushToast('success', 'Deadline deleted');
      if (currentDeadline) {
        learning.logDeadlineDeleted({
          title: currentDeadline.title,
          projectId: currentDeadline.projectId,
          dueDate: currentDeadline.dueDate,
          dueTime: currentDeadline.dueTime,
          type: currentDeadline.type,
          status: currentDeadline.status,
          options: { source: 'manual', learn: true },
        });
      }
    } else {
      pushToast('error', 'Could not delete deadline', deadlineStore.error);
    }
  }, [deadlineStore, learning, pushToast]);

  const handleDeleteAllDeadlines = useCallback(async () => {
    const ok = await deadlineStore.deleteAllDeadlines();
    if (ok) {
      pushToast('success', 'All deadlines deleted');
    } else {
      pushToast('error', 'Could not delete deadlines', deadlineStore.error ?? 'Please try again.');
    }
    return ok;
  }, [deadlineStore, pushToast]);

  const handleLinkTask = useCallback(async (...args: [...Parameters<typeof deadlineStore.linkTask>, BehaviorLearningActionOptions?]) => {
    const lastArg = args.at(-1);
    const options = isBehaviorLearningActionOptions(lastArg) ? lastArg : { source: 'manual', learn: true };
    const baseArgs = (isBehaviorLearningActionOptions(lastArg) ? args.slice(0, -1) : args) as Parameters<typeof deadlineStore.linkTask>;
    const [deadlineId, taskId] = baseArgs;
    const ok = await deadlineStore.linkTask(...baseArgs);
    if (ok) {
      pushToast('success', 'Task linked', 'This deadline is now connected to a task.');
      const deadline = deadlineStore.deadlines.find(item => item.id === deadlineId);
      const task = store.tasks.find(item => item.id === taskId);
      if (deadline && task) {
        learning.logDeadlineLinked({
          deadlineTitle: deadline.title,
          taskTitle: task.title,
          options,
        });
      }
    } else {
      pushToast('error', 'Could not link task', deadlineStore.error ?? 'Please try again.');
    }
    return ok;
  }, [deadlineStore, learning, pushToast, store.tasks]);

  const handleUnlinkTask = useCallback(async (...args: Parameters<typeof deadlineStore.unlinkTask>) => {
    const [deadlineId, taskId] = args;
    const deadline = deadlineStore.deadlines.find(item => item.id === deadlineId);
    const task = store.tasks.find(item => item.id === taskId);
    await deadlineStore.unlinkTask(...args);
    if (!deadlineStore.error) {
      pushToast('info', 'Task unlinked');
      if (deadline && task) {
        learning.logDeadlineUnlinked({
          deadlineTitle: deadline.title,
          taskTitle: task.title,
          options: { source: 'manual', learn: true },
        });
      }
    } else {
      pushToast('error', 'Could not unlink task', deadlineStore.error);
    }
  }, [deadlineStore, learning, pushToast, store.tasks]);

  const handleAddTask = useCallback(async (...args: [...Parameters<typeof store.addTask>, BehaviorLearningActionOptions?]) => {
    const lastArg = args.at(-1);
    const options = isBehaviorLearningActionOptions(lastArg) ? lastArg : undefined;
    const baseArgs = (options ? args.slice(0, -1) : args) as Parameters<typeof store.addTask>;
    const taskId = await store.addTask(...baseArgs);
    if (taskId) {
      pushToast('success', 'Task created');
      const [title, , , projectId, dueDate, , status] = baseArgs;
      learning.logTaskCreated({
        title,
        projectId,
        dueDate,
        status,
        options,
      });
    } else {
      pushToast('error', 'Could not create task', store.error ?? 'Please try again.');
    }
    return taskId;
  }, [learning, store, pushToast]);

  const handleUpdateTask = useCallback(async (...args: [...Parameters<typeof store.updateTask>, BehaviorLearningActionOptions?]) => {
    const lastArg = args.at(-1);
    const options = isBehaviorLearningActionOptions(lastArg) ? lastArg : undefined;
    const baseArgs = (options ? args.slice(0, -1) : args) as Parameters<typeof store.updateTask>;
    const [taskId, updates] = baseArgs;
    const currentTask = store.tasks.find(task => task.id === taskId);
    const ok = await store.updateTask(...baseArgs);
    if (ok) {
      pushToast('success', 'Task updated');
      if (currentTask) {
        learning.logTaskUpdated({
          title: updates.title ?? currentTask.title,
          projectId: updates.projectId ?? currentTask.projectId,
          dueDate: updates.dueDate ?? currentTask.dueDate,
          status: updates.status ?? currentTask.status,
          options,
        });
      }
    } else {
      pushToast('error', 'Could not update task', store.error ?? 'Please try again.');
    }
    return ok;
  }, [learning, store, pushToast]);

  const handleUpdateTaskStatus = useCallback(async (id: string, status: Parameters<typeof store.updateTaskStatus>[1]) => {
    const currentTask = store.tasks.find(task => task.id === id);
    await store.updateTaskStatus(id, status);
    if (!store.error && currentTask) {
      learning.logTaskStatusChanged({
        title: currentTask.title,
        projectId: currentTask.projectId,
        dueDate: currentTask.dueDate,
        previousStatus: currentTask.status,
        nextStatus: status,
        options: { source: 'manual', learn: true },
      });
      learning.logTaskUpdated({
        title: currentTask.title,
        projectId: currentTask.projectId,
        dueDate: currentTask.dueDate,
        status,
        options: { source: 'manual', learn: true },
      });
    }
  }, [learning, store]);

  const handleDeleteTask = useCallback(async (id: string, options: BehaviorLearningActionOptions = { source: 'manual', learn: true }) => {
    const currentTask = store.tasks.find(task => task.id === id);
    const ok = await store.deleteTask(id);
    if (ok) {
      pushToast('success', 'Task deleted');
      if (currentTask) {
        learning.logTaskDeleted({
          title: currentTask.title,
          projectId: currentTask.projectId,
          dueDate: currentTask.dueDate,
          status: currentTask.status,
          options,
        });
      }
    } else {
      pushToast('error', 'Could not delete task', store.error ?? 'Please try again.');
    }
    return ok;
  }, [learning, store, pushToast]);

  const handleAddProject = useCallback(async (...args: [...Parameters<typeof store.addProject>, BehaviorLearningActionOptions?]) => {
    const lastArg = args.at(-1);
    const options = isBehaviorLearningActionOptions(lastArg) ? lastArg : { source: 'manual', learn: true };
    const baseArgs = (isBehaviorLearningActionOptions(lastArg) ? args.slice(0, -1) : args) as Parameters<typeof store.addProject>;
    const projectId = await store.addProject(...baseArgs);
    if (projectId) {
      pushToast('success', 'Course created');
      const [name, description] = baseArgs;
      learning.logProjectCreated({ name, description, options });
    } else {
      pushToast('error', 'Could not create course', store.error ?? 'Please try again.');
    }
    return projectId;
  }, [learning, store, pushToast]);

  const handleAddSubtask = useCallback(async (
    taskId: string,
    title: string,
    _options?: BehaviorLearningActionOptions,
  ) => {
    const task = store.tasks.find(item => item.id === taskId);
    const ok = await store.addSubtask(taskId, title);
    if (ok && task) {
      learning.logTaskSubtaskCreated({
        taskTitle: task.title,
        subtaskTitle: title,
        projectId: task.projectId,
        dueDate: task.dueDate,
        options: { source: 'manual', learn: true },
      });
    }
    return ok;
  }, [learning, store]);

  const handleToggleSubtask = useCallback(async (subtaskId: string, done: boolean) => {
    const task = store.tasks.find(item => item.subtasks.some(subtask => subtask.id === subtaskId));
    const subtask = task?.subtasks.find(item => item.id === subtaskId);
    await store.toggleSubtask(subtaskId, done);
    if (!store.error && task && subtask) {
      learning.logTaskSubtaskToggled({
        taskTitle: task.title,
        subtaskTitle: subtask.title,
        projectId: task.projectId,
        dueDate: task.dueDate,
        done,
        options: { source: 'manual', learn: true },
      });
    }
  }, [learning, store]);

  const handleDeleteSubtask = useCallback(async (subtaskId: string) => {
    const task = store.tasks.find(item => item.subtasks.some(subtask => subtask.id === subtaskId));
    const subtask = task?.subtasks.find(item => item.id === subtaskId);
    await store.deleteSubtask(subtaskId);
    if (!store.error && task && subtask) {
      learning.logTaskSubtaskDeleted({
        taskTitle: task.title,
        subtaskTitle: subtask.title,
        projectId: task.projectId,
        dueDate: task.dueDate,
        options: { source: 'manual', learn: true },
      });
    }
  }, [learning, store]);

  const handleAddComment = useCallback(async (taskId: string, text: string): Promise<boolean> => {
    const task = store.tasks.find(item => item.id === taskId);
    const ok = await store.addComment(taskId, text);
    if (ok && task) {
      learning.logTaskCommentAdded({
        taskTitle: task.title,
        projectId: task.projectId,
        dueDate: task.dueDate,
        commentPreview: text.trim().slice(0, 80),
        options: { source: 'manual', learn: true },
      });
    }
    return ok;
  }, [learning, store]);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    const task = store.tasks.find(item => item.comments.some(comment => comment.id === commentId));
    const comment = task?.comments.find(item => item.id === commentId);
    await store.deleteComment(commentId);
    if (!store.error && task && comment) {
      learning.logTaskCommentDeleted({
        taskTitle: task.title,
        projectId: task.projectId,
        dueDate: task.dueDate,
        commentPreview: comment.text.trim().slice(0, 80),
        options: { source: 'manual', learn: true },
      });
    }
  }, [learning, store]);

  const handleUpdateTaskDueDate = useCallback(async (id: string, dueDate: string | null): Promise<boolean> => {
    const task = store.tasks.find(item => item.id === id);
    const ok = await store.updateTaskDueDate(id, dueDate);
    if (ok && task) {
      learning.logTaskDueDateChanged({
        title: task.title,
        projectId: task.projectId,
        previousDueDate: task.dueDate,
        nextDueDate: dueDate,
        status: task.status,
        options: { source: 'manual', learn: true },
      });
    }
    return ok;
  }, [learning, store]);

  const handleSetStudyBlockOutcome = useCallback(async (
    event: Parameters<typeof studyBlockOutcomes.setOutcome>[0],
    status: StudyBlockOutcomeStatus,
  ) => {
    const previousStatus = studyBlockOutcomes.getOutcomeForEvent(event)?.status;
    const ok = await studyBlockOutcomes.setOutcome(event, status);
    const start = event.start?.dateTime ? new Date(event.start.dateTime) : null;
    const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
    const startMinutes = start ? start.getHours() * 60 + start.getMinutes() : null;
    const durationMinutes = start && end ? Math.max(Math.round((end.getTime() - start.getTime()) / 60000), 0) : null;
    if (ok && previousStatus !== status) {
      learning.logStudyBlockOutcome({
        title: event.summary ?? 'Untitled event',
        calendarSummary: event.calendarSummary ?? null,
        dateKey: event.start?.date ?? (event.start?.dateTime ? event.start.dateTime.slice(0, 10) : ''),
        startMinutes: startMinutes ?? 0,
        durationMinutes: durationMinutes ?? 0,
        status,
        options: { source: 'manual', learn: true },
      });
    }
    return ok;
  }, [learning, studyBlockOutcomes]);

  const handleDeleteProject = useCallback(async (id: string, options?: BehaviorLearningActionOptions) => {
    const currentProject = store.projects.find(item => item.id === id);
    await store.deleteProject(id);
    if (!store.error) {
      pushToast('success', 'Course deleted');
      if (currentProject) {
        learning.logProjectDeleted({
          name: currentProject.name,
          description: currentProject.description,
          options,
        });
      }
    } else {
      pushToast('error', 'Could not delete course', store.error);
    }
  }, [learning, store, pushToast]);

  const handleUpdateProject = useCallback(async (id: string, updates: { name?: string; description?: string; color?: string }) => {
    const currentProject = store.projects.find(item => item.id === id);
    const ok = await store.updateProject(id, updates);
    if (!ok) {
      pushToast('error', 'Could not update course', store.error ?? 'Please try again.');
      return false;
    }

    if (currentProject) {
      learning.logProjectUpdated({
        name: updates.name ?? currentProject.name,
        description: updates.description ?? currentProject.description,
        color: updates.color ?? currentProject.color,
        options: { source: 'manual', learn: true },
      });
    }

    pushToast('success', updates.color ? 'Course color updated' : 'Course updated');
    return true;
  }, [store, pushToast, learning]);

  const handleAddHabit = useCallback(async (
    title: string,
    frequency: 'daily' | 'weekly' = 'daily',
    options: BehaviorLearningActionOptions = { source: 'manual', learn: true },
  ) => {
    const ok = await habits.addHabit(title, frequency);
    if (ok) {
      learning.logHabitCreated({ title, frequency, options });
    }
  }, [habits, learning]);

  const handleToggleHabit = useCallback(async (
    id: string,
    options: BehaviorLearningActionOptions = { source: 'manual', learn: true },
  ) => {
    const currentHabit = habits.habits.find(item => item.id === id);
    const ok = await habits.toggleToday(id);
    if (currentHabit && ok) {
      learning.logHabitToggled({
        title: currentHabit.title,
        completed: !currentHabit.doneToday,
        options,
      });
    }
  }, [habits, learning]);

  const handleDeleteHabit = useCallback(async (
    id: string,
    options: BehaviorLearningActionOptions = { source: 'manual', learn: true },
  ) => {
    const currentHabit = habits.habits.find(item => item.id === id);
    const ok = await habits.deleteHabit(id);
    if (currentHabit && ok) {
      learning.logHabitDeleted({
        title: currentHabit.title,
        options,
      });
    }
  }, [habits, learning]);

  const handleCreateCalendarEvent = useCallback(async (
    event: Parameters<typeof calendar.createEvent>[0],
    calendarIdOverride?: Parameters<typeof calendar.createEvent>[1],
    options?: BehaviorLearningActionOptions,
  ) => {
    const ok = await calendar.createEvent(event, calendarIdOverride);
    if (ok) {
      const calendarId = calendarIdOverride || calendar.selectedCalendarId;
      const calendarSummary = calendar.calendars.find(item => item.id === calendarId)?.summary ?? null;
      learning.logCalendarCreated(event, calendarSummary, options);
    }
    return ok;
  }, [calendar, learning]);

  const handleUpdateCalendarEvent = useCallback(async (
    eventId: string,
    event: Parameters<typeof calendar.updateEvent>[1],
    calendarIdOverride?: Parameters<typeof calendar.updateEvent>[2],
    options?: BehaviorLearningActionOptions,
    existingEventOverride?: Parameters<typeof learning.logCalendarUpdated>[0],
  ) => {
    const existingEvent = existingEventOverride
      ?? calendar.events.find(item => item.id === eventId && (!calendarIdOverride || item.calendarId === calendarIdOverride));
    const ok = await calendar.updateEvent(eventId, event, calendarIdOverride, existingEvent);
    if (ok && existingEvent) {
      const calendarId = calendarIdOverride || existingEvent.calendarId || calendar.selectedCalendarId;
      const calendarSummary = calendar.calendars.find(item => item.id === calendarId)?.summary ?? existingEvent.calendarSummary ?? null;
      learning.logCalendarUpdated(existingEvent, event, calendarSummary, options);
    }
    return ok;
  }, [calendar, learning]);

  const handleDeleteCalendarEvent = useCallback(async (
    eventId: string,
    calendarIdOverride?: Parameters<typeof calendar.deleteEvent>[1],
    options?: BehaviorLearningActionOptions,
    existingEventOverride?: Parameters<typeof learning.logCalendarDeleted>[0],
  ) => {
    const existingEvent = existingEventOverride
      ?? calendar.events.find(item => item.id === eventId && (!calendarIdOverride || item.calendarId === calendarIdOverride));
    const ok = await calendar.deleteEvent(eventId, calendarIdOverride);
    if (ok && existingEvent) {
      learning.logCalendarDeleted(existingEvent, options);
    }
    return ok;
  }, [calendar, learning]);

  const calendarController = useMemo(() => ({
    ...calendar,
    createEvent: (event: Parameters<typeof calendar.createEvent>[0], calendarIdOverride?: Parameters<typeof calendar.createEvent>[1]) =>
      handleCreateCalendarEvent(event, calendarIdOverride, { source: 'manual', learn: true }),
    updateEvent: (
      eventId: string,
      event: Parameters<typeof calendar.updateEvent>[1],
      calendarIdOverride?: Parameters<typeof calendar.updateEvent>[2],
      existingEventOverride?: Parameters<typeof learning.logCalendarUpdated>[0],
    ) =>
      handleUpdateCalendarEvent(eventId, event, calendarIdOverride, { source: 'manual', learn: true }, existingEventOverride),
    deleteEvent: (eventId: string, calendarIdOverride?: Parameters<typeof calendar.deleteEvent>[1]) =>
      handleDeleteCalendarEvent(eventId, calendarIdOverride, { source: 'manual', learn: true }),
  }), [calendar, handleCreateCalendarEvent, handleDeleteCalendarEvent, handleUpdateCalendarEvent]);

  const showBackgroundSyncBanner = store.isLoading && (store.tasks.length > 0 || store.projects.length > 0);

  return (
    <div className="flex h-screen overflow-y-hidden bg-[var(--bg-app)] text-[var(--text-primary)]">
      <Sidebar
        currentView={currentView}
        onViewChange={handleViewChange}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        userEmail={user.email}
        userName={user.user_metadata.full_name}
        avatarUrl={user.user_metadata.avatar_url}
        canvasConnected={!!canvasStore.connection}
        onCanvasClick={() => { setSidebarOpen(false); setCanvasOpen(true); }}
        onProfileClick={() => { setSidebarOpen(false); setProfileInitialTab('profile'); setProfileOpen(true); }}
        desktopCollapsed={desktopSidebarCollapsed}
        onToggleDesktopCollapse={() => setDesktopSidebarCollapsed(prev => !prev)}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--border-soft)] bg-[var(--bg-app)] px-4 py-3 sm:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] lg:hidden"
          >
            <Menu size={20} />
          </button>

          {/* Search trigger */}
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden items-center gap-2 rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-sm text-[var(--text-faint)] transition hover:border-[var(--border-strong)] sm:flex"
          >
            <Search size={14} />
            <span>Search...</span>
            <kbd className="ml-4 rounded border border-[var(--border-soft)] bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-faint)]">⌘K</kbd>
          </button>

          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <button
              ref={habitsButtonRef}
              onClick={() => setHabitsOpen(prev => !prev)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                habitsOpen
                  ? 'bg-[var(--surface-muted)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]'
              )}
              title="Routines"
            >
              <CheckCheck size={16} />
              <span className="hidden sm:inline text-xs font-medium">Routines</span>
            </button>
            <ThemeSwitcher />
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
              title="Sign out"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {(store.error || deadlineStore.error || canvasStore.error || gym.error) && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-[var(--text-primary)]">
              <p>{store.error || deadlineStore.error || canvasStore.error || gym.error}</p>
              <button
                onClick={() => { store.clearError(); deadlineStore.clearError(); canvasStore.clearError(); gym.clearError(); }}
                className="shrink-0 rounded px-2 py-1 text-xs text-[var(--text-muted)] transition hover:bg-rose-500/10 hover:text-[var(--text-primary)]"
              >
                Dismiss
              </button>
            </div>
          )}

          {showBackgroundSyncBanner && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm text-[var(--text-muted)]">
              <CheckCheck size={16} className="text-[var(--accent)]" />
              Syncing your workspace in the background...
            </div>
          )}
          <Routes>
            <Route
              path="/"
              element={<Navigate to="/dashboard" replace />}
            />
            <Route
              path="/dashboard"
              element={
                <Dashboard
                  tasks={store.tasks}
                  projects={store.projects}
                  deadlines={deadlineStore.deadlines}
                  calendarEvents={calendar.events}
                  studyBlockOutcomes={studyBlockOutcomes.outcomesByEventId}
                  getStudyBlockOutcome={studyBlockOutcomes.getOutcomeForEvent}
                  studyBlockOutcomesLoading={studyBlockOutcomes.isLoading}
                  onSetStudyBlockOutcome={handleSetStudyBlockOutcome}
                  onStudyReviewPromptShown={(count) => learning.logStudyReviewPromptShown({
                    count,
                    options: { source: 'manual', learn: true },
                  })}
                  behaviorSummary={learning.behaviorInsights.summary}
                  proactivePrompts={learning.behaviorInsights.proactivePrompts}
                  onUseBehaviorPrompt={openAiWithPrompt}
                />
              }
            />
            <Route
              path="/deadlines"
              element={
                <DeadlinesPage
                  deadlines={deadlineStore.deadlines}
                  projects={store.projects}
                  tasks={store.tasks}
                  initialCourseFilter={deadlineCourseFilterId}
                  initialDetailId={deadlineFocusId}
                  onAdd={handleAddDeadline}
                  onAddProject={handleAddProject}
                  onUpdate={handleUpdateDeadline}
                  onDelete={handleDeleteDeadline}
                  onDeleteAll={handleDeleteAllDeadlines}
                  onLinkTask={handleLinkTask}
                  onUnlinkTask={handleUnlinkTask}
                  onCreateTask={async (title, desc, projId, dueDate) => handleAddTask(title, desc, 'medium', projId, dueDate, 'none')}
                  onNavigateToCourse={openCourse}
                  onNavigateToTasks={openCourseTasks}
                />
              }
            />
            <Route
              path="/tasks"
              element={
                <TaskBoard
                  tasks={store.tasks}
                  projects={store.projects}
                  deadlines={deadlineStore.deadlines}
                  initialProjectFilter={taskProjectFilterId}
                  onAddTask={handleAddTask}
                  onUpdateStatus={handleUpdateTaskStatus}
                  onUpdateTask={handleUpdateTask}
                  onDeleteTask={handleDeleteTask}
                  onAddSubtask={handleAddSubtask}
                  onToggleSubtask={handleToggleSubtask}
                  onDeleteSubtask={handleDeleteSubtask}
                  onAddComment={handleAddComment}
                  onDeleteComment={handleDeleteComment}
                  onOpenDeadline={openDeadline}
                />
              }
            />
            <Route
              path="/courses"
              element={
                <ProjectList
                  projects={store.projects}
                  tasks={store.tasks}
                  deadlines={deadlineStore.deadlines}
                  initialProjectId={projectFocusId}
                  onAddProject={handleAddProject}
                  onUpdateProject={handleUpdateProject}
                  onDeleteProject={handleDeleteProject}
                  onOpenTasks={openCourseTasks}
                  onOpenDeadlines={openCourseDeadlines}
                />
              }
            />
            <Route
              path="/calendar"
              element={
                <CalendarView
                  calendar={calendarController}
                  deadlines={deadlineStore.deadlines}
                  studyBlockOutcomes={studyBlockOutcomes.outcomesByEventId}
                  getStudyBlockOutcome={studyBlockOutcomes.getOutcomeForEvent}
                  studyBlockOutcomesLoading={studyBlockOutcomes.isLoading}
                  onSetStudyBlockOutcome={handleSetStudyBlockOutcome}
                />
              }
            />
            <Route
              path="/timeline"
              element={
                <TimelineView
                  tasks={store.tasks}
                  projects={store.projects}
                  deadlines={deadlineStore.deadlines}
                  onUpdateDueDate={handleUpdateTaskDueDate}
                />
              }
            />
            <Route
              path="/gym"
              element={
                <GymPage
                  plans={gym.plans}
                  dayTemplates={gym.dayTemplates}
                  exercises={gym.exercises}
                  dayExercises={gym.dayExercises}
                  sessions={gym.sessions}
                  exerciseLogs={gym.exerciseLogs}
                  setLogs={gym.setLogs}
                  activePlan={gym.activePlan}
                  activeSession={gym.activeSession}
                  onAddPlan={gym.addPlan}
                  onUpdatePlan={gym.updatePlan}
                  onDeletePlan={gym.deletePlan}
                  onAddDayTemplate={gym.addDayTemplate}
                  onUpdateDayTemplate={gym.updateDayTemplate}
                  onDeleteDayTemplate={gym.deleteDayTemplate}
                  onAddExercise={gym.addExercise}
                  onUpdateExercise={gym.updateExercise}
                  onDeleteExercise={gym.deleteExercise}
                  onAddDayExercise={gym.addDayExercise}
                  onUpdateDayExercise={gym.updateDayExercise}
                  onDeleteDayExercise={gym.deleteDayExercise}
                  onStartSession={gym.startSession}
                  onCompleteSession={gym.completeSession}
                  onDeleteSession={gym.deleteSession}
                  onUpdateSetLog={gym.updateSetLog}
                  getLastPerformance={gym.getLastPerformance}
                  onUploadExercisePhoto={gym.uploadExercisePhoto}
                  onUploadExerciseImage={gym.uploadExerciseImage}
                />
              }
            />
            <Route
              path="*"
              element={<Navigate to="/dashboard" replace />}
            />
          </Routes>
        </main>

        {aiOpen && (
          <AIPanel
            open={aiOpen}
            mode={aiMode}
            onModeChange={setAiMode}
            onClose={() => setAiOpen(false)}
            onOpenDataSettings={() => {
              setAiOpen(false);
              setProfileInitialTab('data');
              setProfileOpen(true);
            }}
            userId={user.id}
            tasks={store.tasks}
            deadlines={deadlineStore.deadlines}
            projects={store.projects}
            plans={gym.plans}
            dayTemplates={gym.dayTemplates}
            exercises={gym.exercises}
            dayExercises={gym.dayExercises}
            calendarEvents={calendar.events}
            calendarCalendars={calendar.calendars}
            selectedCalendarId={calendar.selectedCalendarId}
            getCalendarEventsForRange={calendar.getEventsForRange}
            onAddTask={handleAddTask}
            onUpdateTask={handleUpdateTask}
            onAddDeadline={handleAddDeadline}
            onUpdateDeadline={handleUpdateDeadline}
            onAddProject={handleAddProject}
            onAddSubtask={handleAddSubtask}
            onDeleteTask={handleDeleteTask}
            onLinkTask={handleLinkTask}
            onCreateCalendarEvent={handleCreateCalendarEvent}
            onUpdateCalendarEvent={handleUpdateCalendarEvent}
            onDeleteCalendarEvent={handleDeleteCalendarEvent}
            aiLearningEnabled={learning.aiLearningEnabled}
            onAiLearningEnabledChange={learning.setAiLearningEnabled}
            scoreStudySlot={learning.scoreStudySlot}
            behaviorSummary={learning.behaviorInsights.summary}
            draftPrompt={queuedAiPrompt}
            onDraftPromptConsumed={() => setQueuedAiPrompt(null)}
            onAiPromptSubmitted={(prompt, hasImages) => learning.logAiPromptSubmitted({
              prompt,
              hasImages,
              options: { source: 'manual', learn: true },
            })}
            onAiActionsApplied={(blockType, appliedCount, skippedCount) => learning.logAiActionsApplied({
              blockType,
              appliedCount,
              skippedCount,
              options: { source: 'manual', learn: true },
            })}
            onAiSuggestionAccepted={(blockType, actionCount) => learning.logAiSuggestionAccepted({
              blockType,
              actionCount,
              options: { source: 'manual', learn: true },
            })}
            onAiSuggestionEdited={(blockType, actionCount) => learning.logAiSuggestionEdited({
              blockType,
              actionCount,
              options: { source: 'manual', learn: true },
            })}
            onAiSuggestionRejected={(blockTypes, actionCount) => learning.logAiSuggestionRejected({
              blockTypes,
              actionCount,
              options: { source: 'manual', learn: true },
            })}
            onStudyBlockLinkedTarget={(params) => learning.logStudyBlockLinkedTarget({
              ...params,
              options: { source: 'manual', learn: true },
            })}
            onStudySlotCandidatesLogged={(params) => learning.logStudySlotCandidates({
              ...params,
              options: { source: 'manual', learn: true },
            })}
            habits={habits.habits}
            onAddHabit={handleAddHabit}
            onToggleHabit={handleToggleHabit}
            onDeleteHabit={handleDeleteHabit}
          />
        )}
        </div>
      </div>

      {searchOpen && (
        <GlobalSearch
          tasks={store.tasks}
          projects={store.projects}
          deadlines={deadlineStore.deadlines}
          onClose={() => setSearchOpen(false)}
          onNavigate={(view) => { handleViewChange(view); setSearchOpen(false); }}
        />
      )}

      {canvasOpen && (
        <CanvasConnect
          connection={canvasStore.connection}
          isSyncing={canvasStore.isSyncing}
          error={canvasStore.error}
          lastSyncResult={canvasStore.lastSyncResult}
          onDisconnect={canvasStore.disconnect}
          onSync={handleCanvasSync}
          onClose={() => setCanvasOpen(false)}
          onClearError={canvasStore.clearError}
        />
      )}

      <ProfileModal
        user={user}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        initialTab={profileInitialTab}
        tasks={store.tasks}
        deadlines={deadlineStore.deadlines}
        projects={store.projects}
        behaviorSummary={learning.behaviorInsights.summary}
        proactivePrompts={learning.behaviorInsights.proactivePrompts}
        aiLearningEnabled={learning.aiLearningEnabled}
        onAiLearningEnabledChange={learning.setAiLearningEnabled}
        onOpenPreferenceSetup={() => {
          setProfileOpen(false);
          setPreferenceSetupOpen(true);
        }}
        onClearBehaviorHistory={learning.clearBehaviorHistory}
        onUseBehaviorPrompt={openAiWithPrompt}
        onUserUpdated={handleUserUpdated}
      />

      {preferenceSetupOpen && (
        <AuthOnboarding
          user={user}
          mode="preferences"
          onCancel={() => setPreferenceSetupOpen(false)}
          onComplete={async () => {
            await handleUserUpdated();
            setPreferenceSetupOpen(false);
          }}
        />
      )}

      {habitsOpen && (
        <HabitsPanel
          habits={habits.habits}
          isLoading={habits.isLoading}
          onToggle={handleToggleHabit}
          onAdd={handleAddHabit}
          onDelete={handleDeleteHabit}
          onClose={() => setHabitsOpen(false)}
          anchorRef={habitsButtonRef}
        />
      )}

      {!aiOpen && (
        <button
          type="button"
          onClick={openAiPanel}
          className="fixed bottom-6 right-6 z-[55] flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border-soft)] bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-[0_10px_30px_rgba(15,23,42,0.12)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(15,23,42,0.16)]"
          title="AI Assistant"
        >
          <Sparkles size={18} />
        </button>
      )}

      {/* AIPanel is rendered once above (inside the sidebar layout slot).
         It uses createPortal internally when mode === 'floating', so no
         duplicate instance is needed here. */}

      <div className="pointer-events-none fixed right-4 top-20 z-[80] flex w-full max-w-sm flex-col gap-2 sm:right-6">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto overflow-hidden rounded-lg border shadow-sm',
              toast.tone === 'error'
                ? 'border-red-500/20 bg-red-500/10'
                : toast.tone === 'success'
                  ? 'border-emerald-500/20 bg-emerald-500/10'
                  : 'border-[var(--accent)]/20 bg-[var(--accent-soft)]'
            )}
            style={{ backgroundColor: 'var(--surface-elevated)' }}
          >
            <div className="flex items-start gap-3 px-4 py-3 text-sm">
              <div className="mt-0.5 shrink-0">
                {toast.tone === 'error' ? <AlertCircle size={16} className="text-red-400" /> : <CheckCircle2 size={16} className={toast.tone === 'success' ? 'text-emerald-400' : 'text-[var(--accent)]'} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[var(--text-primary)]">{toast.title}</div>
                {toast.message && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{toast.message}</div>}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="rounded-full p-1 text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
