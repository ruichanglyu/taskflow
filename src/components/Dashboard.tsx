import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock, AlertCircle, TrendingUp, FolderKanban, ListTodo, BarChart3, Target, Sparkles, X } from 'lucide-react';
import type { GoogleCalendarEvent } from '../lib/googleCalendar';
import type { StudyBlockOutcome } from '../hooks/useStudyBlockOutcomes';
import { Task, Project, Deadline, StudyBlockOutcomeStatus } from '../types';
import { cn } from '../utils/cn';
import { isStudyBlockLikeCalendarEvent } from '../utils/studyBlockDetection';
import { getEventDateKey, hasEventEnded, getEventTimeLabel } from '../utils/calendarEventHelpers';
import {
  STUDY_OUTCOME_OPTIONS,
  STUDY_REFLECTION_OPTIONS,
  buildStudyOutcomeNotes,
  OutcomeBadge,
  parseStudyOutcomeReflection,
  ReflectionBadge,
} from '../utils/studyOutcomes';
import { getCalendarEventPresentation } from '../utils/calendarEventPresentation';
import { formatDateKey } from '../utils/dateHelpers';

interface DashboardProps {
  userId: string;
  tasks: Task[];
  projects: Project[];
  deadlines?: Deadline[];
  calendarEvents: GoogleCalendarEvent[];
  studyBlockOutcomes: Record<string, StudyBlockOutcome>;
  getStudyBlockOutcome: (event: GoogleCalendarEvent) => StudyBlockOutcome | undefined;
  studyBlockOutcomesLoading: boolean;
  onSetStudyBlockOutcome: (event: GoogleCalendarEvent, status: StudyBlockOutcomeStatus, notes?: string) => Promise<boolean>;
  onStudyReviewPromptShown?: (count: number) => void;
  behaviorSummary?: string;
  proactivePrompts?: string[];
  onUseBehaviorPrompt?: (prompt: string) => void;
  planningMetrics?: {
    generated: number;
    accepted: number;
    edited: number;
    rejected: number;
    acceptanceRate: number | null;
    completionRate: number | null;
  };
  onPlanNextDeadlines?: () => void;
  nextPlanningTarget?: Deadline | null;
  onOpenImportDeadlines?: () => void;
  onOpenAiPrompt?: (prompt: string) => void;
  onNavigate?: (to: string) => void;
  walkthroughCompleted?: boolean;
  walkthroughSeen?: boolean;
  onStartWalkthrough?: () => void;
  onRestartWalkthrough?: () => void;
}

function SummaryPill({ label, value, pulse }: { label: string; value: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
      {pulse && <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />}
      <span className="font-medium text-[var(--text-primary)]">{value}</span>
      <span className="text-[var(--text-faint)]">{label}</span>
    </div>
  );
}

function StatCard({ icon, label, value, color, bg }: { icon: React.ReactNode; label: string; value: number; color: string; bg: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--border-strong)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">{label}</p>
          <p className="text-3xl font-bold text-[var(--text-primary)]">{value}</p>
        </div>
        <div className={cn('flex h-12 w-12 items-center justify-center rounded-lg', bg)}>
          <span className={color}>{icon}</span>
        </div>
      </div>
    </div>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-[var(--border-soft)]">
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-8 text-right text-xs text-[var(--text-faint)]">{value}</span>
    </div>
  );
}


