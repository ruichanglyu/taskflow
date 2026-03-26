import { useMemo } from 'react';
import { CheckCircle2, Clock, AlertCircle, TrendingUp, FolderKanban, ListTodo, BarChart3, Target } from 'lucide-react';
import { Task, Project, Deadline } from '../types';
import { cn } from '../utils/cn';

interface DashboardProps {
  tasks: Task[];
  projects: Project[];
  deadlines?: Deadline[];
}

function StatCard({ icon, label, value, color, bg }: { icon: React.ReactNode; label: string; value: number; color: string; bg: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-sm transition-colors hover:border-[var(--border-strong)] hover:shadow-lg">
      <div className="flex items-center justify-between">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">{label}</p>
          <p className="text-3xl font-bold text-[var(--text-primary)]">{value}</p>
        </div>
        <div className={cn('flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm', bg)}>
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

export function Dashboard({ tasks, projects, deadlines = [] }: DashboardProps) {
  const todo = tasks.filter(t => t.status === 'todo');
  const inProgress = tasks.filter(t => t.status === 'in-progress');
  const done = tasks.filter(t => t.status === 'done');
  const highPriority = tasks.filter(t => t.priority === 'high' && t.status !== 'done');
  const overdue = tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done');

  const completionRate = tasks.length > 0 ? Math.round((done.length / tasks.length) * 100) : 0;

  const recentTasks = [...tasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);

  // Tasks completed per day over last 7 days
  const weeklyChart = useMemo(() => {
    const days: { label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { weekday: 'short' });
      // Count tasks created on this day (as a proxy for activity)
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

  // Upcoming deadlines
  const upcoming = useMemo(() => {
    const now = new Date();
    return tasks
      .filter(t => t.dueDate && t.status !== 'done' && new Date(t.dueDate) >= now)
      .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
      .slice(0, 5);
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

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[28px] border border-[var(--border-soft)] bg-[linear-gradient(135deg,rgba(14,165,233,0.16),rgba(34,197,94,0.08)_42%,rgba(15,23,42,0.02)_100%)] p-5 shadow-[0_24px_80px_var(--shadow-color)]">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">
            Dashboard
          </h1>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<ListTodo size={22} />} label="Total Tasks" value={tasks.length} color="text-indigo-400" bg="bg-indigo-400/10" />
        <StatCard icon={<Clock size={22} />} label="In Progress" value={inProgress.length} color="text-blue-400" bg="bg-blue-400/10" />
        <StatCard icon={<CheckCircle2 size={22} />} label="Completed" value={done.length} color="text-emerald-400" bg="bg-emerald-400/10" />
        <StatCard icon={<AlertCircle size={22} />} label="Overdue" value={overdue.length} color="text-red-400" bg="bg-red-400/10" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Completion Progress */}
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-sm">
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
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={18} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Weekly Activity</h3>
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
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-sm">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Tasks */}
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-sm">
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
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Target size={18} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Upcoming Deadlines</h3>
          </div>
          <div className="space-y-3">
            {deadlines.length > 0 ? (
              (() => {
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
                      <div className="rounded-md bg-red-400/10 px-3 py-2 mb-2">
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
              })()
            ) : (
              // Fallback: show task-based upcoming if no deadlines exist yet
              <>
                {upcoming.map(task => {
                  const due = new Date(task.dueDate!);
                  const daysLeft = Math.ceil((due.getTime() - Date.now()) / 86400000);
                  const project = projects.find(p => p.id === task.projectId);
                  return (
                    <div key={task.id} className="flex items-center justify-between border-b border-[var(--border-soft)] py-2 last:border-0">
                      <div className="flex items-center gap-3 min-w-0">
                        {project && <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: project.color }} />}
                        <span className="truncate text-sm text-[var(--text-secondary)]">{task.title}</span>
                      </div>
                      <span className={cn('text-xs font-medium whitespace-nowrap', daysLeft <= 1 ? 'text-red-400' : daysLeft <= 3 ? 'text-yellow-400' : 'text-[var(--text-faint)]')}>
                        {daysLeft === 0 ? 'Today' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft}d left`}
                      </span>
                    </div>
                  );
                })}
                {upcoming.length === 0 && (
                  <p className="py-4 text-center text-sm text-[var(--text-faint)]">No upcoming deadlines</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Courses Overview */}
      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <FolderKanban size={18} className="text-indigo-400" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Courses Overview</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(project => {
            const projectTasks = tasks.filter(t => t.projectId === project.id);
            const projectDone = projectTasks.filter(t => t.status === 'done').length;
            const progress = projectTasks.length > 0 ? Math.round((projectDone / projectTasks.length) * 100) : 0;

            return (
              <div key={project.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
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
