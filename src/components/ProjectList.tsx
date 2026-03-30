import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, FolderOpen, Target, X, ArrowRight, Clock3, ListTodo, Search, CalendarClock, AlertTriangle, Palette } from 'lucide-react';
import { Task, Project, Deadline } from '../types';
import { cn } from '../utils/cn';

interface ProjectListProps {
  projects: Project[];
  tasks: Task[];
  deadlines: Deadline[];
  initialProjectId?: string | null;
  onAddProject: (name: string, description: string) => Promise<string | null> | void;
  onUpdateProject: (id: string, updates: { name?: string; description?: string; color?: string }) => Promise<boolean> | boolean;
  onDeleteProject: (id: string) => void;
  onOpenTasks?: (projectId: string) => void;
  onOpenDeadlines?: (projectId: string) => void;
}

type CourseSort = 'urgency' | 'alphabetical';

const COURSE_COLOR_OPTIONS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function deadlineDate(deadline: Deadline) {
  return new Date(`${deadline.dueDate}T00:00:00`);
}

export function ProjectList({ projects, tasks, deadlines, initialProjectId = null, onAddProject, onUpdateProject, onDeleteProject, onOpenTasks, onOpenDeadlines }: ProjectListProps) {
  const [showForm, setShowForm] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialProjectId);
  const [colorMenuProjectId, setColorMenuProjectId] = useState<string | null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<CourseSort>('urgency');
  const today = startOfToday();

  useEffect(() => {
    setSelectedProjectId(initialProjectId);
  }, [initialProjectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onAddProject(name.trim(), description.trim());
    setName('');
    setDescription('');
    setShowForm(false);
  };

  const selectedProject = selectedProjectId ? projects.find(project => project.id === selectedProjectId) ?? null : null;

  const visibleProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    const withMeta = projects.map(project => {
      const projectDeadlines = deadlines
        .filter(d => d.projectId === project.id && d.status !== 'done' && d.status !== 'missed')
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.dueTime ?? '').localeCompare(b.dueTime ?? ''));
      const nextDeadline = projectDeadlines[0] ?? null;
      return {
        project,
        nextDeadline,
        urgency: nextDeadline ? deadlineDate(nextDeadline).getTime() : Number.MAX_SAFE_INTEGER,
      };
    }).filter(({ project }) => {
      if (!term) return true;
      return project.name.toLowerCase().includes(term) || project.description.toLowerCase().includes(term);
    });

    withMeta.sort((a, b) => {
      if (sort === 'alphabetical') return a.project.name.localeCompare(b.project.name);
      return a.urgency - b.urgency || a.project.name.localeCompare(b.project.name);
    });

    return withMeta.map(item => item.project);
  }, [deadlines, projects, search, sort]);

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">Courses</h1>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 self-start rounded-2xl px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] shadow-lg transition-colors"
            style={{ backgroundColor: 'var(--accent-strong)', boxShadow: '0 16px 34px var(--glow-accent)' }}
          >
            <Plus size={15} /> New Course
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search courses..."
              className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] py-2.5 pl-9 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as CourseSort)}
            className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="urgency">Sort by urgency</option>
            <option value="alphabetical">Sort alphabetically</option>
          </select>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--text-faint)]">
          <span>
            Showing {visibleProjects.length} of {projects.length} courses
          </span>
          {search.trim() && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="rounded-full border border-[var(--border-soft)] px-2.5 py-1 font-medium transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              Clear search
            </button>
          )}
        </div>
      </div>

      {/* Add Project Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-sm">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Project name"
            autoFocus
            className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Brief description"
            rows={3}
            className="w-full resize-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
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
        {visibleProjects.map(project => {
          const projectTasks = tasks.filter(t => t.projectId === project.id);
          const projectDeadlines = deadlines
            .filter(d => d.projectId === project.id)
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.dueTime ?? '').localeCompare(b.dueTime ?? ''));
          const done = projectTasks.filter(t => t.status === 'done').length;
          const progress = projectTasks.length > 0 ? Math.round((done / projectTasks.length) * 100) : 0;
          const activeDeadlines = projectDeadlines.filter(d => d.status !== 'done' && d.status !== 'missed');
          const upcomingDeadlines = activeDeadlines.filter(d => deadlineDate(d) >= today);
          const nextDeadline = upcomingDeadlines[0] ?? null;

          return (
            <div
              key={project.id}
              onClick={() => setSelectedProjectId(project.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedProjectId(project.id);
                }
              }}
              role="button"
              tabIndex={0}
              className="group relative cursor-pointer rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-5 text-left shadow-sm transition-all hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)] hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
            >
              <div className="absolute inset-x-0 top-0 h-1.5 rounded-t-[24px]" style={{ backgroundColor: project.color }} />
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm" style={{ backgroundColor: project.color + '20' }}>
                    <FolderOpen size={20} style={{ color: project.color }} />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-[var(--text-primary)]">{project.name}</h3>
                    <p className="mt-0.5 text-xs text-[var(--text-faint)]">{project.description || 'No description'}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    setColorMenuProjectId(current => current === project.id ? null : project.id);
                  }}
                  className="p-1 text-[var(--text-faint)] opacity-100 transition-all hover:text-[var(--text-primary)] md:opacity-0 md:group-hover:opacity-100"
                  aria-label={`Change ${project.name} color`}
                >
                  <Palette size={14} />
                </button>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setConfirmDeleteProject(project); }}
                  className="p-1 text-[var(--text-faint)] opacity-100 transition-all hover:text-red-400 md:opacity-0 md:group-hover:opacity-100"
                  aria-label={`Delete ${project.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {colorMenuProjectId === project.id && (
                <div
                  className="mt-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">Course color</p>
                    <button
                      type="button"
                      onClick={() => setColorMenuProjectId(null)}
                      className="text-xs text-[var(--text-faint)] transition hover:text-[var(--text-primary)]"
                    >
                      Close
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {COURSE_COLOR_OPTIONS.map(color => {
                      const selected = color.toLowerCase() === project.color.toLowerCase();
                      return (
                        <button
                          key={color}
                          type="button"
                          onClick={async () => {
                            if (selected) return;
                            const ok = await onUpdateProject(project.id, { color });
                            if (ok) {
                              setColorMenuProjectId(null);
                            }
                          }}
                          className={cn(
                            'h-8 w-8 rounded-full border-2 transition hover:scale-105',
                            selected ? 'border-[var(--text-primary)] shadow-sm' : 'border-transparent'
                          )}
                          style={{ backgroundColor: color }}
                          aria-label={`Set ${project.name} color`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-4">
                <div className="mb-2 flex justify-between text-xs text-[var(--text-faint)]">
                  <span>{done}/{projectTasks.length} tasks done</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[var(--surface-muted)]">
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{ width: `${progress}%`, backgroundColor: project.color }}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-faint)]">
                {activeDeadlines.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Target size={11} />
                    {activeDeadlines.length} active deadline{activeDeadlines.length !== 1 ? 's' : ''}
                  </span>
                )}
                {nextDeadline && (
                  <span>
                    Next: {new Date(`${nextDeadline.dueDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {projects.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] py-16">
            <FolderOpen size={40} className="mb-3 text-[var(--text-faint)]" />
            <p className="text-sm text-[var(--text-muted)]">No courses yet</p>
            <p className="mt-1 text-xs text-[var(--text-faint)]">Create your first course to get started</p>
          </div>
        )}
        {projects.length > 0 && visibleProjects.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-[var(--border-soft)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--text-faint)]">
            No courses match your search.
          </div>
        )}
      </div>

      {selectedProject && (
        <CourseDetailModal
          project={selectedProject}
          tasks={tasks.filter(task => task.projectId === selectedProject.id)}
          deadlines={deadlines.filter(deadline => deadline.projectId === selectedProject.id)}
          onOpenTasks={onOpenTasks}
          onOpenDeadlines={onOpenDeadlines}
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4" onClick={onCancel}>
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

function CourseDetailModal({ project, tasks, deadlines, onOpenTasks, onOpenDeadlines, onClose }: {
  project: Project;
  tasks: Task[];
  deadlines: Deadline[];
  onOpenTasks?: (projectId: string) => void;
  onOpenDeadlines?: (projectId: string) => void;
  onClose: () => void;
}) {
  const [showCompletedDeadlines, setShowCompletedDeadlines] = useState(false);
  const today = startOfToday();
  const sortedDeadlines = useMemo(
    () => [...deadlines].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.dueTime ?? '').localeCompare(b.dueTime ?? '')),
    [deadlines]
  );
  const activeDeadlines = sortedDeadlines.filter(deadline => deadline.status !== 'done' && deadline.status !== 'missed');
  const completedDeadlines = sortedDeadlines.filter(deadline => deadline.status === 'done' || deadline.status === 'missed');
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

  useEffect(() => {
    setShowCompletedDeadlines(false);
  }, [project.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="shrink-0 flex items-start justify-between gap-3 border-b border-[var(--border-soft)] px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: `${project.color}20` }}>
              <FolderOpen size={22} style={{ color: project.color }} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-[var(--text-primary)] sm:text-xl">{project.name}</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{project.description || 'Course overview and workload snapshot'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onOpenDeadlines?.(project.id)}
                  className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--accent)]"
                >
                  Open deadlines view
                </button>
                <button
                  type="button"
                  onClick={() => onOpenTasks?.(project.id)}
                  className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--accent)]"
                >
                  Open tasks view
                </button>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                    <>
                      {activeDeadlines.length > 0 ? (
                        activeDeadlines.map(deadline => {
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
                      ) : (
                        <EmptyState text="No active deadlines for this course right now." />
                      )}

                      {completedDeadlines.length > 0 && (
                        <>
                          <div className="flex items-center gap-3 py-1">
                            <div className="h-px flex-1 bg-[var(--border-soft)]" />
                            <button
                              type="button"
                              onClick={() => setShowCompletedDeadlines(current => !current)}
                              className="rounded-full border border-[var(--border-soft)] px-3 py-1 text-[10px] font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                            >
                              {showCompletedDeadlines
                                ? `Hide ${completedDeadlines.length} completed`
                                : `Show ${completedDeadlines.length} completed`}
                            </button>
                            <div className="h-px flex-1 bg-[var(--border-soft)]" />
                          </div>

                          {showCompletedDeadlines && completedDeadlines.map(deadline => {
                            const overdue = deadlineDate(deadline) < today && deadline.status !== 'done' && deadline.status !== 'missed';
                            return (
                              <div key={deadline.id} className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3 opacity-80">
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
                          })}
                        </>
                      )}
                    </>
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
