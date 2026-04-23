import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Search, Filter, Pencil, MessageSquare, Target, Timer, Play, Pause, RotateCcw, CheckCircle2, Coffee } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Task, Project, Deadline, TaskStatus, Priority, Recurrence } from '../types';
import { cn } from '../utils/cn';
import { AddTaskModal } from './AddTaskModal';
import { EditTaskModal } from './EditTaskModal';

interface TaskBoardProps {
  tasks: Task[];
  projects: Project[];
  deadlines?: Deadline[];
  initialProjectFilter?: string;
  onAddTask: (title: string, description: string, priority: Priority, projectId: string | null, dueDate: string | null, recurrence: Recurrence) => Promise<string | null> | void;
  onUpdateStatus: (id: string, status: TaskStatus) => void;
  onUpdateTask: (id: string, updates: { title?: string; description?: string; priority?: Priority; projectId?: string | null; dueDate?: string | null; recurrence?: Recurrence }) => Promise<boolean>;
  onDeleteTask: (id: string) => void;
  onAddSubtask: (taskId: string, title: string) => Promise<boolean>;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
  onDeleteSubtask: (subtaskId: string) => void;
  onAddComment: (taskId: string, text: string) => Promise<boolean>;
  onDeleteComment: (commentId: string) => void;
  onOpenDeadline?: (deadlineId: string) => void;
}

const statusColumns: { status: TaskStatus; label: string; dotColor: string }[] = [
  { status: 'todo', label: 'To Do', dotColor: 'bg-[var(--text-faint)]' },
  { status: 'in-progress', label: 'In Progress', dotColor: 'bg-blue-400' },
  { status: 'done', label: 'Done', dotColor: 'bg-emerald-400' },
];

const priorityBadge = (p: Priority) => {
  if (p === 'high') return 'bg-red-500/10 text-red-400 border-red-500/20';
  if (p === 'medium') return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
  return 'bg-[var(--surface-muted)] text-[var(--text-faint)] border-[var(--border-soft)]';
};

const focusTimerPresets = [
  { id: 'quick', label: 'Quick push', helper: 'Short task sprint', minutes: 15 },
  { id: 'focus', label: 'Focus block', helper: 'Default work session', minutes: 35 },
  { id: 'deep', label: 'Deep block', helper: 'Harder work', minutes: 50 },
  { id: 'reset', label: 'Reset break', helper: 'Step away', minutes: 7 },
] as const;

type FocusTimerPresetId = typeof focusTimerPresets[number]['id'];

