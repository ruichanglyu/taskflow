import { useMemo, useState } from 'react';
import { Plus, Trash2, FolderOpen, Target, X, ArrowRight, Clock3, ListTodo } from 'lucide-react';
import { Task, Project, Deadline } from '../types';
import { cn } from '../utils/cn';

interface ProjectListProps {
  projects: Project[];
  tasks: Task[];
  deadlines: Deadline[];
  onAddProject: (name: string, description: string) => Promise<string | null> | void;
  onDeleteProject: (id: string) => void;
}

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function deadlineDate(deadline: Deadline) {
  return new Date(`${deadline.dueDate}T00:00:00`);
}

export function ProjectList({ projects, tasks, deadlines, onAddProject, onDeleteProject }: ProjectListProps) {
  const [showForm, setShowForm] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const today = startOfToday();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onAddProject(name.trim(), description.trim());
    setName('');
    setDescription('');
    setShowForm(false);
  };

  const selectedProject = selectedProjectId ? projects.find(project => project.id === selectedProjectId) ?? null : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Courses</h1>
          <p className="mt-1 text-[var(--text-muted)]">Organize your work by course</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 self-start rounded-lg px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition-colors"
          style={{ backgroundColor: 'var(--accent-strong)' }}
        >
          <Plus size={15} /> New Course
        </button>
      </div>

      {/* Add Project Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Project name"
            autoFocus
            className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Brief description"
            className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-[var(--border-soft)] px-4 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] transition-colors disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent-strong)' }}
            >
              Create
            </button>
          </div>
        </form>
      )}

      {/* Project Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map(project => {
          const projectTasks = tasks.filter(t => t.projectId === project.id);
          const projectDeadlines = deadlines
            .filter(d => d.projectId === project.id)
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.dueTime ?? '').localeCompare(b.dueTime ?? ''));
          const done = projectTasks.filter(t => t.status === 'done').length;
          const inProgress = projectTasks.filter(t => t.status === 'in-progress').length;
          const todo = projectTasks.filter(t => t.status === 'todo').length;
          const progress = projectTasks.length > 0 ? Math.round((done / projectTasks.length) * 100) : 0;
          const activeDeadlines = projectDeadlines.filter(d => d.status !== 'done' && d.status !== 'missed');
          const upcomingDeadlines = activeDeadlines.filter(d => deadlineDate(d) >= today);
          const nextDeadline = upcomingDeadlines[0] ?? null;

          return (
            <button
              key={project.id}
              type="button"
              onClick={() => setSelectedProjectId(project.id)}
              className="group rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-5 text-left transition-all hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)]"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: project.color + '20' }}>
                    <FolderOpen size={20} style={{ color: project.color }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">{project.name}</h3>
                    <p className="mt-0.5 text-xs text-[var(--text-faint)]">{project.description || 'No description'}</p>
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setConfirmDeleteProject(project); }}
                  className="p-1 text-[var(--text-faint)] opacity-0 transition-all group-hover:opacity-100 hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex justify-between text-xs text-[var(--text-faint)]">
                  <span>Progress</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-[var(--surface-muted)]">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{ width: `${progress}%`, backgroundColor: project.color }}
                  />
                </div>
              </div>

              <div className="mt-4 flex gap-3 border-t border-[var(--border-soft)] pt-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-[var(--text-faint)]" />
                  <span className="text-xs text-[var(--text-faint)]">{todo} todo</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-blue-400" />
                  <span className="text-xs text-[var(--text-faint)]">{inProgress} active</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs text-[var(--text-faint)]">{done} done</span>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
                    <Target size={13} />
                    Deadline Snapshot
                  </div>
                  <span className="text-[10px] text-[var(--text-faint)]">
                    {projectDeadlines.length} total
                  </span>
                </div>

                <div className="mt-3 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Next deadline</div>
                  {nextDeadline ? (
                    <div className="mt-1.5">
                      <div className="text-sm font-medium text-[var(--text-primary)]">{nextDeadline.title}</div>
                      <div className="mt-0.5 text-xs text-[var(--text-faint)]">
                        {new Date(`${nextDeadline.dueDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {nextDeadline.dueTime ? ` · ${nextDeadline.dueTime}` : ''}
                      </div>
                    </div>
                  ) : projectDeadlines.length > 0 ? (
                    <div className="mt-1.5 text-xs text-[var(--text-faint)]">No active deadlines right now.</div>
                  ) : (
                    <div className="mt-1.5 text-xs text-[var(--text-faint)]">No deadlines for this course yet.</div>
                  )}
                </div>
              </div>

              <p className="mt-3 text-[10px] text-[var(--text-faint)]">
                Created {new Date(project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </button>
          );
        })}

        {projects.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] py-16">
            <FolderOpen size={40} className="mb-3 text-[var(--text-faint)]" />
            <p className="text-sm text-[var(--text-muted)]">No projects yet</p>
            <p className="mt-1 text-xs text-[var(--text-faint)]">Create your first project to get started</p>
          </div>
        )}
      </div>

      {selectedProject && (
        <CourseDetailModal
          project={selectedProject}
          tasks={tasks.filter(task => task.projectId === selectedProject.id)}
          deadlines={deadlines.filter(deadline => deadline.projectId === selectedProject.id)}
          onClose={() => setSelectedProjectId(null)}
        />
      )}

      {confirmDeleteProject && (
        <DeleteCourseConfirmModal
          project={confirmDeleteProject}
          onCancel={() => setConfirmDeleteProject(null)}
          onConfirm={() => {
            onDeleteProject(confirmDeleteProject.id);
            setConfirmDeleteProject(null);
            if (selectedProjectId === confirmDeleteProject.id) {
              setSelectedProjectId(null);
            }
          }}
        />
      )}
    </div>
  );
}

function DeleteCourseConfirmModal({ project, onCancel, onConfirm }: {
  project: Project;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="border-b border-[var(--border-soft)] px-5 py-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Delete course?</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            You’re about to remove <span className="font-medium text-[var(--text-primary)]">{project.name}</span>.
          </p>
        </div>
        <div className="px-5 py-4 text-sm text-[var(--text-secondary)]">
          Tasks in this course will lose their course association. This action can’t be undone from the app.
        </div>
        <div className="flex gap-3 border-t border-[var(--border-soft)] px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-[var(--border-soft)] py-2.5 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-400"
          >
            Delete Course
          </button>
        </div>
      </div>
    </div>
  );
}

function CourseDetailModal({ project, tasks, deadlines, onClose }: {
  project: Project;
  tasks: Task[];
  deadlines: Deadline[];
  onClose: () => void;
}) {
  const today = startOfToday();
  const sortedDeadlines = useMemo(
    () => [...deadlines].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.dueTime ?? '').localeCompare(b.dueTime ?? '')),
    [deadlines]
  );
  const upcomingDeadlines = sortedDeadlines.filter(deadline => {
    if (deadline.status === 'done' || deadline.status === 'missed') return false;
    return deadlineDate(deadline) >= today;
  });
  const overdueDeadlines = sortedDeadlines.filter(deadline => {
    if (deadline.status === 'done' || deadline.status === 'missed') return false;
    return deadlineDate(deadline) < today;
  });
  const activeTasks = tasks.filter(task => task.status !== 'done');
  const completedTasks = tasks.filter(task => task.status === 'done');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="shrink-0 flex items-start justify-between border-b border-[var(--border-soft)] px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: `${project.color}20` }}>
              <FolderOpen size={22} style={{ color: project.color }} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">{project.name}</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{project.description || 'Course overview and workload snapshot'}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryStat label="Upcoming deadlines" value={upcomingDeadlines.length} icon={<CalendarClock size={15} />} tone="default" />
            <SummaryStat label="Overdue" value={overdueDeadlines.length} icon={<AlertTriangle size={15} />} tone="danger" />
            <SummaryStat label="Active tasks" value={activeTasks.length} icon={<ListTodo size={15} />} tone="default" />
            <SummaryStat label="Completed tasks" value={completedTasks.length} icon={<Target size={15} />} tone="success" />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <div className="space-y-4">
              <section className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)]">
                <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Upcoming Deadlines</h3>
                    <p className="mt-0.5 text-xs text-[var(--text-faint)]">What’s due next for this course.</p>
                  </div>
                  <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] text-[var(--text-faint)]">{sortedDeadlines.length} total</span>
                </div>
                <div className="space-y-3 p-4">
                  {sortedDeadlines.length === 0 ? (
                    <EmptyState text="No deadlines for this course yet." />
                  ) : (
                    sortedDeadlines.map(deadline => {
                      const overdue = deadlineDate(deadline) < today && deadline.status !== 'done' && deadline.status !== 'missed';
                      return (
                        <div key={deadline.id} className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="truncate text-sm font-medium text-[var(--text-primary)]">{deadline.title}</h4>
                                <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                                  {deadline.type}
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-faint)]">
                                <span>{new Date(`${deadline.dueDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                {deadline.dueTime && (
                                  <span className="flex items-center gap-1">
                                    <Clock3 size={11} />
                                    {deadline.dueTime}
                                  </span>
                                )}
                                {deadline.notes && <span className="truncate">{deadline.notes}</span>}
                              </div>
                            </div>
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[10px] font-medium',
                                deadline.status === 'done'
                                  ? 'bg-emerald-400/10 text-emerald-400'
                                  : deadline.status === 'missed' || overdue
                                    ? 'bg-red-400/10 text-red-400'
                                    : deadline.status === 'in-progress'
                                      ? 'bg-blue-400/10 text-blue-400'
                                      : 'bg-[var(--surface)] text-[var(--text-faint)]'
                              )}
                            >
                              {overdue ? 'Overdue' : deadline.status.replace('-', ' ')}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </div>

            <div className="space-y-4">
              <section className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)]">
                <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tasks in Progress</h3>
                    <p className="mt-0.5 text-xs text-[var(--text-faint)]">What you still need to work on.</p>
                  </div>
                  <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] text-[var(--text-faint)]">{activeTasks.length} active</span>
                </div>
                <div className="space-y-3 p-4">
                  {tasks.length === 0 ? (
                    <EmptyState text="No tasks linked to this course yet." />
                  ) : activeTasks.length === 0 ? (
                    <EmptyState text="All tasks for this course are completed." />
                  ) : (
                    activeTasks.map(task => (
                      <div key={task.id} className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h4 className="truncate text-sm font-medium text-[var(--text-primary)]">{task.title}</h4>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-faint)]">
                              <span className={cn(
                                'rounded-full px-2 py-0.5 capitalize',
                                task.status === 'in-progress' ? 'bg-blue-400/10 text-blue-400' : 'bg-[var(--surface)] text-[var(--text-faint)]'
                              )}>
                                {task.status === 'in-progress' ? 'In Progress' : 'To Do'}
                              </span>
                              <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 capitalize">{task.priority}</span>
                              {task.dueDate && (
                                <span>{new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              )}
                            </div>
                          </div>
                          <ArrowRight size={14} className="mt-1 shrink-0 text-[var(--text-faint)]" />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, icon, tone }: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'default' | 'danger' | 'success';
}) {
  const toneClass =
    tone === 'danger'
      ? 'bg-red-400/10 text-red-400'
      : tone === 'success'
        ? 'bg-emerald-400/10 text-emerald-400'
        : 'bg-[var(--surface-muted)] text-[var(--text-secondary)]';

  return (
    <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-[var(--text-faint)]">{label}</div>
          <div className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
        </div>
        <div className={cn('rounded-xl p-2.5', toneClass)}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border-soft)] px-4 py-6 text-center text-sm text-[var(--text-faint)]">
      {text}
    </div>
  );
}
