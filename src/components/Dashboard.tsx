import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock, AlertCircle, TrendingUp, FolderKanban, ListTodo, BarChart3, Target } from 'lucide-react';
import type { GoogleCalendarEvent } from '../lib/googleCalendar';
import type { StudyBlockOutcome } from '../hooks/useStudyBlockOutcomes';
import { Task, Project, Deadline, StudyBlockOutcomeStatus } from '../types';
import { cn } from '../utils/cn';
import { isStudyBlockLikeCalendarEvent } from '../utils/studyBlockDetection';

interface DashboardProps {
  tasks: Task[];
  projects: Project[];
  deadlines?: Deadline[];
  calendarEvents: GoogleCalendarEvent[];
  studyBlockOutcomes: Record<string, StudyBlockOutcome>;
  getStudyBlockOutcome: (event: GoogleCalendarEvent) => StudyBlockOutcome | undefined;
  studyBlockOutcomesLoading: boolean;
  onSetStudyBlockOutcome: (event: GoogleCalendarEvent, status: StudyBlockOutcomeStatus) => Promise<boolean>;
  onStudyReviewPromptShown?: (count: number) => void;
  behaviorSummary?: string;
  proactivePrompts?: string[];
  onUseBehaviorPrompt?: (prompt: string) => void;
}

const STUDY_OUTCOME_OPTIONS: { status: StudyBlockOutcomeStatus; label: string }[] = [
  { status: 'completed', label: 'Done' },
  { status: 'partial', label: 'Partial' },
  { status: 'skipped', label: 'Skipped' },
  { status: 'rescheduled', label: 'Rescheduled' },
];

function getEventDateKey(event: GoogleCalendarEvent): string | null {
  if (event.start?.date) return event.start.date;
  if (event.start?.dateTime) return event.start.dateTime.slice(0, 10);
  return null;
}

function hasEventEnded(event: GoogleCalendarEvent, now = new Date()) {
  if (event.end?.dateTime) {
    return new Date(event.end.dateTime).getTime() <= now.getTime();
  }
  if (event.end?.date) {
    return new Date(`${event.end.date}T00:00:00`).getTime() <= now.getTime();
  }
  const dateKey = getEventDateKey(event);
  if (!dateKey) return false;
  return new Date(`${dateKey}T23:59:59`).getTime() <= now.getTime();
}

function getEventTimeLabel(date?: { date?: string; dateTime?: string }) {
  if (date?.date) return 'All day';
  if (date?.dateTime) {
    return new Date(date.dateTime).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return '';
}

function getOutcomeTone(status: StudyBlockOutcomeStatus) {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500/12 text-emerald-300 border-emerald-500/20';
    case 'partial':
      return 'bg-amber-500/12 text-amber-300 border-amber-500/20';
    case 'skipped':
      return 'bg-rose-500/12 text-rose-300 border-rose-500/20';
    case 'rescheduled':
      return 'bg-sky-500/12 text-sky-300 border-sky-500/20';
  }
}

function getOutcomeLabel(status: StudyBlockOutcomeStatus) {
  return STUDY_OUTCOME_OPTIONS.find(option => option.status === status)?.label ?? status;
}

function OutcomeBadge({ status }: { status: StudyBlockOutcomeStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]', getOutcomeTone(status))}>
      {getOutcomeLabel(status)}
    </span>
  );
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
      <span className="text-xs text-[var(--text-faint)] w-8 text-right">{value}</span>
    </div>
  );
}