function StudyReviewModal({
  open,
  events,
  getStudyBlockOutcome,
  savingOutcomeId,
  onClose,
  onSetOutcome,
}: {
  open: boolean;
  events: GoogleCalendarEvent[];
  getStudyBlockOutcome: (event: GoogleCalendarEvent) => StudyBlockOutcome | undefined;
  savingOutcomeId: string | null;
  onClose: () => void;
  onSetOutcome: (event: GoogleCalendarEvent, status: StudyBlockOutcomeStatus, notes?: string) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6" onClick={onClose}>
      <div
        data-walkthrough-modal="study-review"
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-[0_28px_80px_rgba(15,23,42,0.18)]"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-soft)] px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Review study blocks</h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Mark what happened so future planning stays realistic without cluttering the dashboard.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-[var(--text-faint)] transition hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          {events.map(event => {
            const presentation = getCalendarEventPresentation(event);
            const currentOutcome = getStudyBlockOutcome(event);
            const currentReflection = parseStudyOutcomeReflection(currentOutcome?.notes);
            const dateKey = getEventDateKey(event);
            const dateLabel = dateKey
              ? new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })
              : 'Unknown day';

            return (
              <div key={event.id} className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {event.summary || 'Untitled event'}
                      </h4>
                      {currentOutcome && <OutcomeBadge status={currentOutcome.status} />}
                      {currentReflection && <ReflectionBadge reflection={currentReflection} />}
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {dateLabel} · {getEventTimeLabel(event.start)}
                      {event.end?.dateTime ? ` - ${getEventTimeLabel(event.end)}` : ''}
                      {event.calendarSummary ? ` · ${event.calendarSummary}` : ''}
                    </p>
                    {presentation.metadata?.deadlineTitle && (
                      <p className="mt-1 text-[11px] font-medium text-[var(--accent)]">
                        Linked to {presentation.metadata.deadlineTitle}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {STUDY_OUTCOME_OPTIONS.map(option => (
                      <button
                        key={option.status}
                        type="button"
                        onClick={() => onSetOutcome(event, option.status, buildStudyOutcomeNotes({ reflection: currentReflection }))}
                        disabled={savingOutcomeId === event.id}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                          currentOutcome?.status === option.status
                            ? presentation.isSuggested
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                              : 'border-[var(--border-strong)] bg-[var(--surface-muted)] text-[var(--text-primary)]'
                            : 'border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
                        )}
                      >
                        {savingOutcomeId === event.id && currentOutcome?.status === option.status ? 'Saving…' : option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {currentOutcome && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {STUDY_REFLECTION_OPTIONS.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onSetOutcome(event, currentOutcome.status, buildStudyOutcomeNotes({ reflection: option.value }))}
                        disabled={savingOutcomeId === event.id}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                          currentReflection === option.value
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                            : 'border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getTaskCreatedDateKey(task: Task) {
  if (typeof task.createdAt !== 'string') return null;
  const parsed = new Date(task.createdAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function Dashboard({
  userId,
  tasks,
  projects,
  deadlines = [],
  calendarEvents,
  studyBlockOutcomes: _studyBlockOutcomes,
  getStudyBlockOutcome,
  studyBlockOutcomesLoading,
  onSetStudyBlockOutcome,
  onStudyReviewPromptShown,
  behaviorSummary: _behaviorSummary,
  proactivePrompts: _proactivePrompts = [],
  planningMetrics,
  onPlanNextDeadlines,
  nextPlanningTarget,
  onOpenImportDeadlines: _onOpenImportDeadlines,
  onOpenAiPrompt: _onOpenAiPrompt,
  onNavigate: _onNavigate,
  walkthroughCompleted = false,
  walkthroughSeen = false,
  onStartWalkthrough,
  onRestartWalkthrough,
}: DashboardProps) {
  const [savingOutcomeId, setSavingOutcomeId] = useState<string | null>(null);
  const [studyReviewOpen, setStudyReviewOpen] = useState(false);
  const lastPromptKeyRef = useRef<string>('');

  const todo = tasks.filter(t => t.status === 'todo');
  const inProgress = tasks.filter(t => t.status === 'in-progress');
  const done = tasks.filter(t => t.status === 'done');
  const highPriority = tasks.filter(t => t.priority === 'high' && t.status !== 'done');
  const overdue = tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done');
  const activeTasksCount = todo.length + inProgress.length;
  const upcomingDeadlinesCount = deadlines.length > 0
    ? deadlines.filter(d => d.status !== 'done' && d.status !== 'missed' && new Date(d.dueDate + 'T00:00:00') >= new Date()).length
    : tasks.filter(t => t.dueDate && t.status !== 'done' && new Date(t.dueDate) >= new Date()).length;
  const completionRate = tasks.length > 0 ? Math.round((done.length / tasks.length) * 100) : 0;
  const recentTasks = [...tasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);
  const needsLaunchpad = deadlines.length === 0 && tasks.length <= 2;

  const weeklyChart = useMemo(() => {
    const days: { label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { weekday: 'short' });
      const count = tasks.filter(t => {
        const created = getTaskCreatedDateKey(t);
        if (!created) return false;
        return created === dayStr;
      }).length;
      days.push({ label, count });
    }
    return days;
  }, [tasks]);

  const maxWeekly = Math.max(...weeklyChart.map(d => d.count), 1);

  const priorityDist = useMemo(() => {
    const active = tasks.filter(t => t.status !== 'done');
    return {
      high: active.filter(t => t.priority === 'high').length,
      medium: active.filter(t => t.priority === 'medium').length,
      low: active.filter(t => t.priority === 'low').length,
    };
  }, [tasks]);

  const statusColor = (status: string) => {
    if (status === 'done') return 'text-emerald-400 bg-emerald-400/10';
    if (status === 'in-progress') return 'text-blue-400 bg-blue-400/10';
    return 'text-[var(--text-faint)] bg-[var(--surface-muted)]';
  };

  const priorityColor = (p: string) => {
    if (p === 'high') return 'text-red-400';
    if (p === 'medium') return 'text-yellow-400';
    return 'text-[var(--text-faint)]';
  };

  const pendingStudyReview = useMemo(() => {
    const now = new Date();
    return calendarEvents
      .filter(event => {
        if (!event.id) return false;
        if (!isStudyBlockLikeCalendarEvent(event)) return false;
        if (!hasEventEnded(event, now)) return false;
        if (getStudyBlockOutcome(event)) return false;
        return true;
      })
      .sort((a, b) => {
        const aDate = getEventDateKey(a) ?? '';
        const bDate = getEventDateKey(b) ?? '';
        if (aDate !== bDate) return aDate.localeCompare(bDate);
        const aStart = a.start?.dateTime ? new Date(a.start.dateTime).getTime() : 0;
        const bStart = b.start?.dateTime ? new Date(b.start.dateTime).getTime() : 0;
        return aStart - bStart;
      })
      .slice(0, 6);
  }, [calendarEvents, getStudyBlockOutcome]);

  const pendingTodayStudyReviewCount = useMemo(() => {
    const todayKey = formatDateKey(new Date());
    return pendingStudyReview.filter(event => getEventDateKey(event) === todayKey).length;
  }, [pendingStudyReview]);

  useEffect(() => {
    if (!onStudyReviewPromptShown || pendingStudyReview.length === 0) return;
    const todayKey = formatDateKey(new Date());
    const promptKey = `${todayKey}:${pendingStudyReview.length}:${pendingStudyReview.map(event => event.id).join(',')}`;
    if (lastPromptKeyRef.current === promptKey) return;
    lastPromptKeyRef.current = promptKey;
    onStudyReviewPromptShown(pendingStudyReview.length);
  }, [onStudyReviewPromptShown, pendingStudyReview]);

  useEffect(() => {
    const handleOpenStudyReview = (event: Event) => {
      const detail = (event as CustomEvent).detail as { userId?: string } | undefined;
      if (detail?.userId && detail.userId !== userId) return;
      if (pendingStudyReview.length === 0) return;
      setStudyReviewOpen(true);
    };

    const handleCloseStudyReview = () => {
      setStudyReviewOpen(false);
    };

    window.addEventListener('taskflow:open-study-review', handleOpenStudyReview);
    window.addEventListener('taskflow:close-study-review', handleCloseStudyReview);
    return () => {
      window.removeEventListener('taskflow:open-study-review', handleOpenStudyReview);
      window.removeEventListener('taskflow:close-study-review', handleCloseStudyReview);
    };
  }, [pendingStudyReview.length, userId]);

  const handleOutcomeClick = async (event: GoogleCalendarEvent, status: StudyBlockOutcomeStatus, notes = '') => {
    setSavingOutcomeId(event.id);
    await onSetStudyBlockOutcome(event, status, notes);
    setSavingOutcomeId(current => (current === event.id ? null : current));
  };

  return (
    <div className="space-y-6">
      <div data-walkthrough="dashboard-hero" className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">
              Dashboard
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SummaryPill label="active tasks" value={`${activeTasksCount}`} pulse />
            <SummaryPill label="upcoming deadlines" value={`${upcomingDeadlinesCount}`} />
            <SummaryPill label="courses" value={`${projects.length}`} />
          </div>
        </div>
      </div>

      <div data-walkthrough="dashboard-planning" className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <Target size={18} className="text-[var(--accent)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Academic planning loop</h3>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              {nextPlanningTarget
                ? `Your next best planning target is ${nextPlanningTarget.title}, due ${nextPlanningTarget.dueDate}. Turn it into a reviewable study plan before anything touches the calendar.`
                : 'Pick an upcoming deadline and turn it into a realistic study plan before anything touches the calendar.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SummaryPill label="plans generated" value={`${planningMetrics?.generated ?? 0}`} />
            <SummaryPill label="accepted" value={`${planningMetrics?.accepted ?? 0}`} />
            {planningMetrics?.acceptanceRate !== null && planningMetrics?.acceptanceRate !== undefined && (
              <SummaryPill label="accept rate" value={`${planningMetrics.acceptanceRate}%`} />
            )}
            {planningMetrics?.completionRate !== null && planningMetrics?.completionRate !== undefined && (
              <SummaryPill label="completion" value={`${planningMetrics.completionRate}%`} />
            )}
            <button
              type="button"
              onClick={onPlanNextDeadlines}
              data-walkthrough="plan"
              className="rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] transition"
            >
              Plan my next deadlines
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-[var(--accent)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {walkthroughCompleted ? 'Walkthrough completed' : needsLaunchpad ? 'Take the quick walkthrough' : 'Need a quick refresher?'}
              </h3>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              {walkthroughCompleted
                ? 'You already finished the walkthrough. Reopen it anytime for a guided pass through the full TaskFlow flow.'
                : needsLaunchpad
                  ? 'We’ll walk you step-by-step through importing deadlines, planning, calendar, AI, and study reviews — on the real pages.'
                  : 'The guided tour walks through the actual academic flow in TaskFlow so each screen and action makes sense in context.'}
            </p>
          </div>
          <SummaryPill
            label="status"
            value={walkthroughCompleted ? 'Done' : walkthroughSeen ? 'In progress' : 'Not started'}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-4 py-4">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {walkthroughCompleted ? 'Want to run through it again?' : 'Guided tour — 14 focused steps'}
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Covers the full academic loop: deadlines, planning, calendar, AI help, reviews, and the supporting tools around them.
            </p>
          </div>
          <button
            type="button"
            onClick={walkthroughCompleted ? onRestartWalkthrough : onStartWalkthrough}
            className="rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] transition"
          >
            {walkthroughCompleted
              ? 'Replay walkthrough'
              : walkthroughSeen
                ? 'Resume walkthrough'
                : 'Start walkthrough'}
          </button>
        </div>
      </div>

      {pendingStudyReview.length > 0 && (
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">End-of-day study review</h3>
              </div>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                {pendingTodayStudyReviewCount > 0
                  ? `You had ${pendingTodayStudyReviewCount} study block${pendingTodayStudyReviewCount === 1 ? '' : 's'} today that still need a quick outcome.`
                  : `You have ${pendingStudyReview.length} past study block${pendingStudyReview.length === 1 ? '' : 's'} that still need an outcome.`}
              </p>
            </div>
            {studyBlockOutcomesLoading && (
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-faint)]">Loading</span>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {pendingStudyReview.length === 1
                    ? '1 study block is ready for review'
                    : `${pendingStudyReview.length} study blocks are ready for review`}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Next up: {pendingStudyReview[0]?.summary || 'Study block'} · {getEventTimeLabel(pendingStudyReview[0]?.start)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {pendingTodayStudyReviewCount > 0 && (
                  <SummaryPill label="from today" value={`${pendingTodayStudyReviewCount}`} />
                )}
                <button
                  type="button"
                  onClick={() => setStudyReviewOpen(true)}
                  data-walkthrough="review"
                  className="rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] transition"
                >
                  Review now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<ListTodo size={22} />} label="Total Tasks" value={tasks.length} color="text-[var(--chart-accent)]" bg="bg-[var(--chart-accent-soft)]" />
        <StatCard icon={<Clock size={22} />} label="In Progress" value={inProgress.length} color="text-blue-400" bg="bg-blue-400/10" />
        <StatCard icon={<CheckCircle2 size={22} />} label="Completed" value={done.length} color="text-emerald-400" bg="bg-emerald-400/10" />
        <StatCard icon={<AlertCircle size={22} />} label="Overdue" value={overdue.length} color="text-red-400" bg="bg-red-400/10" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-[var(--chart-accent)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Completion Rate</h3>
          </div>
          <div className="flex items-center justify-center py-4">
            <div className="relative h-32 w-32">
              <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border-soft)" strokeWidth="10" />
                <circle
                  cx="60" cy="60" r="50" fill="none" stroke="var(--chart-accent)" strokeWidth="10"
                  strokeDasharray={`${completionRate * 3.14} ${314 - completionRate * 3.14}`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-[var(--text-primary)]">{completionRate}%</span>
              </div>
            </div>
          </div>
          <div className="mt-2 flex justify-between text-xs text-[var(--text-faint)]">
            <span>{done.length} done</span>
            <span>{todo.length + inProgress.length} remaining</span>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 size={18} className="text-[var(--chart-accent)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tasks Created This Week</h3>
          </div>
          <div className="mt-4 flex h-32 items-end gap-2">
            {weeklyChart.map((day, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full items-end justify-center" style={{ height: '100px' }}>
                  <div
                    className="w-full max-w-[24px] rounded-t-md transition-all"
                    style={{
                      height: `${Math.max(4, (day.count / maxWeekly) * 100)}%`,
                      backgroundColor: day.count > 0 ? 'var(--chart-accent)' : 'var(--border-soft)',
                    }}
                  />
                </div>
                <span className="text-[9px] text-[var(--text-faint)]">{day.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <div className="mb-4 flex items-center gap-2">
            <AlertCircle size={18} className="text-[var(--chart-accent)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Active by Priority</h3>
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-red-400">High</span>
              </div>
              <MiniBar value={priorityDist.high} max={tasks.length} color="#ef4444" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-yellow-400">Medium</span>
              </div>
              <MiniBar value={priorityDist.medium} max={tasks.length} color="#f59e0b" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-faint)]">Low</span>
              </div>
              <MiniBar value={priorityDist.low} max={tasks.length} color="#6b7280" />
            </div>
          </div>
          <div className="mt-4 flex justify-between border-t border-[var(--border-soft)] pt-3 text-xs text-[var(--text-faint)]">
            <span>{priorityDist.high + priorityDist.medium + priorityDist.low} active</span>
            <span>{highPriority.length} need attention</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Recent Tasks</h3>
          <div className="space-y-3">
            {recentTasks.map(task => (
              <div key={task.id} className="flex items-center justify-between border-b border-[var(--border-soft)] py-2 last:border-0">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusColor(task.status))}>
                    {task.status === 'in-progress' ? 'In Progress' : task.status === 'todo' ? 'To Do' : 'Done'}
                  </span>
                  <span className="truncate text-sm text-[var(--text-secondary)]">{task.title}</span>
                </div>
                <span className={cn('text-xs font-medium capitalize', priorityColor(task.priority))}>
                  {task.priority}
                </span>
              </div>
            ))}
            {recentTasks.length === 0 && (
              <p className="py-4 text-center text-sm text-[var(--text-faint)]">No tasks yet</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <div className="mb-4 flex items-center gap-2">
            <Target size={18} className="text-[var(--chart-accent)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Upcoming Deadlines</h3>
          </div>
          <div className="space-y-3">
            {(() => {
              const now = new Date();
              now.setHours(0, 0, 0, 0);
              const upcomingDl = deadlines
                .filter(d => d.status !== 'done' && d.status !== 'missed' && new Date(`${d.dueDate}T00:00:00`) >= now)
                .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                .slice(0, 5);
              const overdueDl = deadlines
                .filter(d => d.status !== 'done' && d.status !== 'missed' && new Date(`${d.dueDate}T00:00:00`) < now);

              return (
                <>
                  {overdueDl.length > 0 && (
                    <div className="mb-2 rounded-lg bg-red-400/10 px-3 py-2">
                      <span className="text-xs font-medium text-red-400">{overdueDl.length} overdue deadline{overdueDl.length !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {upcomingDl.map(dl => {
                    const due = new Date(`${dl.dueDate}T00:00:00`);
                    const daysLeft = Math.ceil((due.getTime() - now.getTime()) / 86400000);
                    const project = projects.find(p => p.id === dl.projectId);
                    return (
                      <div key={dl.id} className="flex items-center justify-between border-b border-[var(--border-soft)] py-2 last:border-0">
                        <div className="flex min-w-0 items-center gap-3">
                          {project && <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />}
                          <div className="min-w-0">
                            <span className="block truncate text-sm text-[var(--text-secondary)]">{dl.title}</span>
                            <span className="text-[10px] uppercase text-[var(--text-faint)]">{dl.type}</span>
                          </div>
                        </div>
                        <span className={cn('whitespace-nowrap text-xs font-medium', daysLeft <= 1 ? 'text-red-400' : daysLeft <= 3 ? 'text-yellow-400' : 'text-[var(--text-faint)]')}>
                          {daysLeft === 0 ? 'Today' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft}d left`}
                        </span>
                      </div>
                    );
                  })}
                  {upcomingDl.length === 0 && overdueDl.length === 0 && (
                    <p className="py-4 text-center text-sm text-[var(--text-faint)]">No upcoming deadlines</p>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <div className="mb-4 flex items-center gap-2">
          <FolderKanban size={18} className="text-[var(--chart-accent)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Courses Overview</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map(project => {
            const projectTasks = tasks.filter(t => t.projectId === project.id);
            const projectDone = projectTasks.filter(t => t.status === 'done').length;
            const progress = projectTasks.length > 0 ? Math.round((projectDone / projectTasks.length) * 100) : 0;

            return (
              <div key={project.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4 transition-colors hover:border-[var(--border-strong)]">
                <div className="mb-3 flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: project.color }} />
                  <h4 className="truncate text-sm font-medium text-[var(--text-primary)]">{project.name}</h4>
                </div>
                <div className="mb-2 h-1.5 w-full rounded-full bg-[var(--border-soft)]">
                  <div className="h-1.5 rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: project.color }} />
                </div>
                <div className="flex justify-between text-xs text-[var(--text-faint)]">
                  <span>{projectTasks.length} tasks</span>
                  <span>{progress}%</span>
                </div>
              </div>
            );
          })}
          {projects.length === 0 && (
            <p className="col-span-full py-4 text-center text-sm text-[var(--text-faint)]">No courses yet</p>
          )}
        </div>
      </div>

      <StudyReviewModal
        open={studyReviewOpen}
        events={pendingStudyReview}
        getStudyBlockOutcome={getStudyBlockOutcome}
        savingOutcomeId={savingOutcomeId}
        onClose={() => setStudyReviewOpen(false)}
        onSetOutcome={(event, status, notes) => {
          void handleOutcomeClick(event, status, notes);
        }}
      />

    </div>
  );
}