function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function FocusTimerCard({
  tasks,
  projects,
  onUpdateStatus,
}: {
  tasks: Task[];
  projects: Project[];
  onUpdateStatus: (id: string, status: TaskStatus) => void;
}) {
  const actionableTasks = useMemo(
    () => tasks
      .filter(task => task.status !== 'done')
      .sort((a, b) => {
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate && !b.dueDate) return -1;
        if (!a.dueDate && b.dueDate) return 1;
        const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
        return priorityRank[a.priority] - priorityRank[b.priority];
      }),
    [tasks],
  );
  const [presetId, setPresetId] = useState<FocusTimerPresetId>('focus');
  const selectedPreset = focusTimerPresets.find(preset => preset.id === presetId) ?? focusTimerPresets[1];
  const [secondsLeft, setSecondsLeft] = useState(selectedPreset.minutes * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState(actionableTasks[0]?.id ?? '');
  const [completedBlocks, setCompletedBlocks] = useState(0);

  const selectedTask = actionableTasks.find(task => task.id === selectedTaskId) ?? null;
  const selectedProject = selectedTask ? projects.find(project => project.id === selectedTask.projectId) : null;
  const totalSeconds = selectedPreset.minutes * 60;
  const progress = totalSeconds > 0 ? Math.max(0, Math.min(1, 1 - secondsLeft / totalSeconds)) : 0;
  const circumference = 2 * Math.PI * 44;

  useEffect(() => {
    if (selectedTaskId && actionableTasks.some(task => task.id === selectedTaskId)) return;
    setSelectedTaskId(actionableTasks[0]?.id ?? '');
  }, [actionableTasks, selectedTaskId]);

  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => {
      setSecondsLeft(current => {
        if (current <= 1) {
          window.clearInterval(interval);
          setIsRunning(false);
          setCompletedBlocks(count => count + 1);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isRunning]);

  const handlePresetChange = (nextPresetId: FocusTimerPresetId) => {
    setPresetId(nextPresetId);
    setIsRunning(false);
    const nextPreset = focusTimerPresets.find(preset => preset.id === nextPresetId) ?? focusTimerPresets[1];
    setSecondsLeft(nextPreset.minutes * 60);
  };

  const handleStartPause = () => {
    if (!isRunning && presetId !== 'reset' && selectedTask && selectedTask.status === 'todo') {
      onUpdateStatus(selectedTask.id, 'in-progress');
    }
    setIsRunning(running => !running);
  };

  const handleReset = () => {
    setIsRunning(false);
    setSecondsLeft(totalSeconds);
  };

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative overflow-hidden p-5">
          <div className="pointer-events-none absolute right-8 top-5 h-32 w-32 rounded-full bg-[var(--accent-soft)]/30 blur-3xl" />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[var(--accent)]">
                <Timer size={18} />
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">Focus timer</span>
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-[var(--text-primary)]">
                Turn one task into a focused work block.
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
                Pick what you are working on, choose a session length, and TaskFlow will move the task into progress when you start.
              </p>
            </div>

            <div className="relative flex shrink-0 items-center justify-center">
              <svg className="h-32 w-32 -rotate-90" viewBox="0 0 104 104" aria-hidden="true">
                <circle cx="52" cy="52" r="44" fill="none" stroke="var(--border-soft)" strokeWidth="9" />
                <circle
                  cx="52"
                  cy="52"
                  r="44"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - progress)}
                  className="transition-[stroke-dashoffset] duration-500"
                />
              </svg>
              <div className="absolute text-center">
                <div className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]">{formatTimer(secondsLeft)}</div>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-faint)]">
                  {isRunning ? 'in focus' : secondsLeft === 0 ? 'complete' : 'ready'}
                </div>
              </div>
            </div>
          </div>

          <div className="relative mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {focusTimerPresets.map(preset => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePresetChange(preset.id)}
                className={cn(
                  'rounded-xl border px-3 py-3 text-left transition',
                  presetId === preset.id
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                    : 'border-[var(--border-soft)] bg-[var(--surface-muted)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]',
                )}
              >
                <div className="text-sm font-semibold">{preset.label}</div>
                <div className="mt-1 flex items-center justify-between text-xs text-[var(--text-faint)]">
                  <span>{preset.helper}</span>
                  <span>{preset.minutes}m</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-[var(--border-soft)] bg-[var(--surface-muted)]/70 p-5 lg:border-l lg:border-t-0">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
            Work on
          </label>
          <select
            value={selectedTaskId}
            onChange={event => setSelectedTaskId(event.target.value)}
            disabled={actionableTasks.length === 0}
            className="w-full cursor-pointer appearance-none rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            {actionableTasks.length === 0 ? (
              <option value="">No open tasks yet</option>
            ) : (
              actionableTasks.map(task => (
                <option key={task.id} value={task.id}>{task.title}</option>
              ))
            )}
          </select>

          <div className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-4">
            {selectedTask ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{selectedTask.title}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {selectedProject ? selectedProject.name : 'No course'} · {selectedTask.priority} priority
                    </p>
                  </div>
                  {selectedTask.status === 'in-progress' ? (
                    <span className="rounded-full bg-blue-400/10 px-2 py-0.5 text-[10px] font-medium text-blue-400">In progress</span>
                  ) : (
                    <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-faint)]">Ready</span>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <Coffee size={15} />
                Add a task first, then use this as your focus anchor.
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleStartPause}
              disabled={actionableTasks.length === 0 || secondsLeft === 0}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent-strong)] px-4 py-3 text-sm font-medium text-[var(--accent-contrast)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunning ? <Pause size={15} /> : <Play size={15} />}
              {isRunning ? 'Pause' : 'Start'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
              title="Reset timer"
            >
              <RotateCcw size={15} />
            </button>
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300">
            <CheckCircle2 size={14} />
            <span>{completedBlocks} focus block{completedBlocks === 1 ? '' : 's'} completed this session</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function TaskCard({
  task,
  projects,
  deadline,
  onEdit,
  onRequestDelete,
  onOpenDeadline,
}: {
  task: Task;
  projects: Project[];
  deadline?: Deadline;
  onEdit: (task: Task) => void;
  onRequestDelete: (id: string) => void;
  onOpenDeadline?: (deadlineId: string) => void;
}) {
  const project = projects.find(p => p.id === task.projectId);

  const dueLabel = task.dueDate
    ? new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';

  return (
    <div className="group rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-sm transition-all hover:border-[var(--border-strong)] hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium leading-snug text-[var(--text-primary)]">{task.title}</h4>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onEdit(task)}
            className="p-1 text-[var(--text-faint)] opacity-100 transition-opacity hover:text-[var(--text-secondary)] md:opacity-0 md:group-hover:opacity-100"
            title="Edit task"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => onRequestDelete(task.id)}
            className="p-1 text-[var(--text-faint)] opacity-100 transition-opacity hover:text-red-400 md:opacity-0 md:group-hover:opacity-100"
            title="Delete task"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {task.description && (
        <p className="mt-1.5 line-clamp-2 text-xs text-[var(--text-faint)]">{task.description}</p>
      )}

      {task.subtasks.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-[var(--surface-muted)]">
              <div
                className="h-1.5 rounded-full bg-emerald-400 transition-all"
                style={{ width: `${task.subtasks.length > 0 ? Math.round((task.subtasks.filter(s => s.done).length / task.subtasks.length) * 100) : 0}%` }}
              />
            </div>
            <span className="text-[10px] text-[var(--text-faint)]">
              {task.subtasks.filter(s => s.done).length}/{task.subtasks.length}
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize', priorityBadge(task.priority))}>
          {task.priority}
        </span>

        {project && (
          <span className="flex items-center gap-1 rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: project.color }} />
            {project.name}
          </span>
        )}

        {dueLabel && (
          <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', isOverdue ? 'bg-red-500/10 text-red-400' : 'bg-[var(--surface-muted)] text-[var(--text-faint)]')}>
            {dueLabel}
          </span>
        )}

        {task.comments.length > 0 && (
          <span className="flex items-center gap-0.5 rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-faint)]">
            <MessageSquare size={9} /> {task.comments.length}
          </span>

        )}

        {deadline && (
          <button
            type="button"
            onClick={() => onOpenDeadline?.(deadline.id)}
            className="flex items-center gap-0.5 rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-400 transition hover:bg-orange-500/15"
            title={`Linked to: ${deadline.title}`}
          >
            <Target size={9} /> {deadline.title}
          </button>
        )}
      </div>
    </div>
  );
}