export function Dashboard({
  tasks,
  projects,
  deadlines = [],
  calendarEvents,
  studyBlockOutcomes,
  getStudyBlockOutcome,
  studyBlockOutcomesLoading,
  onSetStudyBlockOutcome,
  onStudyReviewPromptShown,
  behaviorSummary,
  proactivePrompts = [],
  onUseBehaviorPrompt,
}: DashboardProps) {
  const [savingOutcomeId, setSavingOutcomeId] = useState<string | null>(null);
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

  // Tasks created per day over last 7 days
  const weeklyChart = useMemo(() => {
    const days: { label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { weekday: 'short' });
      const count = tasks.filter(t => {
        const created = t.createdAt.slice(0, 10);
        return created === dayStr;
      }).length;
      days.push({ label, count });
    }
    return days;
  }, [tasks]);

  const maxWeekly = Math.max(...weeklyChart.map(d => d.count), 1);

  // Priority distribution
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
    const todayKey = new Date().toISOString().slice(0, 10);
    return pendingStudyReview.filter(event => getEventDateKey(event) === todayKey).length;
  }, [pendingStudyReview]);

  useEffect(() => {
    if (!onStudyReviewPromptShown || pendingStudyReview.length === 0) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    const promptKey = `${todayKey}:${pendingStudyReview.length}:${pendingStudyReview.map(event => event.id).join(',')}`;
    if (lastPromptKeyRef.current === promptKey) return;
    lastPromptKeyRef.current = promptKey;
    onStudyReviewPromptShown(pendingStudyReview.length);
  }, [onStudyReviewPromptShown, pendingStudyReview]);

  const handleOutcomeClick = async (event: GoogleCalendarEvent, status: StudyBlockOutcomeStatus) => {
    setSavingOutcomeId(event.id);
    await onSetStudyBlockOutcome(event, status);
    setSavingOutcomeId(current => (current === event.id ? null : current));
  };

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-5">
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

          <div className="mt-4 space-y-3">
            {pendingStudyReview.map(event => {
              const dateKey = getEventDateKey(event);
              const dateLabel = dateKey
                ? new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })
                : 'Unknown day';
              return (
                <div key={event.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3.5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {event.summary || 'Untitled event'}
                        </h4>
                        {getStudyBlockOutcome(event) && <OutcomeBadge status={getStudyBlockOutcome(event)!.status} />}
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">
                        {dateLabel} · {getEventTimeLabel(event.start)}
                        {event.end?.dateTime ? ` - ${getEventTimeLabel(event.end)}` : ''}
                        {event.calendarSummary ? ` · ${event.calendarSummary}` : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {STUDY_OUTCOME_OPTIONS.map(option => (
                        <button
                          key={option.status}
                          type="button"
                          onClick={() => void handleOutcomeClick(event, option.status)}
                          disabled={savingOutcomeId === event.id}
                          className="rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {savingOutcomeId === event.id ? 'Saving…' : option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<ListTodo size={22} />} label="Total Tasks" value={tasks.length} color="text-indigo-400" bg="bg-indigo-400/10" />
        <StatCard icon={<Clock size={22} />} label="In Progress" value={inProgress.length} color="text-blue-400" bg="bg-blue-400/10" />
        <StatCard icon={<CheckCircle2 size={22} />} label="Completed" value={done.length} color="text-emerald-400" bg="bg-emerald-400/10" />
        <StatCard icon={<AlertCircle size={22} />} label="Overdue" value={overdue.length} color="text-red-400" bg="bg-red-400/10" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Completion Progress */}
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Completion Rate</h3>
          </div>
          <div className="flex items-center justify-center py-4">
            <div className="relative w-32 h-32">
              <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border-soft)" strokeWidth="10" />
                <circle
                  cx="60" cy="60" r="50" fill="none" stroke="#6366f1" strokeWidth="10"
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

        {/* Weekly Activity Chart */}
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={18} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tasks Created This Week</h3>
          </div>
          <div className="flex items-end gap-2 h-32 mt-4">
            {weeklyChart.map((day, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center" style={{ height: '100px' }}>
                  <div
                    className="w-full max-w-[24px] rounded-t-md transition-all"
                    style={{
                      height: `${Math.max(4, (day.count / maxWeekly) * 100)}%`,
                      backgroundColor: day.count > 0 ? '#6366f1' : 'var(--border-soft)',
                    }}
                  />
                </div>
                <span className="text-[9px] text-[var(--text-faint)]">{day.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Priority Distribution */}
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle size={18} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Active by Priority</h3>
          </div>
          <div className="space-y-4 mt-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-red-400 font-medium">High</span>
              </div>
              <MiniBar value={priorityDist.high} max={tasks.length} color="#ef4444" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-yellow-400 font-medium">Medium</span>
              </div>
              <MiniBar value={priorityDist.medium} max={tasks.length} color="#f59e0b" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[var(--text-faint)] font-medium">Low</span>
              </div>
              <MiniBar value={priorityDist.low} max={tasks.length} color="#6b7280" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--border-soft)] flex justify-between text-xs text-[var(--text-faint)]">
            <span>{priorityDist.high + priorityDist.medium + priorityDist.low} active</span>
            <span>{highPriority.length} need attention</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Tasks */}
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Recent Tasks</h3>
          <div className="space-y-3">
            {recentTasks.map(task => (
              <div key={task.id} className="flex items-center justify-between border-b border-[var(--border-soft)] py-2 last:border-0">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', statusColor(task.status))}>
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

        {/* Upcoming Deadlines */}
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Target size={18} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Upcoming Deadlines</h3>
          </div>
          <div className="space-y-3">
            {(() => {
              const now = new Date();
              now.setHours(0, 0, 0, 0);
              const upcomingDl = deadlines
                .filter(d => d.status !== 'done' && d.status !== 'missed' && new Date(d.dueDate + 'T00:00:00') >= now)
                .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                .slice(0, 5);
              const overdueDl = deadlines
                .filter(d => d.status !== 'done' && d.status !== 'missed' && new Date(d.dueDate + 'T00:00:00') < now);

              return (
                <>
                  {overdueDl.length > 0 && (
                    <div className="rounded-lg bg-red-400/10 px-3 py-2 mb-2">
                      <span className="text-xs font-medium text-red-400">{overdueDl.length} overdue deadline{overdueDl.length !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {upcomingDl.map(dl => {
                    const due = new Date(dl.dueDate + 'T00:00:00');
                    const daysLeft = Math.ceil((due.getTime() - now.getTime()) / 86400000);
                    const project = projects.find(p => p.id === dl.projectId);
                    return (
                      <div key={dl.id} className="flex items-center justify-between border-b border-[var(--border-soft)] py-2 last:border-0">
                        <div className="flex items-center gap-3 min-w-0">
                          {project && <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: project.color }} />}
                          <div className="min-w-0">
                            <span className="truncate text-sm text-[var(--text-secondary)] block">{dl.title}</span>
                            <span className="text-[10px] text-[var(--text-faint)] uppercase">{dl.type}</span>
                          </div>
                        </div>
                        <span className={cn('text-xs font-medium whitespace-nowrap', daysLeft <= 1 ? 'text-red-400' : daysLeft <= 3 ? 'text-yellow-400' : 'text-[var(--text-faint)]')}>
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

      {/* Courses Overview */}
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <div className="mb-4 flex items-center gap-2">
          <FolderKanban size={18} className="text-indigo-400" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Courses Overview</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map(project => {
            const projectTasks = tasks.filter(t => t.projectId === project.id);
            const projectDone = projectTasks.filter(t => t.status === 'done').length;
            const progress = projectTasks.length > 0 ? Math.round((projectDone / projectTasks.length) * 100) : 0;

            return (
              <div key={project.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4 transition-colors hover:border-[var(--border-strong)]">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: project.color }} />
                  <h4 className="text-sm font-medium text-[var(--text-primary)] truncate">{project.name}</h4>
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
    </div>
  );
}
