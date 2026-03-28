import { useEffect, useState } from 'react';
import { Plus, Trash2, ChevronDown, Search, Filter, Pencil, MessageSquare, Target, ListTodo, Clock3, CheckCircle2, AlertCircle } from 'lucide-react';
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

const statusColumns: { status: TaskStatus; label: string; color: string; dotColor: string }[] = [
  { status: 'todo', label: 'To Do', color: 'border-[var(--border-strong)]', dotColor: 'bg-[var(--text-faint)]' },
  { status: 'in-progress', label: 'In Progress', color: 'border-blue-600', dotColor: 'bg-blue-400' },
  { status: 'done', label: 'Done', color: 'border-emerald-600', dotColor: 'bg-emerald-400' },
];

const priorityBadge = (p: Priority) => {
  if (p === 'high') return 'bg-red-500/10 text-red-400 border-red-500/20';
  if (p === 'medium') return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
  return 'bg-[var(--surface-muted)] text-[var(--text-faint)] border-[var(--border-soft)]';
};

function TaskCard({
  task,
  projects,
  deadline,
  onUpdateStatus,
  onEdit,
  onDelete,
  onOpenDeadline,
}: {
  task: Task;
  projects: Project[];
  deadline?: Deadline;
  onUpdateStatus: (id: string, status: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onOpenDeadline?: (deadlineId: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const project = projects.find(p => p.id === task.projectId);

  const dueLabel = task.dueDate
    ? new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';

  return (
    <div className="group rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-sm transition-all hover:border-[var(--border-strong)] hover:shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium leading-snug text-[var(--text-primary)]">{task.title}</h4>
        <div className="relative flex items-center gap-0.5">
          <button
            onClick={() => onEdit(task)}
            className="p-1 text-[var(--text-faint)] opacity-100 transition-opacity hover:text-[var(--text-secondary)] md:opacity-0 md:group-hover:opacity-100"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 text-[var(--text-faint)] opacity-100 transition-opacity hover:text-[var(--text-secondary)] md:opacity-0 md:group-hover:opacity-100"
          >
            <ChevronDown size={14} />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-6 z-20 w-36 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] py-1 shadow-xl">
                {statusColumns.map(col => (
                  <button
                    key={col.status}
                    onClick={() => { onUpdateStatus(task.id, col.status); setShowMenu(false); }}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-xs transition-colors',
                      task.status === col.status ? 'text-[var(--accent)] bg-[var(--accent-soft)]' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-strong)]'
                    )}
                  >
                    {col.label}
                  </button>
                ))}
                <hr className="my-1 border-[var(--border-soft)]" />
                <button
                  onClick={() => { onDelete(task.id); setShowMenu(false); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-[var(--surface-muted)]"
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </>
          )}
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
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all');
  const [filterProject, setFilterProject] = useState<string>(initialProjectFilter);
  const totalTasks = tasks.length;
  const openTasks = tasks.filter(task => task.status !== 'done').length;
  const completedTasks = tasks.filter(task => task.status === 'done').length;
  const overdueTasks = tasks.filter(task => task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done').length;

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
      <div className="overflow-hidden rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-5 shadow-sm sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">Tasks</h1>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[420px]">
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">Total</p>
                <ListTodo size={14} className="text-indigo-400" />
              </div>
              <p className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{totalTasks}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">Open</p>
                <Clock3 size={14} className="text-blue-400" />
              </div>
              <p className="mt-1 text-2xl font-bold text-blue-400">{openTasks}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">Done</p>
                <CheckCircle2 size={14} className="text-emerald-400" />
              </div>
              <p className="mt-1 text-2xl font-bold text-emerald-400">{completedTasks}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">Overdue</p>
                <AlertCircle size={14} className="text-red-400" />
              </div>
              <p className="mt-1 text-2xl font-bold text-red-400">{overdueTasks}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input
              type="text"
              placeholder="Search tasks by title or notes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] py-3 pr-4 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <select
                value={filterPriority}
                onChange={e => setFilterPriority(e.target.value as Priority | 'all')}
                className="cursor-pointer appearance-none rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] py-3 pr-8 pl-8 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
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
              className="cursor-pointer appearance-none rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-3 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
            >
              <option value="all">All Courses</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-[var(--accent-contrast)] shadow-lg transition-colors"
              style={{ backgroundColor: 'var(--accent-strong)', boxShadow: '0 16px 34px var(--glow-accent)' }}
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
              <div key={col.status} className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-sm transition-colors hover:border-[var(--border-strong)]">
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
                        'min-h-[120px] space-y-3 rounded-2xl transition-colors',
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
                                onUpdateStatus={onUpdateStatus}
                                onEdit={setEditingTask}
                                onDelete={onDeleteTask}
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
    </div>
  );
}
