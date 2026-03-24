import { useState, useMemo } from 'react';
import { Plus, ChevronDown, ChevronUp, Filter, StickyNote, Link2, Trash2, X, Pencil } from 'lucide-react';
import { Deadline, DeadlineStatus, DeadlineType, Project, Task } from '../types';
import { cn } from '../utils/cn';

interface DeadlinesPageProps {
  deadlines: Deadline[];
  projects: Project[];
  tasks: Task[];
  onAdd: (title: string, projectId: string | null, type: DeadlineType, dueDate: string, dueTime: string | null, notes: string) => Promise<boolean>;
  onUpdate: (id: string, updates: Partial<Pick<Deadline, 'title' | 'projectId' | 'status' | 'type' | 'dueDate' | 'dueTime' | 'notes'>>) => Promise<boolean>;
  onDelete: (id: string) => void;
  onLinkTask: (deadlineId: string, taskId: string) => Promise<boolean>;
  onUnlinkTask: (deadlineId: string, taskId: string) => void;
  onCreateTask: (title: string, description: string, projectId: string | null, dueDate: string | null) => Promise<string | null>;
}

type SortField = 'dueDate' | 'title' | 'type' | 'status' | 'course';
type SortDir = 'asc' | 'desc';

const STATUS_OPTIONS: { value: DeadlineStatus; label: string; color: string }[] = [
  { value: 'not-started', label: 'Not Started', color: 'text-[var(--text-faint)] bg-[var(--surface-muted)]' },
  { value: 'in-progress', label: 'In Progress', color: 'text-blue-400 bg-blue-400/10' },
  { value: 'done', label: 'Done', color: 'text-emerald-400 bg-emerald-400/10' },
  { value: 'missed', label: 'Missed', color: 'text-red-400 bg-red-400/10' },
];

const TYPE_OPTIONS: { value: DeadlineType; label: string }[] = [
  { value: 'assignment', label: 'Assignment' },
  { value: 'exam', label: 'Exam' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'lab', label: 'Lab' },
  { value: 'project', label: 'Project' },
  { value: 'other', label: 'Other' },
];

function statusMeta(status: DeadlineStatus) {
  return STATUS_OPTIONS.find(s => s.value === status) ?? STATUS_OPTIONS[0];
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(timeStr: string) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function daysUntil(dateStr: string) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T00:00:00');
  return Math.ceil((due.getTime() - now.getTime()) / 86400000);
}

