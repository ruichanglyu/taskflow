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
import { AcademicPlanningModal } from './AcademicPlanningModal';
import { WalkthroughController, type WalkthroughControllerHandle, loadWalkthroughState } from './WalkthroughController';
import { migrateLegacyAIData } from '../hooks/useAI';
import { useHabits } from '../hooks/useHabits';
import { useGoogleCalendar } from '../hooks/useGoogleCalendar';
import { useBehaviorLearning, type BehaviorLearningActionOptions } from '../hooks/useBehaviorLearning';
import { useStudyBlockOutcomes } from '../hooks/useStudyBlockOutcomes';
import type { StudyBlockOutcomeStatus } from '../types';
import { isStudyBlockLikeCalendarEvent } from '../utils/studyBlockDetection';
import { hasEventEnded } from '../utils/calendarEventHelpers';
import {
  buildAcademicPlanEvent,
  buildAcademicPlanProposal,
  removeAcademicPlanBlock,
  summarizeAcademicPlanningMetrics,
  type AcademicPlanProposal,
  updateAcademicPlanBlock,
} from '../lib/academicPlanning';

interface AppShellProps {
  user: User;
}

type ToastTone = 'success' | 'error' | 'info';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
  action?: ToastAction;
}

interface AcademicPlanningDraftState {
  source: 'dashboard' | 'deadline' | 'ai';
  targetIds: string[];
  proposal: AcademicPlanProposal;
}

type PendingDeleteKind =
  | 'deadline'
  | 'all_deadlines'
  | 'task'
  | 'project'
  | 'subtask'
  | 'comment'
  | 'habit'
  | 'calendar_event'
  | 'gym_plan'
  | 'gym_day'
  | 'gym_exercise'
  | 'gym_day_exercise'
  | 'gym_session';

