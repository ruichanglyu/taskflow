import { useMemo, useState, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Task, Project } from '../types';
import { cn } from '../utils/cn';

interface TimelineViewProps {
  tasks: Task[];
  projects: Project[];
  onUpdateDueDate?: (id: string, dueDate: string | null) => Promise<boolean>;
}

const priorityColor: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#6b7280',
};

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function TimelineView({ tasks, projects, onUpdateDueDate }: TimelineViewProps) {
  const today = startOfDay(new Date());
  const [offsetWeeks, setOffsetWeeks] = useState(0);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const DAYS_VISIBLE = 28;
  const rangeStart = addDays(today, offsetWeeks * 7 - 7);
  const rangeEnd = addDays(rangeStart, DAYS_VISIBLE);

  const days = useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < DAYS_VISIBLE; i++) {
      arr.push(addDays(rangeStart, i));
    }
    return arr;
  }, [rangeStart.getTime()]);

  // Tasks that have due dates and fall within visible range
  const timelineTasks = useMemo(() => {
    return tasks
      .filter(t => t.dueDate)
      .map(t => {
        const due = startOfDay(new Date(t.dueDate!));
        const created = startOfDay(new Date(t.createdAt));
        const start = created < rangeStart ? rangeStart : created;
        const end = due;
        return { task: t, start, end, project: projects.find(p => p.id === t.projectId) };
      })
      .filter(t => t.end >= rangeStart && t.start <= rangeEnd)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [tasks, projects, rangeStart.getTime(), rangeEnd.getTime()]);

  const tasksWithoutDates = tasks.filter(t => !t.dueDate);

  const handleDragStart = useCallback((taskId: string) => {
    setDraggingId(taskId);
  }, []);


  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Timeline</h1>
          <p className="mt-1 text-[var(--text-muted)]">
            Gantt-style timeline
            {onUpdateDueDate && <span className="ml-1 text-xs text-[var(--text-faint)]">· Drag bar ends to reschedule</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOffsetWeeks(0)}
            className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setOffsetWeeks(w => w - 1)}
            className="rounded-lg border border-[var(--border-soft)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => setOffsetWeeks(w => w + 1)}
            className="rounded-lg border border-[var(--border-soft)] p-1.5 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
          >
            <ChevronRight size={16} />
          </button>
          <span className="ml-2 text-sm text-[var(--text-muted)]">
            {formatShortDate(rangeStart)} — {formatShortDate(addDays(rangeEnd, -1))}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] overflow-hidden">
        {/* Day headers */}
        <div className="flex border-b border-[var(--border-soft)]">
          <div className="w-56 shrink-0 border-r border-[var(--border-soft)] px-4 py-2">
            <span className="text-xs font-medium text-[var(--text-muted)]">Task</span>
          </div>
          <div className="flex flex-1 min-w-0">
            {days.map((day, i) => {
              const isToday = day.getTime() === today.getTime();
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              return (
                <div
                  key={i}
                  className={cn(
                    'flex-1 min-w-[36px] border-r border-[var(--border-soft)] last:border-r-0 px-0.5 py-2 text-center',
                    isWeekend && 'bg-[var(--surface-muted)]',
                  )}
                >
                  <span className={cn(
                    'text-[9px] font-medium block',
                    isToday ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'
                  )}>
                    {day.toLocaleDateString('en-US', { weekday: 'narrow' })}
                  </span>
                  <span className={cn(
                    'text-[10px] block',
                    isToday ? 'text-[var(--accent)] font-bold' : 'text-[var(--text-faint)]'
                  )}>
                    {day.getDate()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Task rows */}
        {timelineTasks.length === 0 && tasksWithoutDates.length === 0 ? (
          <div className="flex min-h-[200px] items-center justify-center text-sm text-[var(--text-faint)]">
            No tasks to show. Add due dates to your tasks to see them here.
          </div>
        ) : (
          <>
            {timelineTasks.map(({ task, start, end, project }) => {
              const barStart = Math.max(0, daysBetween(rangeStart, start));
              const barEnd = Math.min(DAYS_VISIBLE, daysBetween(rangeStart, end) + 1);
              const barWidth = Math.max(1, barEnd - barStart);
              const subtaskProgress = task.subtasks.length > 0
                ? Math.round((task.subtasks.filter(s => s.done).length / task.subtasks.length) * 100)
                : null;
              const barColor = project?.color ?? priorityColor[task.priority] ?? '#6366f1';
              const isDragging = draggingId === task.id;

              return (
                <div key={task.id} className="flex items-center border-b border-[var(--border-soft)] last:border-b-0 hover:bg-[var(--surface-muted)] transition-colors">
                  <div className="w-56 shrink-0 border-r border-[var(--border-soft)] px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {project && (
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
                      )}
                      <span className="text-sm text-[var(--text-primary)] truncate">{task.title}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={cn(
                        'text-[10px] capitalize',
                        task.status === 'done' ? 'text-emerald-400' : task.status === 'in-progress' ? 'text-blue-400' : 'text-[var(--text-faint)]'
                      )}>
                        {task.status === 'in-progress' ? 'In Progress' : task.status === 'todo' ? 'To Do' : 'Done'}
                      </span>
                      {subtaskProgress !== null && (
                        <span className="text-[10px] text-[var(--text-faint)]">
                          {task.subtasks.filter(s => s.done).length}/{task.subtasks.length} subtasks
                        </span>
                      )}
                      {task.recurrence !== 'none' && (
                        <span className="text-[10px] text-indigo-400">⟳ {task.recurrence}</span>
                      )}
                    </div>
                  </div>
                  <div ref={gridRef} className="flex flex-1 min-w-0 relative" style={{ height: 48 }}>
                    {/* Weekend backgrounds */}
                    {days.map((day, i) => {
                      const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                      return isWeekend ? (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 bg-[var(--surface-muted)]"
                          style={{ left: `${(i / DAYS_VISIBLE) * 100}%`, width: `${(1 / DAYS_VISIBLE) * 100}%` }}
                        />
                      ) : null;
                    })}
                    {/* Today marker */}
                    {today >= rangeStart && today <= rangeEnd && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-[var(--accent)] opacity-40"
                        style={{ left: `${(daysBetween(rangeStart, today) / DAYS_VISIBLE) * 100}%` }}
                      />
                    )}
                    {/* Task bar */}
                    <div
                      className={cn(
                        'absolute top-2.5 rounded-full transition-all group/bar',
                        onUpdateDueDate && 'cursor-grab',
                        isDragging && 'cursor-grabbing opacity-70'
                      )}
                      style={{
                        left: `${(barStart / DAYS_VISIBLE) * 100}%`,
                        width: `${(barWidth / DAYS_VISIBLE) * 100}%`,
                        height: 10,
                        backgroundColor: task.status === 'done' ? '#10b981' : barColor,
                        opacity: task.status === 'done' ? 0.6 : 0.85,
                      }}
                    >
                      {/* Drag handle on the right end */}
                      {onUpdateDueDate && task.status !== 'done' && (
                        <div
                          className="absolute -right-1 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 opacity-0 group-hover/bar:opacity-100 transition-opacity cursor-ew-resize"
                          style={{ borderColor: barColor }}
                          onMouseDown={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDragStart(task.id);

                            const onMove = (_: MouseEvent) => {
                              // visual only
                            };
                            const onUp = (ue: MouseEvent) => {
                              window.removeEventListener('mousemove', onMove);
                              window.removeEventListener('mouseup', onUp);
                              // Calculate new date from mouse position
                              if (gridRef.current) {
                                const rect = gridRef.current.getBoundingClientRect();
                                const x = ue.clientX - rect.left;
                                const dayIndex = Math.floor((x / rect.width) * DAYS_VISIBLE);
                                const clampedIndex = Math.max(0, Math.min(DAYS_VISIBLE - 1, dayIndex));
                                const newDueDate = addDays(rangeStart, clampedIndex);
                                setDraggingId(null);
                                onUpdateDueDate(task.id, newDueDate.toISOString());
                              } else {
                                setDraggingId(null);
                              }
                            };
                            window.addEventListener('mousemove', onMove);
                            window.addEventListener('mouseup', onUp);
                          }}
                        />
                      )}
                    </div>
                    {/* Subtask progress overlay */}
                    {subtaskProgress !== null && subtaskProgress > 0 && task.status !== 'done' && (
                      <div
                        className="absolute top-2.5 rounded-full pointer-events-none"
                        style={{
                          left: `${(barStart / DAYS_VISIBLE) * 100}%`,
                          width: `${((barWidth / DAYS_VISIBLE) * subtaskProgress) / 100 * 100}%`,
                          height: 10,
                          backgroundColor: '#10b981',
                          opacity: 0.5,
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}

            {/* Tasks without dates */}
            {tasksWithoutDates.length > 0 && (
              <div className="border-t border-[var(--border-soft)] px-4 py-3">
                <p className="text-xs font-medium text-[var(--text-faint)] mb-2">
                  {tasksWithoutDates.length} task{tasksWithoutDates.length !== 1 ? 's' : ''} without due dates
                </p>
                <div className="flex flex-wrap gap-2">
                  {tasksWithoutDates.slice(0, 10).map(t => (
                    <span key={t.id} className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
                      {t.title}
                    </span>
                  ))}
                  {tasksWithoutDates.length > 10 && (
                    <span className="text-xs text-[var(--text-faint)]">+{tasksWithoutDates.length - 10} more</span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