export function TaskBoard({ tasks, projects, deadlines = [], initialProjectFilter = 'all', onAddTask, onUpdateStatus, onUpdateTask, onDeleteTask, onAddSubtask, onToggleSubtask, onDeleteSubtask, onAddComment, onDeleteComment, onOpenDeadline }: TaskBoardProps) {
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all');
  const [filterProject, setFilterProject] = useState<string>(initialProjectFilter);

  useEffect(() => {
    setFilterProject(initialProjectFilter);
  }, [initialProjectFilter]);

  const filteredTasks = tasks.filter(t => {
    const matchesSearch = t.title.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase());
    const matchesPriority = filterPriority === 'all' || t.priority === filterPriority;
    const matchesProject = filterProject === 'all' || t.projectId === filterProject;
    return matchesSearch && matchesPriority && matchesProject;
  });

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId as TaskStatus;
    const taskId = result.draggableId;
    const task = tasks.find(t => t.id === taskId);
    if (task && task.status !== newStatus) {
      onUpdateStatus(taskId, newStatus);
    }
  };


  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">Tasks</h1>
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-faint)]">
            <span><span className="text-sm font-semibold text-[var(--text-primary)]">{filteredTasks.length}</span> shown</span>
            <span className="h-3 w-px bg-[var(--border-soft)]" />
            <span><span className="font-semibold text-[var(--text-secondary)]">{tasks.filter(t => t.status !== 'done').length}</span> open</span>
            <span><span className="font-semibold text-emerald-400">{tasks.filter(t => t.status === 'done').length}</span> done</span>
            {tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done').length > 0 && (
              <span><span className="font-semibold text-red-400">{tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done').length}</span> overdue</span>
            )}
          </div>
        </div>
      </div>

      <FocusTimerCard
        tasks={filteredTasks}
        projects={projects}
        onUpdateStatus={onUpdateStatus}
      />

      {/* Filters */}
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input
              type="text"
              placeholder="Search tasks by title or notes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] py-3 pr-4 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <select
                value={filterPriority}
                onChange={e => setFilterPriority(e.target.value as Priority | 'all')}
                className="cursor-pointer appearance-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] py-3 pr-8 pl-8 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              >
                <option value="all">All Priorities</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <select
              value={filterProject}
              onChange={e => setFilterProject(e.target.value)}
              className="cursor-pointer appearance-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-3 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
            >
              <option value="all">All Courses</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium bg-[var(--accent-strong)] text-[var(--accent-contrast)] shadow-sm transition-colors"
             
            >
              <Plus size={16} /> New Task
            </button>
          </div>
        </div>
      </div>

      {/* Kanban Columns with Drag & Drop */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {statusColumns.map(col => {
            const columnTasks = filteredTasks.filter(t => t.status === col.status).sort((a, b) => {
              if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
              if (a.dueDate && !b.dueDate) return -1;
              if (!a.dueDate && b.dueDate) return 1;
              return 0;
            });
            return (
              <div key={col.status} className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--border-strong)]">
                <div className="mb-4 flex items-center gap-2 border-b border-[var(--border-soft)] pb-3">
                  <div className={cn('h-2.5 w-2.5 rounded-full', col.dotColor)} />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{col.label}</h3>
                  <span className="ml-auto rounded-full bg-[var(--surface-muted)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-faint)]">{columnTasks.length}</span>
                </div>
                <Droppable droppableId={col.status}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={cn(
                        'min-h-[120px] space-y-3 rounded-lg transition-colors',
                        snapshot.isDraggingOver && 'bg-[var(--accent-soft)]/30'
                      )}
                    >
                      {columnTasks.map((task, index) => (
                        <Draggable key={task.id} draggableId={task.id} index={index}>
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              className={cn(dragSnapshot.isDragging && 'opacity-90')}
                            >
                              <TaskCard
                                task={task}
                                projects={projects}
                                deadline={deadlines.find(d => d.linkedTaskIds.includes(task.id))}
                                onEdit={setEditingTask}
                                onRequestDelete={setConfirmDeleteId}
                                onOpenDeadline={onOpenDeadline}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {columnTasks.length === 0 && !snapshot.isDraggingOver && (
                        <div className="flex h-24 items-center justify-center rounded-xl border-2 border-dashed border-[var(--border-soft)] bg-[var(--surface-muted)]/40">
                          <p className="text-xs text-[var(--text-faint)]">No tasks here yet</p>
                        </div>
                      )}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>

      {showModal && (
        <AddTaskModal
          projects={projects}
          onAdd={async (title, desc, priority, projectId, dueDate, recurrence) => {
            const taskId = await onAddTask(title, desc, priority, projectId, dueDate, recurrence);
            if (taskId) setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}

      {editingTask && (
        <EditTaskModal
          task={tasks.find(t => t.id === editingTask.id) ?? editingTask}
          projects={projects}
          onSave={async (id, updates) => { const ok = await onUpdateTask(id, updates); if (ok) setEditingTask(null); }}
          onAddSubtask={onAddSubtask}
          onToggleSubtask={onToggleSubtask}
          onDeleteSubtask={onDeleteSubtask}
          onAddComment={onAddComment}
          onDeleteComment={onDeleteComment}
          onClose={() => setEditingTask(null)}
        />
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4" onClick={() => setConfirmDeleteId(null)}>
          <div className="w-full max-w-sm rounded-lg border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-sm" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">Delete task?</h3>
              <p className="mt-1.5 text-sm text-[var(--text-muted)]">
                This will permanently remove "<span className="font-medium text-[var(--text-primary)]">{tasks.find(t => t.id === confirmDeleteId)?.title}</span>".
              </p>
            </div>
            <div className="flex gap-3 border-t border-[var(--border-soft)] px-5 py-4">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 rounded-xl border border-[var(--border-soft)] py-2.5 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { onDeleteTask(confirmDeleteId); setConfirmDeleteId(null); }}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white transition hover:bg-red-400"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