interface PendingDeleteEntry {
  key: string;
  kind: PendingDeleteKind;
  label: string;
  toastId: number;
  finalize: () => Promise<boolean>;
  onUndo?: () => void;
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

function haveSameIds(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function academicPlanningDraftStorageKey(userId: string) {
  return `taskflow_academic_planning_draft_${userId}`;
}

function readAcademicPlanningDraft(userId: string): AcademicPlanningDraftState | null {
  try {
    const raw = window.sessionStorage.getItem(academicPlanningDraftStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AcademicPlanningDraftState> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.source !== 'dashboard' && parsed.source !== 'deadline' && parsed.source !== 'ai') return null;
    if (!Array.isArray(parsed.targetIds) || parsed.targetIds.some(id => typeof id !== 'string')) return null;
    if (!parsed.proposal || typeof parsed.proposal !== 'object') return null;
    if (!Array.isArray(parsed.proposal.deadlineIds) || !Array.isArray(parsed.proposal.blocks)) return null;
    return {
      source: parsed.source,
      targetIds: parsed.targetIds,
      proposal: parsed.proposal as AcademicPlanProposal,
    };
  } catch {
    return null;
  }
}

function writeAcademicPlanningDraft(userId: string, draft: AcademicPlanningDraftState | null) {
  const storageKey = academicPlanningDraftStorageKey(userId);
  try {
    if (!draft) {
      window.sessionStorage.removeItem(storageKey);
      return;
    }
    window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
  } catch {
    // Ignore session storage failures and fall back to in-memory behavior.
  }
}

export function AppShell({ user }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentView = getViewFromPath(location.pathname);
  const initialAcademicPlanningDraft = useMemo(() => readAcademicPlanningDraft(user.id), [user.id]);
  const walkthroughRef = useRef<WalkthroughControllerHandle>(null);
  const [walkthroughSnapshot, setWalkthroughSnapshot] = useState(() => loadWalkthroughState(user.id));
  useEffect(() => {
    setWalkthroughSnapshot(loadWalkthroughState(user.id));
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail as { userId?: string; state?: typeof walkthroughSnapshot } | undefined;
      if (!detail || detail.userId !== user.id || !detail.state) return;
      setWalkthroughSnapshot(detail.state);
    };
    window.addEventListener('taskflow:walkthrough-update', listener);
    return () => window.removeEventListener('taskflow:walkthrough-update', listener);
  }, [user.id]);
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
  const [academicPlanningOpen, setAcademicPlanningOpen] = useState(false);
  const [academicPlanningSource, setAcademicPlanningSource] = useState<'dashboard' | 'deadline' | 'ai'>(
    () => initialAcademicPlanningDraft?.source ?? 'dashboard',
  );
  const [academicPlanningTargetIds, setAcademicPlanningTargetIds] = useState<string[]>(
    () => initialAcademicPlanningDraft?.targetIds ?? [],
  );
  const [academicPlanningProposal, setAcademicPlanningProposal] = useState<AcademicPlanProposal | null>(
    () => initialAcademicPlanningDraft?.proposal ?? null,
  );
  const [academicPlanningGenerating, setAcademicPlanningGenerating] = useState(false);
  const [academicPlanningApplying, setAcademicPlanningApplying] = useState(false);
  const [academicPlanningApplyingIds, setAcademicPlanningApplyingIds] = useState<Set<string>>(new Set());
  const habitsButtonRef = useRef<HTMLButtonElement>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<Record<string, PendingDeleteEntry>>({});
  const pendingDeleteTimersRef = useRef<Map<string, number>>(new Map());
  const pendingDeletesRef = useRef<Record<string, PendingDeleteEntry>>({});
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
  const deadlineImportRequested = searchParams.get('import') === '1';
  const taskProjectFilterId = searchParams.get('project') ?? 'all';
  const openAiWithPrompt = useCallback((prompt: string) => {
    setQueuedAiPrompt(prompt);
    setAiOpen(true);
  }, []);

  const openDeadlineImport = useCallback(() => {
    navigate('/deadlines?import=1');
  }, [navigate]);

  const openAiPanel = useCallback(() => {
    learning.logAiPanelOpened({ source: 'manual', learn: true });
    setAiOpen(true);
  }, [learning]);

  useEffect(() => {
    pendingDeletesRef.current = pendingDeletes;
  }, [pendingDeletes]);

  useEffect(() => () => {
    pendingDeleteTimersRef.current.forEach(timerId => window.clearTimeout(timerId));
    pendingDeleteTimersRef.current.clear();
  }, []);

  const pendingDeleteEntries = useMemo(() => Object.values(pendingDeletes), [pendingDeletes]);
  const pendingDeleteAllDeadlines = pendingDeleteEntries.some(entry => entry.kind === 'all_deadlines');
  const pendingDeadlineIds = useMemo(() => new Set(pendingDeleteEntries.filter(entry => entry.kind === 'deadline').map(entry => entry.key.replace('deadline:', ''))), [pendingDeleteEntries]);
  const pendingTaskIds = useMemo(() => new Set(pendingDeleteEntries.filter(entry => entry.kind === 'task').map(entry => entry.key.replace('task:', ''))), [pendingDeleteEntries]);
  const pendingProjectIds = useMemo(() => new Set(pendingDeleteEntries.filter(entry => entry.kind === 'project').map(entry => entry.key.replace('project:', ''))), [pendingDeleteEntries]);
  const pendingSubtaskIds = useMemo(() => new Set(pendingDeleteEntries.filter(entry => entry.kind === 'subtask').map(entry => entry.key.replace('subtask:', ''))), [pendingDeleteEntries]);
  const pendingCommentIds = useMemo(() => new Set(pendingDeleteEntries.filter(entry => entry.kind === 'comment').map(entry => entry.key.replace('comment:', ''))), [pendingDeleteEntries]);
  const hasStudyReviewReady = useMemo(() => {
    const now = new Date();
    return calendar.events.some(event => {
      if (!event.id) return false;
      if (!isStudyBlockLikeCalendarEvent(event)) return false;
      if (!hasEventEnded(event, now)) return false;
      return !studyBlockOutcomes.getOutcomeForEvent(event);
    });
  }, [calendar.events, studyBlockOutcomes]);

  const openStudyReviewFromWalkthrough = useCallback(() => {
    navigate('/dashboard');
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('taskflow:open-study-review', { detail: { userId: user.id } }));
    }, 80);
  }, [navigate, user.id]);
  const pendingHabitIds = useMemo(() => new Set(pendingDeleteEntries.filter(entry => entry.kind === 'habit').map(entry => entry.key.replace('habit:', ''))), [pendingDeleteEntries]);
  const pendingCalendarEventKeys = useMemo(() => new Set(pendingDeleteEntries.filter(entry => entry.kind === 'calendar_event').map(entry => entry.key.replace('calendar_event:', ''))), [pendingDeleteEntries]);
  const pendingGymPlanIds = useMemo(() => new Set(pendingDeleteEntries.filter(entry => entry.kind === 'gym_plan').map(entry => entry.key.replace('gym_plan:', ''))), [pendingDeleteEntries]);
  const pendingGymDayIds = useMemo(() => new Set(pendingDeleteEntries.filter(entry => entry.kind === 'gym_day').map(entry => entry.key.replace('gym_day:', ''))), [pendingDeleteEntries]);
  const pendingGymExerciseIds = useMemo(() => new Set(pendingDeleteEntries.filter(entry => entry.kind === 'gym_exercise').map(entry => entry.key.replace('gym_exercise:', ''))), [pendingDeleteEntries]);
  const pendingGymDayExerciseIds = useMemo(() => new Set(pendingDeleteEntries.filter(entry => entry.kind === 'gym_day_exercise').map(entry => entry.key.replace('gym_day_exercise:', ''))), [pendingDeleteEntries]);
  const pendingGymSessionIds = useMemo(() => new Set(pendingDeleteEntries.filter(entry => entry.kind === 'gym_session').map(entry => entry.key.replace('gym_session:', ''))), [pendingDeleteEntries]);

  const filteredProjects = useMemo(
    () => store.projects.filter(project => !pendingProjectIds.has(project.id)),
    [pendingProjectIds, store.projects],
  );

  const filteredTasks = useMemo(
    () => store.tasks
      .filter(task => !pendingTaskIds.has(task.id))
      .map(task => ({
        ...task,
        subtasks: task.subtasks.filter(subtask => !pendingSubtaskIds.has(subtask.id)),
        comments: task.comments.filter(comment => !pendingCommentIds.has(comment.id)),
      })),
    [pendingCommentIds, pendingSubtaskIds, pendingTaskIds, store.tasks],
  );

  const filteredDeadlines = useMemo(
    () => (pendingDeleteAllDeadlines ? [] : deadlineStore.deadlines.filter(deadline => !pendingDeadlineIds.has(deadline.id))),
    [deadlineStore.deadlines, pendingDeadlineIds, pendingDeleteAllDeadlines],
  );

  const filteredHabits = useMemo(
    () => habits.habits.filter(habit => !pendingHabitIds.has(habit.id)),
    [habits.habits, pendingHabitIds],
  );

  const filteredCalendarEvents = useMemo(
    () => calendar.events.filter(event => !pendingCalendarEventKeys.has(`${event.calendarId || ''}::${event.id}`)),
    [calendar.events, pendingCalendarEventKeys],
  );

  const filteredGymPlans = useMemo(
    () => gym.plans.filter(plan => !pendingGymPlanIds.has(plan.id)),
    [gym.plans, pendingGymPlanIds],
  );
  const filteredGymDayTemplates = useMemo(
    () => gym.dayTemplates.filter(day => !pendingGymDayIds.has(day.id) && !pendingGymPlanIds.has(day.planId)),
    [gym.dayTemplates, pendingGymDayIds, pendingGymPlanIds],
  );
  const filteredGymExercises = useMemo(
    () => gym.exercises.filter(exercise => !pendingGymExerciseIds.has(exercise.id)),
    [gym.exercises, pendingGymExerciseIds],
  );
  const filteredGymDayExercises = useMemo(
    () => gym.dayExercises.filter(dayExercise =>
      !pendingGymDayExerciseIds.has(dayExercise.id)
      && !pendingGymDayIds.has(dayExercise.workoutDayTemplateId)
      && !pendingGymExerciseIds.has(dayExercise.exerciseId)
    ),
    [gym.dayExercises, pendingGymDayExerciseIds, pendingGymDayIds, pendingGymExerciseIds],
  );
  const filteredGymSessions = useMemo(
    () => gym.sessions.filter(session => !pendingGymSessionIds.has(session.id)),
    [gym.sessions, pendingGymSessionIds],
  );
  const filteredGymExerciseLogs = useMemo(
    () => gym.exerciseLogs.filter(log => !pendingGymSessionIds.has(log.workoutSessionId)),
    [gym.exerciseLogs, pendingGymSessionIds],
  );
  const filteredGymExerciseLogIds = useMemo(
    () => new Set(filteredGymExerciseLogs.map(log => log.id)),
    [filteredGymExerciseLogs],
  );
  const filteredGymSetLogs = useMemo(
    () => gym.setLogs.filter(setLog => filteredGymExerciseLogIds.has(setLog.workoutExerciseLogId)),
    [filteredGymExerciseLogIds, gym.setLogs],
  );
  const filteredGymActivePlan = useMemo(
    () => filteredGymPlans.find(plan => plan.isActive) ?? null,
    [filteredGymPlans],
  );
  const filteredGymActiveSession = useMemo(
    () => filteredGymSessions.find(session => session.status === 'in-progress') ?? null,
    [filteredGymSessions],
  );

  const upcomingPlannableDeadlines = useMemo(() => (
    [...filteredDeadlines]
      .filter(deadline => {
        if (deadline.status === 'done' || deadline.status === 'missed') return false;
        return deadline.dueDate >= new Date().toISOString().slice(0, 10);
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  ), [filteredDeadlines]);

  const academicPlanningMetrics = useMemo(() => (
    summarizeAcademicPlanningMetrics({
      appBehaviorEvents: learning.appBehaviorEvents,
      calendarEvents: filteredCalendarEvents,
      getStudyBlockOutcomeStatus: event => studyBlockOutcomes.getOutcomeForEvent(event)?.status,
    })
  ), [filteredCalendarEvents, learning.appBehaviorEvents, studyBlockOutcomes]);

  const pushToast = useCallback((
    tone: ToastTone,
    title: string,
    message?: string,
    options?: { durationMs?: number; action?: ToastAction },
  ) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts(prev => [...prev, { id, tone, title, message, action: options?.action }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, options?.durationMs ?? 4200);
    return id;
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const clearPendingDelete = useCallback((key: string) => {
    const timerId = pendingDeleteTimersRef.current.get(key);
    if (timerId) {
      window.clearTimeout(timerId);
      pendingDeleteTimersRef.current.delete(key);
    }
    setPendingDeletes(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const undoPendingDelete = useCallback((key: string) => {
    const entry = pendingDeletesRef.current[key];
    if (!entry) return;
    entry.onUndo?.();
    dismissToast(entry.toastId);
    clearPendingDelete(key);
  }, [clearPendingDelete, dismissToast]);

  const scheduleUndoableDelete = useCallback((params: {
    key: string;
    kind: PendingDeleteKind;
    label: string;
    title: string;
    message?: string;
    finalize: () => Promise<boolean>;
    onUndo?: () => void;
  }) => {
    if (pendingDeletesRef.current[params.key]) {
      return;
    }

    const toastId = pushToast('info', params.title, params.message, {
      durationMs: 6000,
      action: {
        label: 'Undo',
        onClick: () => undoPendingDelete(params.key),
      },
    });

    const entry: PendingDeleteEntry = {
      key: params.key,
      kind: params.kind,
      label: params.label,
      toastId,
      finalize: params.finalize,
      onUndo: params.onUndo,
    };

    setPendingDeletes(prev => ({ ...prev, [params.key]: entry }));

    const timerId = window.setTimeout(async () => {
      const current = pendingDeletesRef.current[params.key];
      if (!current) return;
      const ok = await current.finalize();
      dismissToast(current.toastId);
      clearPendingDelete(params.key);
      if (!ok) {
        pushToast('error', `Could not delete ${current.label.toLowerCase()}`, 'Please try again.');
      }
    }, 6000);

    pendingDeleteTimersRef.current.set(params.key, timerId);
  }, [clearPendingDelete, dismissToast, pushToast, undoPendingDelete]);

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
    deleteOptions?: { silent?: boolean },
  ) => {
    const existingEvent = existingEventOverride
      ?? calendar.events.find(item => item.id === eventId && (!calendarIdOverride || item.calendarId === calendarIdOverride));
    if (!existingEvent) return false;
    if (deleteOptions?.silent) {
      const ok = await calendar.deleteEvent(eventId, calendarIdOverride);
      if (ok) learning.logCalendarDeleted(existingEvent, options);
      return ok;
    }
    const calendarEventKey = `${existingEvent.calendarId || calendarIdOverride || ''}::${eventId}`;
    scheduleUndoableDelete({
      key: `calendar_event:${calendarEventKey}`,
      kind: 'calendar_event',
      label: 'event',
      title: 'Event deleted',
      message: existingEvent.summary ?? 'Calendar event',
      finalize: async () => {
        const ok = await calendar.deleteEvent(eventId, calendarIdOverride);
        if (ok) {
          learning.logCalendarDeleted(existingEvent, options);
        }
        return ok;
      },
    });
    return true;
  }, [calendar, learning, scheduleUndoableDelete]);

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

  useEffect(() => {
    if (!academicPlanningProposal || academicPlanningTargetIds.length === 0) {
      writeAcademicPlanningDraft(user.id, null);
      return;
    }

    writeAcademicPlanningDraft(user.id, {
      source: academicPlanningSource,
      targetIds: academicPlanningTargetIds,
      proposal: academicPlanningProposal,
    });
  }, [academicPlanningProposal, academicPlanningSource, academicPlanningTargetIds, user.id]);

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

  const generateAcademicPlanningProposal = useCallback((source: 'dashboard' | 'deadline' | 'ai', targetIds: string[]) => {
    const selectedDeadlines = upcomingPlannableDeadlines.filter(deadline => targetIds.includes(deadline.id));
    const proposal = buildAcademicPlanProposal({
      deadlines: selectedDeadlines,
      tasks: filteredTasks,
      projects: filteredProjects,
      calendarEvents: filteredCalendarEvents,
      selectedCalendarId: calendar.selectedCalendarId,
      source,
      scoreStudySlot: learning.scoreStudySlot,
      completionRate: academicPlanningMetrics.completionRate,
    });
    setAcademicPlanningProposal(proposal);
    learning.logAcademicPlanGenerated({
      proposalId: proposal.id,
      deadlineTitles: selectedDeadlines.map(deadline => deadline.title),
      blockCount: proposal.blocks.length,
      options: { source: 'ai', learn: true },
    });
    return proposal;
  }, [academicPlanningMetrics.completionRate, calendar.selectedCalendarId, filteredCalendarEvents, filteredProjects, filteredTasks, learning, upcomingPlannableDeadlines]);

  const openAcademicPlanner = useCallback((source: 'dashboard' | 'deadline' | 'ai', deadlineIds?: string[]) => {
    if (!calendar.isConnected) {
      pushToast('info', 'Connect Google Calendar first', 'The planner needs your calendar before it can place study blocks.');
      return;
    }

    if (calendar.isLoading || calendar.isConnecting || calendar.calendars.length === 0) {
      void calendar.refresh();
      pushToast('info', 'Calendar is still loading', 'Give Google Calendar a second to finish loading, then try the planner again.');
      return;
    }

    const targetIds = (deadlineIds?.length ? deadlineIds : upcomingPlannableDeadlines.slice(0, 3).map(deadline => deadline.id))
      .filter(Boolean);

    if (targetIds.length === 0) {
      pushToast('info', 'No upcoming deadlines', 'Add or import an upcoming deadline first, then we can plan it.');
      return;
    }

    const reopeningSameDraft = (
      academicPlanningProposal
      && academicPlanningSource === source
      && haveSameIds(academicPlanningTargetIds, targetIds)
    );

    if (reopeningSameDraft) {
      setAcademicPlanningOpen(true);
      return;
    }

    setAcademicPlanningSource(source);
    setAcademicPlanningTargetIds(targetIds);
    setAcademicPlanningGenerating(true);
    setAcademicPlanningOpen(true);

    // Defer synchronous generation so React can flush the "generating" spinner first
    setTimeout(() => {
      try {
        generateAcademicPlanningProposal(source, targetIds);
      } finally {
        setAcademicPlanningGenerating(false);
      }
    }, 0);
  }, [
    academicPlanningProposal,
    academicPlanningSource,
    academicPlanningTargetIds,
    calendar.isConnected,
    generateAcademicPlanningProposal,
    pushToast,
    upcomingPlannableDeadlines,
  ]);

  const selectedAcademicPlanningDeadlines = useMemo(() => (
    academicPlanningTargetIds
      .map(id => filteredDeadlines.find(deadline => deadline.id === id))
      .filter((deadline): deadline is NonNullable<typeof deadline> => Boolean(deadline))
  ), [academicPlanningTargetIds, filteredDeadlines]);

  const handleRegenerateAcademicPlan = useCallback(() => {
    if (academicPlanningTargetIds.length === 0) return;
    setAcademicPlanningGenerating(true);
    setTimeout(() => {
      try {
        generateAcademicPlanningProposal(academicPlanningSource, academicPlanningTargetIds);
      } finally {
        setAcademicPlanningGenerating(false);
      }
    }, 0);
  }, [academicPlanningSource, academicPlanningTargetIds, generateAcademicPlanningProposal]);

  const handleUpdateAcademicPlanBlock = useCallback((blockId: string, updates: Parameters<typeof updateAcademicPlanBlock>[2]) => {
    setAcademicPlanningProposal(current => {
      if (!current) return current;
      const block = current.blocks.find(item => item.id === blockId);
      if (block) {
        learning.logAcademicPlanEdited({
          proposalId: current.id,
          deadlineTitle: block.deadlineTitle,
          blockTitle: block.title,
          options: { source: 'manual', learn: true },
        });
      }
      return updateAcademicPlanBlock(current, blockId, updates);
    });
  }, [learning]);

  const handleRemoveAcademicPlanBlock = useCallback((blockId: string) => {
    setAcademicPlanningProposal(current => {
      if (!current) return current;
      const block = current.blocks.find(item => item.id === blockId);
      if (block) {
        learning.logAcademicPlanEdited({
          proposalId: current.id,
          deadlineTitle: block.deadlineTitle,
          blockTitle: `${block.title} removed`,
          options: { source: 'manual', learn: true },
        });
      }
      return removeAcademicPlanBlock(current, blockId);
    });
  }, [learning]);

  const applyAcademicPlanBlocks = useCallback(async (blockIds?: string[]) => {
    if (!academicPlanningProposal) return;
    const targetBlocks = academicPlanningProposal.blocks.filter(block => !blockIds || blockIds.includes(block.id));
    if (targetBlocks.length === 0) return;

    setAcademicPlanningApplying(true);
    setAcademicPlanningApplyingIds(new Set(targetBlocks.map(block => block.id)));

    let acceptedCount = 0;
    const acceptedIds = new Set<string>();
    let lastFailureReason: string | null = null;

    for (const block of targetBlocks) {
      const event = buildAcademicPlanEvent(block);
      const created = await handleCreateCalendarEvent(
        event,
        block.calendarId ?? calendar.selectedCalendarId,
        { source: 'ai', learn: true },
      );

      if (!created) {
        lastFailureReason = calendar.getLastError();
        continue;
      }

      acceptedIds.add(block.id);
      acceptedCount += 1;
      learning.logStudyBlockLinkedTarget({
        title: block.title,
        calendarSummary: block.courseName ?? null,
        course: block.courseName ?? null,
        deadlineTitle: block.deadlineTitle,
        deadlineDate: block.deadlineDate,
        deadlineType: block.deadlineType,
        options: { source: 'ai', learn: true },
      });
      learning.logStudySlotCandidates({
        title: block.title,
        calendarSummary: block.courseName ?? null,
        course: block.courseName ?? null,
        dateKey: block.dateKey,
        durationMinutes: block.endMinutes - block.startMinutes,
        requestedStartMinutes: block.startMinutes,
        adjusted: block.edited,
        deadlineTitle: block.deadlineTitle,
        deadlineDate: block.deadlineDate,
        deadlineType: block.deadlineType,
        candidates: block.candidates.map(candidate => ({
          startMinutes: candidate.startMinutes,
          endMinutes: candidate.endMinutes,
          score: candidate.score,
          distance: candidate.distance,
          selected: candidate.selected,
        })),
        options: { source: 'ai', learn: true },
      });
    }

    setAcademicPlanningApplying(false);
    setAcademicPlanningApplyingIds(new Set());

    if (acceptedCount === 0) {
      pushToast(
        'error',
        'No study blocks were scheduled',
        lastFailureReason || 'Nothing was added to the calendar. Try editing the plan or regenerating it.',
      );
      return;
    }

    learning.logAcademicPlanAccepted({
      proposalId: academicPlanningProposal.id,
      deadlineTitles: selectedAcademicPlanningDeadlines.map(deadline => deadline.title),
      blockCount: academicPlanningProposal.blocks.length,
      acceptedCount,
      options: { source: 'ai', learn: true },
    });

    setAcademicPlanningProposal(current => {
      if (!current) return current;
      const remainingBlocks = current.blocks.filter(block => !acceptedIds.has(block.id));
      if (remainingBlocks.length === 0) {
        return { ...current, blocks: [] };
      }
      return { ...current, blocks: remainingBlocks };
    });

    pushToast(
      'success',
      acceptedCount === 1 ? 'Study block scheduled' : 'Study plan scheduled',
      acceptedCount === 1
        ? 'The study block was added to your calendar.'
        : `${acceptedCount} study blocks were added to your calendar.`,
    );

    if (acceptedIds.size === targetBlocks.length) {
      setAcademicPlanningOpen(false);
      setAcademicPlanningProposal(null);
    }
  }, [academicPlanningProposal, calendar, handleCreateCalendarEvent, learning, pushToast, selectedAcademicPlanningDeadlines]);

  const handleRejectAcademicPlan = useCallback(() => {
    if (academicPlanningProposal) {
      learning.logAcademicPlanRejected({
        proposalId: academicPlanningProposal.id,
        deadlineTitles: selectedAcademicPlanningDeadlines.map(deadline => deadline.title),
        blockCount: academicPlanningProposal.blocks.length,
        options: { source: 'manual', learn: true },
      });
    }
    setAcademicPlanningProposal(null);
    setAcademicPlanningOpen(false);
  }, [academicPlanningProposal, learning, selectedAcademicPlanningDeadlines]);

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
    const options: BehaviorLearningActionOptions = isBehaviorLearningActionOptions(lastArg) ? lastArg : { source: 'manual', learn: true };
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

  const handleDeleteDeadline = useCallback(async (id: string, options: BehaviorLearningActionOptions = { source: 'manual', learn: true }) => {
    const currentDeadline = deadlineStore.deadlines.find(item => item.id === id);
    if (!currentDeadline) return;
    scheduleUndoableDelete({
      key: `deadline:${id}`,
      kind: 'deadline',
      label: 'deadline',
      title: 'Deadline deleted',
      message: currentDeadline.title,
      finalize: async () => {
        const ok = await deadlineStore.deleteDeadline(id);
        if (ok) {
          learning.logDeadlineDeleted({
            title: currentDeadline.title,
            projectId: currentDeadline.projectId,
            dueDate: currentDeadline.dueDate,
            dueTime: currentDeadline.dueTime,
            type: currentDeadline.type,
            status: currentDeadline.status,
            options,
          });
        }
        return ok;
      },
    });
  }, [deadlineStore, learning, scheduleUndoableDelete]);

  const handleDeleteAllDeadlines = useCallback(async () => {
    const currentDeadlines = filteredDeadlines;
    if (currentDeadlines.length === 0) return false;
    scheduleUndoableDelete({
      key: 'all_deadlines',
      kind: 'all_deadlines',
      label: 'deadlines',
      title: 'All deadlines deleted',
      message: `${currentDeadlines.length} deadlines removed`,
      finalize: async () => {
        const ok = await deadlineStore.deleteAllDeadlines();
        if (ok) {
          currentDeadlines.forEach(deadline => {
            learning.logDeadlineDeleted({
              title: deadline.title,
              projectId: deadline.projectId,
              dueDate: deadline.dueDate,
              dueTime: deadline.dueTime,
              type: deadline.type,
              status: deadline.status,
              options: { source: 'manual', learn: true },
            });
          });
        }
        return ok;
      },
    });
    return true;
  }, [deadlineStore, filteredDeadlines, learning, scheduleUndoableDelete]);

  const handleLinkTask = useCallback(async (...args: [...Parameters<typeof deadlineStore.linkTask>, BehaviorLearningActionOptions?]) => {
    const lastArg = args.at(-1);
    const options: BehaviorLearningActionOptions = isBehaviorLearningActionOptions(lastArg) ? lastArg : { source: 'manual', learn: true };
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
    if (!currentTask) return false;
    scheduleUndoableDelete({
      key: `task:${id}`,
      kind: 'task',
      label: 'task',
      title: 'Task deleted',
      message: currentTask.title,
      finalize: async () => {
        const ok = await store.deleteTask(id);
        if (ok) {
          await deadlineStore.loadDeadlines();
          learning.logTaskDeleted({
            title: currentTask.title,
            projectId: currentTask.projectId,
            dueDate: currentTask.dueDate,
            status: currentTask.status,
            options,
          });
        }
        return ok;
      },
    });
    return true;
  }, [deadlineStore, learning, scheduleUndoableDelete, store]);

  const handleAddProject = useCallback(async (...args: [...Parameters<typeof store.addProject>, BehaviorLearningActionOptions?]) => {
    const lastArg = args.at(-1);
    const options: BehaviorLearningActionOptions = isBehaviorLearningActionOptions(lastArg) ? lastArg : { source: 'manual', learn: true };
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

  const handleDeleteSubtask = useCallback(async (
    subtaskId: string,
    options?: BehaviorLearningActionOptions,
  ): Promise<boolean> => {
    const task = store.tasks.find(item => item.subtasks.some(subtask => subtask.id === subtaskId));
    const subtask = task?.subtasks.find(item => item.id === subtaskId);
    if (!task || !subtask) return false;
    scheduleUndoableDelete({
      key: `subtask:${subtaskId}`,
      kind: 'subtask',
      label: 'subtask',
      title: 'Subtask deleted',
      message: subtask.title,
      finalize: async () => {
        const ok = await store.deleteSubtask(subtaskId);
        if (ok) {
          learning.logTaskSubtaskDeleted({
            taskTitle: task.title,
            subtaskTitle: subtask.title,
            projectId: task.projectId,
            dueDate: task.dueDate,
            options: options ?? { source: 'manual', learn: true },
          });
        }
        return ok;
      },
    });
    return true;
  }, [learning, scheduleUndoableDelete, store]);

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
    if (!task || !comment) return;
    scheduleUndoableDelete({
      key: `comment:${commentId}`,
      kind: 'comment',
      label: 'comment',
      title: 'Comment deleted',
      message: comment.text.trim().slice(0, 80),
      finalize: async () => {
        const ok = await store.deleteComment(commentId);
        if (ok) {
          learning.logTaskCommentDeleted({
            taskTitle: task.title,
            projectId: task.projectId,
            dueDate: task.dueDate,
            commentPreview: comment.text.trim().slice(0, 80),
            options: { source: 'manual', learn: true },
          });
        }
        return ok;
      },
    });
  }, [learning, scheduleUndoableDelete, store]);

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
    notes = '',
  ) => {
    const previousOutcome = studyBlockOutcomes.getOutcomeForEvent(event);
    const previousStatus = previousOutcome?.status;
    const previousNotes = previousOutcome?.notes ?? '';
    const ok = await studyBlockOutcomes.setOutcome(event, status, notes);
    const start = event.start?.dateTime ? new Date(event.start.dateTime) : null;
    const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
    const startMinutes = start ? start.getHours() * 60 + start.getMinutes() : null;
    const durationMinutes = start && end ? Math.max(Math.round((end.getTime() - start.getTime()) / 60000), 0) : null;
    if (ok && (previousStatus !== status || previousNotes !== notes)) {
      learning.logStudyBlockOutcome({
        title: event.summary ?? 'Untitled event',
        calendarSummary: event.calendarSummary ?? null,
        dateKey: event.start?.date ?? (event.start?.dateTime ? event.start.dateTime.slice(0, 10) : ''),
        startMinutes: startMinutes ?? 0,
        durationMinutes: durationMinutes ?? 0,
        status,
        notes,
        options: { source: 'manual', learn: true },
      });
    }
    return ok;
  }, [learning, studyBlockOutcomes]);

  const handleDeleteProject = useCallback(async (id: string, options?: BehaviorLearningActionOptions) => {
    const currentProject = store.projects.find(item => item.id === id);
    if (!currentProject) return;
    scheduleUndoableDelete({
      key: `project:${id}`,
      kind: 'project',
      label: 'course',
      title: 'Course deleted',
      message: currentProject.name,
      finalize: async () => {
        const ok = await store.deleteProject(id);
        if (ok) {
          learning.logProjectDeleted({
            name: currentProject.name,
            description: currentProject.description,
            options,
          });
        }
        return ok;
      },
    });
  }, [learning, scheduleUndoableDelete, store]);

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
    if (!currentHabit) return;
    scheduleUndoableDelete({
      key: `habit:${id}`,
      kind: 'habit',
      label: 'habit',
      title: 'Habit deleted',
      message: currentHabit.title,
      finalize: async () => {
        const ok = await habits.deleteHabit(id);
        if (ok) {
          learning.logHabitDeleted({
            title: currentHabit.title,
            options,
          });
        }
        return ok;
      },
    });
  }, [habits, learning, scheduleUndoableDelete]);

  const handleDeleteGymPlan = useCallback((id: string) => {
    const plan = gym.plans.find(item => item.id === id);
    if (!plan) return;
    scheduleUndoableDelete({
      key: `gym_plan:${id}`,
      kind: 'gym_plan',
      label: 'plan',
      title: 'Plan deleted',
      message: plan.name,
      finalize: () => gym.deletePlan(id),
    });
  }, [gym, scheduleUndoableDelete]);

  const handleDeleteGymDayTemplate = useCallback((id: string) => {
    const day = gym.dayTemplates.find(item => item.id === id);
    if (!day) return;
    scheduleUndoableDelete({
      key: `gym_day:${id}`,
      kind: 'gym_day',
      label: 'workout day',
      title: 'Workout day deleted',
      message: day.name,
      finalize: () => gym.deleteDayTemplate(id),
    });
  }, [gym, scheduleUndoableDelete]);

  const handleDeleteGymExercise = useCallback((id: string) => {
    const exercise = gym.exercises.find(item => item.id === id);
    if (!exercise) return;
    scheduleUndoableDelete({
      key: `gym_exercise:${id}`,
      kind: 'gym_exercise',
      label: 'exercise',
      title: 'Exercise deleted',
      message: exercise.name,
      finalize: () => gym.deleteExercise(id),
    });
  }, [gym, scheduleUndoableDelete]);

  const handleDeleteGymDayExercise = useCallback((id: string) => {
    const dayExercise = gym.dayExercises.find(item => item.id === id);
    const exerciseName = dayExercise
      ? gym.exercises.find(item => item.id === dayExercise.exerciseId)?.name ?? 'Exercise'
      : null;
    if (!dayExercise) return;
    scheduleUndoableDelete({
      key: `gym_day_exercise:${id}`,
      kind: 'gym_day_exercise',
      label: 'planned exercise',
      title: 'Exercise removed from day',
      message: exerciseName ?? 'Exercise',
      finalize: () => gym.deleteDayExercise(id),
    });
  }, [gym, scheduleUndoableDelete]);

  const handleDeleteGymSession = useCallback((id: string) => {
    const session = gym.sessions.find(item => item.id === id);
    if (!session) return;
    scheduleUndoableDelete({
      key: `gym_session:${id}`,
      kind: 'gym_session',
      label: 'session',
      title: 'Workout session deleted',
      message: 'Session removed from history',
      finalize: () => gym.deleteSession(id),
    });
  }, [gym, scheduleUndoableDelete]);

  const calendarController = useMemo(() => ({
    ...calendar,
    events: filteredCalendarEvents,
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
  }), [calendar, filteredCalendarEvents, handleCreateCalendarEvent, handleDeleteCalendarEvent, handleUpdateCalendarEvent]);

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
                  userId={user.id}
                  tasks={filteredTasks}
                  projects={filteredProjects}
                  deadlines={filteredDeadlines}
                  calendarEvents={filteredCalendarEvents}
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
                  planningMetrics={academicPlanningMetrics}
                  onPlanNextDeadlines={() => openAcademicPlanner('dashboard')}
                  nextPlanningTarget={upcomingPlannableDeadlines[0] ?? null}
                  onOpenImportDeadlines={openDeadlineImport}
                  onOpenAiPrompt={openAiWithPrompt}
                  onNavigate={navigateInApp}
                  walkthroughCompleted={walkthroughSnapshot.completed}
                  walkthroughSeen={walkthroughSnapshot.seen}
                  onStartWalkthrough={() => walkthroughRef.current?.open()}
                  onRestartWalkthrough={() => walkthroughRef.current?.restart()}
                />
              }
            />
            <Route
              path="/deadlines"
              element={
                <DeadlinesPage
                  deadlines={filteredDeadlines}
                  projects={filteredProjects}
                  tasks={filteredTasks}
                  initialCourseFilter={deadlineCourseFilterId}
                  initialDetailId={deadlineFocusId}
                  initialImportOpen={deadlineImportRequested}
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
                  onOpenPlanner={(deadlineIds) => openAcademicPlanner('deadline', deadlineIds)}
                  userId={user.id}
                  onCreateLinkedTask={async (title, projectId, dueDate) => handleAddTask(title, '', 'medium', projectId, dueDate, 'none')}
                  calendarEvents={filteredCalendarEvents}
                />
              }
            />
            <Route
              path="/tasks"
              element={
                <TaskBoard
                  tasks={filteredTasks}
                  projects={filteredProjects}
                  deadlines={filteredDeadlines}
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
                  projects={filteredProjects}
                  tasks={filteredTasks}
                  deadlines={filteredDeadlines}
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
                  deadlines={filteredDeadlines}
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
                  tasks={filteredTasks}
                  projects={filteredProjects}
                  deadlines={filteredDeadlines}
                  onUpdateDueDate={handleUpdateTaskDueDate}
                />
              }
            />
            <Route
              path="/gym"
              element={
                <GymPage
                  userId={user.id}
                  plans={filteredGymPlans}
                  dayTemplates={filteredGymDayTemplates}
                  exercises={filteredGymExercises}
                  dayExercises={filteredGymDayExercises}
                  sessions={filteredGymSessions}
                  exerciseLogs={filteredGymExerciseLogs}
                  setLogs={filteredGymSetLogs}
                  activePlan={filteredGymActivePlan}
                  activeSession={filteredGymActiveSession}
                  onAddPlan={gym.addPlan}
                  onUpdatePlan={gym.updatePlan}
                  onDeletePlan={handleDeleteGymPlan}
                  onAddDayTemplate={gym.addDayTemplate}
                  onUpdateDayTemplate={gym.updateDayTemplate}
                  onDeleteDayTemplate={handleDeleteGymDayTemplate}
                  onAddExercise={gym.addExercise}
                  onUpdateExercise={gym.updateExercise}
                  onDeleteExercise={handleDeleteGymExercise}
                  onAddDayExercise={gym.addDayExercise}
                  onUpdateDayExercise={gym.updateDayExercise}
                  onDeleteDayExercise={handleDeleteGymDayExercise}
                  onStartSession={gym.startSession}
                  onCompleteSession={gym.completeSession}
                  onDeleteSession={handleDeleteGymSession}
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
            tasks={filteredTasks}
            deadlines={filteredDeadlines}
            projects={filteredProjects}
            plans={filteredGymPlans}
            dayTemplates={filteredGymDayTemplates}
            exercises={filteredGymExercises}
            dayExercises={filteredGymDayExercises}
            calendarEvents={filteredCalendarEvents}
            calendarCalendars={calendar.calendars}
            selectedCalendarId={calendar.selectedCalendarId}
            getCalendarEventsForRange={calendar.getEventsForRange}
            onAddTask={handleAddTask}
            onUpdateTask={handleUpdateTask}
            onAddDeadline={handleAddDeadline}
            onUpdateDeadline={handleUpdateDeadline}
            onAddProject={handleAddProject}
            onAddSubtask={handleAddSubtask}
            onDeleteSubtask={handleDeleteSubtask}
            onDeleteTask={handleDeleteTask}
            onLinkTask={handleLinkTask}
            onCreateCalendarEvent={handleCreateCalendarEvent}
            onUpdateCalendarEvent={handleUpdateCalendarEvent}
            onDeleteCalendarEvent={handleDeleteCalendarEvent}
            onOpenAcademicPlanner={(deadlineIds) => openAcademicPlanner('ai', deadlineIds)}
            onOpenDeadlineImport={openDeadlineImport}
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
            habits={filteredHabits}
            onAddHabit={handleAddHabit}
            onToggleHabit={handleToggleHabit}
            onDeleteHabit={handleDeleteHabit}
          />
        )}
        </div>
      </div>

      {searchOpen && (
        <GlobalSearch
          tasks={filteredTasks}
          projects={filteredProjects}
          deadlines={filteredDeadlines}
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
        tasks={filteredTasks}
        deadlines={filteredDeadlines}
        projects={filteredProjects}
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
          habits={filteredHabits}
          isLoading={habits.isLoading}
          onToggle={handleToggleHabit}
          onAdd={handleAddHabit}
          onDelete={handleDeleteHabit}
          onClose={() => setHabitsOpen(false)}
          anchorRef={habitsButtonRef}
        />
      )}

      <AcademicPlanningModal
        open={academicPlanningOpen}
        selectedDeadlines={selectedAcademicPlanningDeadlines}
        proposal={academicPlanningProposal}
        isGenerating={academicPlanningGenerating}
        isApplying={academicPlanningApplying}
        applyingBlockIds={academicPlanningApplyingIds}
        onClose={() => setAcademicPlanningOpen(false)}
        onRegenerate={handleRegenerateAcademicPlan}
        onAcceptAll={() => void applyAcademicPlanBlocks()}
        onAcceptOne={(blockId) => void applyAcademicPlanBlocks([blockId])}
        onRejectAll={handleRejectAcademicPlan}
        onRemoveBlock={handleRemoveAcademicPlanBlock}
        onUpdateBlock={handleUpdateAcademicPlanBlock}
      />

      {!aiOpen && (
        <button
          type="button"
          onClick={openAiPanel}
          data-walkthrough="ai"
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
        {(() => {
          const groups: Array<{ key: string; toasts: Toast[] }> = [];
          for (const toast of toasts) {
            const last = groups[groups.length - 1];
            const groupKey = `${toast.tone}::${toast.title}`;
            if (last && last.key === groupKey) {
              last.toasts.push(toast);
            } else {
              groups.push({ key: groupKey, toasts: [toast] });
            }
          }
          return groups.map(group => {
            const count = group.toasts.length;
            const first = group.toasts[0];
            const actionableToasts = group.toasts.filter(t => t.action);
            const summaryMessage = count > 1
              ? (() => {
                  const names = group.toasts
                    .map(t => t.message)
                    .filter((m): m is string => Boolean(m));
                  if (names.length === 0) return `${count} items`;
                  if (names.length <= 2) return names.join(', ');
                  return `${names.slice(0, 2).join(', ')} + ${names.length - 2} more`;
                })()
              : first.message;
            const titleText = count > 1 ? `${first.title} (${count})` : first.title;
            return (
              <div
                key={group.toasts.map(t => t.id).join('-')}
                className={cn(
                  'pointer-events-auto overflow-hidden rounded-lg border shadow-sm',
                  first.tone === 'error'
                    ? 'border-red-500/20 bg-red-500/10'
                    : first.tone === 'success'
                      ? 'border-emerald-500/20 bg-emerald-500/10'
                      : 'border-[var(--accent)]/20 bg-[var(--accent-soft)]'
                )}
                style={{ backgroundColor: 'var(--surface-elevated)' }}
              >
                <div className="flex items-start gap-3 px-4 py-3 text-sm">
                  <div className="mt-0.5 shrink-0">
                    {first.tone === 'error'
                      ? <AlertCircle size={16} className="text-red-400" />
                      : <CheckCircle2 size={16} className={first.tone === 'success' ? 'text-emerald-400' : 'text-[var(--accent)]'} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[var(--text-primary)]">{titleText}</div>
                    {summaryMessage && <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{summaryMessage}</div>}
                    {actionableToasts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          for (const t of actionableToasts) t.action?.onClick();
                        }}
                        className="mt-2 inline-flex items-center rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface)]"
                      >
                        {actionableToasts[0].action?.label ?? 'Undo'}
                        {actionableToasts.length > 1 ? ` all` : ''}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      for (const t of group.toasts) dismissToast(t.id);
                    }}
                    className="rounded-full p-1 text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          });
        })()}
      </div>

      <WalkthroughController
        ref={walkthroughRef}
        userId={user.id}
        hasDeadlines={filteredDeadlines.length > 0}
        hasPlan={(academicPlanningMetrics.generated ?? 0) > 0}
        hasReviewReady={hasStudyReviewReady}
        onOpenImportDeadlines={openDeadlineImport}
        onOpenPlanner={() => openAcademicPlanner('dashboard')}
        onOpenAiPrompt={openAiWithPrompt}
        onOpenStudyReview={openStudyReviewFromWalkthrough}
        onClosePlanner={() => setAcademicPlanningOpen(false)}
        onCloseAiPanel={() => setAiOpen(false)}
      />
    </div>
  );
}