export function DeadlinesPage({ deadlines, projects, tasks, onAdd, onUpdate, onDelete, onLinkTask, onUnlinkTask, onCreateTask }: DeadlinesPageProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('dueDate');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filterCourse, setFilterCourse] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  const filtered = useMemo(() => {
    let result = [...deadlines];
    if (filterCourse) result = result.filter(d => d.projectId === filterCourse);
    if (filterType) result = result.filter(d => d.type === filterType);
    if (filterStatus) result = result.filter(d => d.status === filterStatus);

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'dueDate': cmp = a.dueDate.localeCompare(b.dueDate); break;
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'type': cmp = a.type.localeCompare(b.type); break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
        case 'course': {
          const aP = projects.find(p => p.id === a.projectId)?.name ?? '';
          const bP = projects.find(p => p.id === b.projectId)?.name ?? '';
          cmp = aP.localeCompare(bP);
          break;
        }
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [deadlines, filterCourse, filterType, filterStatus, sortField, sortDir, projects]);

  const activeFilters = [filterCourse, filterType, filterStatus].filter(Boolean).length;
  const detailDeadline = detailId ? deadlines.find(d => d.id === detailId) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Deadlines</h1>
          <p className="mt-1 text-[var(--text-muted)]">Track what's due and when</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(f => !f)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition',
              showFilters || activeFilters > 0
                ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-soft)]'
                : 'border-[var(--border-soft)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
            )}
          >
            <Filter size={14} />
            Filters{activeFilters > 0 && ` (${activeFilters})`}
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium text-[var(--accent-contrast)] cursor-pointer"
            style={{ backgroundColor: 'var(--accent-strong)' }}
          >
            <Plus size={14} />
            Add Deadline
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-3">
          <select
            value={filterCourse}
            onChange={e => setFilterCourse(e.target.value)}
            className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="">All Courses</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="">All Types</option>
            {TYPE_OPTIONS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {activeFilters > 0 && (
            <button
              onClick={() => { setFilterCourse(''); setFilterType(''); setFilterStatus(''); }}
              className="text-xs text-[var(--text-faint)] hover:text-[var(--accent)] transition"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-soft)] bg-[var(--surface-muted)]">
                <th className="w-10 px-3 py-2.5" />
                <th
                  className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] cursor-pointer select-none"
                  onClick={() => handleSort('status')}
                >
                  <span className="flex items-center gap-1">Status <SortIcon field="status" /></span>
                </th>
                <th
                  className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] cursor-pointer select-none"
                  onClick={() => handleSort('course')}
                >
                  <span className="flex items-center gap-1">Course <SortIcon field="course" /></span>
                </th>
                <th
                  className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] cursor-pointer select-none"
                  onClick={() => handleSort('dueDate')}
                >
                  <span className="flex items-center gap-1">Date <SortIcon field="dueDate" /></span>
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)]">Time</th>
                <th
                  className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] cursor-pointer select-none"
                  onClick={() => handleSort('title')}
                >
                  <span className="flex items-center gap-1">Title <SortIcon field="title" /></span>
                </th>
                <th
                  className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] cursor-pointer select-none"
                  onClick={() => handleSort('type')}
                >
                  <span className="flex items-center gap-1">Type <SortIcon field="type" /></span>
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)]">Notes</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)]">Links</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-sm text-[var(--text-faint)]">
                    {deadlines.length === 0 ? 'No deadlines yet. Click "Add Deadline" to get started.' : 'No deadlines match your filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map(dl => {
                  const project = projects.find(p => p.id === dl.projectId);
                  const days = daysUntil(dl.dueDate);
                  const sm = statusMeta(dl.status);
                  const isOverdue = days < 0 && dl.status !== 'done' && dl.status !== 'missed';

                  return (
                    <tr
                      key={dl.id}
                      className={cn(
                        'border-b border-[var(--border-soft)] last:border-b-0 transition-colors hover:bg-[var(--surface-muted)] group',
                        dl.status === 'done' && 'opacity-60',
                      )}
                    >
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => setDetailId(dl.id)}
                          className="text-[var(--text-faint)] hover:text-[var(--accent)] transition opacity-0 group-hover:opacity-100"
                        >
                          <Pencil size={13} />
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          value={dl.status}
                          onChange={e => onUpdate(dl.id, { status: e.target.value as DeadlineStatus })}
                          className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium border-0 cursor-pointer focus:outline-none', sm.color)}
                        >
                          {STATUS_OPTIONS.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        {project ? (
                          <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
                            <span className="truncate max-w-[100px]">{project.name}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--text-faint)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={cn('text-xs', isOverdue ? 'text-red-400 font-medium' : 'text-[var(--text-secondary)]')}>
                          {formatDate(dl.dueDate)}
                        </span>
                        {dl.status !== 'done' && dl.status !== 'missed' && (
                          <span className={cn(
                            'ml-1.5 text-[10px]',
                            days < 0 ? 'text-red-400' : days <= 2 ? 'text-yellow-400' : 'text-[var(--text-faint)]'
                          )}>
                            {days === 0 ? 'today' : days === 1 ? 'tmrw' : days < 0 ? `${Math.abs(days)}d ago` : `${days}d`}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-[var(--text-faint)]">
                        {dl.dueTime ? formatTime(dl.dueTime) : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className={cn('text-sm', dl.status === 'done' ? 'text-[var(--text-faint)] line-through' : 'text-[var(--text-primary)]')}>
                            {dl.title}
                          </span>
                          {dl.sourceType !== 'manual' && (
                            <span className="shrink-0 rounded bg-orange-500/10 px-1.5 py-0.5 text-[9px] font-medium text-orange-400" title={dl.sourceUrl ?? undefined}>
                              Canvas
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
                          {dl.type}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {dl.notes ? (
                          <span className="flex items-center gap-1 text-xs text-[var(--text-faint)]" title={dl.notes}>
                            <StickyNote size={11} />
                            <span className="truncate max-w-[120px]">{dl.notes}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--text-faint)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {dl.linkedTaskIds.length > 0 ? (
                          <span className="flex items-center gap-1 text-xs text-indigo-400">
                            <Link2 size={11} />
                            {dl.linkedTaskIds.length}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--text-faint)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => onDelete(dl.id)}
                          className="text-[var(--text-faint)] hover:text-red-400 transition opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary footer */}
      <div className="flex flex-wrap gap-4 text-xs text-[var(--text-faint)]">
        <span>{deadlines.length} total</span>
        <span>{deadlines.filter(d => d.status === 'not-started').length} not started</span>
        <span>{deadlines.filter(d => d.status === 'in-progress').length} in progress</span>
        <span>{deadlines.filter(d => d.status === 'done').length} done</span>
        <span className="text-red-400">{deadlines.filter(d => daysUntil(d.dueDate) < 0 && d.status !== 'done' && d.status !== 'missed').length} overdue</span>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <AddDeadlineModal
          projects={projects}
          onAdd={async (title, projectId, type, dueDate, dueTime, notes) => {
            const ok = await onAdd(title, projectId, type, dueDate, dueTime, notes);
            if (ok) setShowAddModal(false);
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Detail Modal */}
      {detailDeadline && (
        <DeadlineDetailModal
          deadline={detailDeadline}
          projects={projects}
          tasks={tasks}
          onUpdate={async (updates) => {
            return onUpdate(detailDeadline.id, updates);
          }}
          onLinkTask={(taskId) => onLinkTask(detailDeadline.id, taskId)}
          onUnlinkTask={(taskId) => onUnlinkTask(detailDeadline.id, taskId)}
          onCreateTask={async (title) => {
            const taskId = await onCreateTask(title, '', detailDeadline.projectId, detailDeadline.dueDate);
            if (taskId) {
              await onLinkTask(detailDeadline.id, taskId);
            }
            return !!taskId;
          }}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

/* ─── Add Deadline Modal ─── */

function AddDeadlineModal({ projects, onAdd, onClose }: {
  projects: Project[];
  onAdd: (title: string, projectId: string | null, type: DeadlineType, dueDate: string, dueTime: string | null, notes: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [type, setType] = useState<DeadlineType>('assignment');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">New Deadline</h2>
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>
        <form
          onSubmit={e => { e.preventDefault(); if (title.trim() && dueDate) onAdd(title.trim(), projectId || null, type, dueDate, dueTime || null, notes.trim()); }}
          className="p-5 space-y-4"
        >
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. CS 1332 Exam 1"
              autoFocus
              className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Course</label>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="w-full cursor-pointer appearance-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              >
                <option value="">No Course</option>
                {projects.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Type</label>
              <select
                value={type}
                onChange={e => setType(e.target.value as DeadlineType)}
                className="w-full cursor-pointer appearance-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              >
                {TYPE_OPTIONS.map(t => (<option key={t.value} value={t.value}>{t.label}</option>))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Due Date *</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Due Time</label>
              <input
                type="time"
                value={dueTime}
                onChange={e => setDueTime(e.target.value)}
                className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add details, room number, topics..."
              rows={2}
              className="w-full resize-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-[var(--border-soft)] py-2.5 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !dueDate}
              className="flex-1 rounded-lg py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent-strong)' }}
            >
              Add Deadline
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Deadline Detail Modal ─── */

function DeadlineDetailModal({ deadline, projects, tasks, onUpdate, onLinkTask, onUnlinkTask, onCreateTask, onClose }: {
  deadline: Deadline;
  projects: Project[];
  tasks: Task[];
  onUpdate: (updates: Partial<Pick<Deadline, 'title' | 'projectId' | 'status' | 'type' | 'dueDate' | 'dueTime' | 'notes'>>) => Promise<boolean>;
  onLinkTask: (taskId: string) => Promise<boolean>;
  onUnlinkTask: (taskId: string) => void;
  onCreateTask: (title: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(deadline.title);
  const [projectId, setProjectId] = useState(deadline.projectId ?? '');
  const [type, setType] = useState<DeadlineType>(deadline.type);
  const [status, setStatus] = useState<DeadlineStatus>(deadline.status);
  const [dueDate, setDueDate] = useState(deadline.dueDate);
  const [dueTime, setDueTime] = useState(deadline.dueTime ?? '');
  const [notes, setNotes] = useState(deadline.notes);
  const [isSaving, setIsSaving] = useState(false);
  const [linkDropdown, setLinkDropdown] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  const linkedTasks = tasks.filter(t => deadline.linkedTaskIds.includes(t.id));
  const availableTasks = tasks.filter(t => !deadline.linkedTaskIds.includes(t.id));
  const project = projects.find(p => p.id === deadline.projectId);

  const handleSave = async () => {
    if (!title.trim() || !dueDate || isSaving) return;
    setIsSaving(true);
    const ok = await onUpdate({
      title: title.trim(),
      projectId: projectId || null,
      status,
      type,
      dueDate,
      dueTime: dueTime || null,
      notes: notes.trim(),
    });
    setIsSaving(false);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Deadline Details</h2>
            {project && (
              <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: project.color + '20', color: project.color }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: project.color }} />
                {project.name}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as DeadlineStatus)}
                className="w-full cursor-pointer appearance-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              >
                {STATUS_OPTIONS.map(s => (<option key={s.value} value={s.value}>{s.label}</option>))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Type</label>
              <select
                value={type}
                onChange={e => setType(e.target.value as DeadlineType)}
                className="w-full cursor-pointer appearance-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              >
                {TYPE_OPTIONS.map(t => (<option key={t.value} value={t.value}>{t.label}</option>))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Course</label>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="w-full cursor-pointer appearance-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              >
                <option value="">No Course</option>
                {projects.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2 py-1.5 text-xs text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Time</label>
                <input
                  type="time"
                  value={dueTime}
                  onChange={e => setDueTime(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2 py-1.5 text-xs text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add details..."
              rows={3}
              className="w-full resize-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>

          {/* Linked Tasks */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-[var(--text-muted)]">Linked Tasks</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setLinkDropdown(v => !v)}
                  className="flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline"
                >
                  <Link2 size={10} /> Link a task
                </button>
                {linkDropdown && availableTasks.length > 0 && (
                  <div className="absolute right-0 top-full mt-1 z-10 w-56 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-lg max-h-40 overflow-y-auto">
                    {availableTasks.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={async () => {
                          await onLinkTask(t.id);
                          setLinkDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] transition truncate"
                      >
                        {t.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Create new linked task */}
            <div className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && newTaskTitle.trim() && !isCreatingTask) {
                    e.preventDefault();
                    setIsCreatingTask(true);
                    const ok = await onCreateTask(newTaskTitle.trim());
                    if (ok) setNewTaskTitle('');
                    setIsCreatingTask(false);
                  }
                }}
                placeholder="Create a linked task..."
                className="flex-1 rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                disabled={!newTaskTitle.trim() || isCreatingTask}
                onClick={async () => {
                  if (!newTaskTitle.trim() || isCreatingTask) return;
                  setIsCreatingTask(true);
                  const ok = await onCreateTask(newTaskTitle.trim());
                  if (ok) setNewTaskTitle('');
                  setIsCreatingTask(false);
                }}
                className="rounded-md border border-[var(--border-soft)] p-1.5 text-[var(--text-faint)] transition hover:border-[var(--border-strong)] hover:text-[var(--accent)] disabled:opacity-40"
              >
                <Plus size={12} />
              </button>
            </div>
            <div className="space-y-1.5">
              {linkedTasks.map(t => (
                <div key={t.id} className="flex items-center justify-between rounded-md bg-[var(--surface-muted)] px-2.5 py-1.5 group">
                  <span className="text-xs text-[var(--text-secondary)] truncate">{t.title}</span>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-[9px] font-medium px-1.5 py-0.5 rounded-full',
                      t.status === 'done' ? 'text-emerald-400 bg-emerald-400/10' : t.status === 'in-progress' ? 'text-blue-400 bg-blue-400/10' : 'text-[var(--text-faint)] bg-[var(--surface-muted)]'
                    )}>
                      {t.status === 'in-progress' ? 'In Progress' : t.status === 'todo' ? 'To Do' : 'Done'}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUnlinkTask(t.id)}
                      className="text-[var(--text-faint)] opacity-0 group-hover:opacity-100 hover:text-red-400 transition"
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
              ))}
              {linkedTasks.length === 0 && (
                <p className="text-[10px] text-[var(--text-faint)] py-1">No linked tasks. Link existing tasks or create new ones from here.</p>
              )}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-[var(--border-soft)] py-2.5 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)]">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!title.trim() || !dueDate || isSaving}
              className="flex-1 rounded-lg py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent-strong)' }}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
