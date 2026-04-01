import { useMemo, useState, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Task, Project, Deadline } from '../types';
import { cn } from '../utils/cn';
import { addDays, addMonths } from '../utils/dateHelpers';

interface TimelineViewProps {
  tasks: Task[];
  projects: Project[];
  deadlines?: Deadline[];
  onUpdateDueDate?: (id: string, dueDate: string | null) => Promise<boolean>;
}

type TimelineMode = 'month' | 'year';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const priorityColor: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#6b7280',
};


function formatShortDate(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function parseTaskDueDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

export function TimelineView({ tasks, projects, deadlines = [], onUpdateDueDate }: TimelineViewProps) {
  const today = startOfDay(new Date());
  const [mode, setMode] = useState<TimelineMode>('month');
  const [cursorDate, setCursorDate] = useState(startOfMonth(today));
  const [dragState, setDragState] = useState<{ taskId: string; dayIndex: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const rangeStart = startOfMonth(cursorDate);
  const rangeEnd = endOfMonth(cursorDate);
  const DAYS_VISIBLE = rangeEnd.getDate();

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
        const due = startOfDay(parseTaskDueDate(t.dueDate!));
        const created = startOfDay(new Date(t.createdAt));
        const start = created < rangeStart ? rangeStart : created;
        const end = due;
        return { task: t, start, end, project: projects.find(p => p.id === t.projectId) };
      })
      .filter(t => t.end >= rangeStart && t.start <= rangeEnd)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [tasks, projects, rangeStart.getTime(), rangeEnd.getTime()]);

  const yearRows = useMemo(() => {
    return tasks
      .filter(t => t.dueDate)
      .map(t => {
        const due = startOfDay(parseTaskDueDate(t.dueDate!));
        return {
          task: t,
          due,
          project: projects.find(p => p.id === t.projectId),
        };
      })
      .filter(t => t.due.getFullYear() === cursorDate.getFullYear())
      .sort((a, b) => a.due.getTime() - b.due.getTime());
  }, [tasks, projects, cursorDate]);

  const yearCounts = useMemo(() => {
    return Array.from({ length: 12 }, (_, monthIndex) =>
      yearRows.filter(row => row.due.getMonth() === monthIndex).length
    );
  }, [yearRows]);

  const tasksWithoutDates = tasks.filter(t => !t.dueDate);

  const getDayIndexFromMouse = useCallback((clientX: number) => {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const dayIndex = Math.floor((x / rect.width) * DAYS_VISIBLE);
    return Math.max(0, Math.min(DAYS_VISIBLE - 1, dayIndex));
  }, [DAYS_VISIBLE]);


  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">Timeline</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setCursorDate(startOfMonth(today));
                setMode('month');
              }}
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setCursorDate(prev => mode === 'month' ? addMonths(prev, -1) : new Date(prev.getFullYear() - 1, 0, 1))}
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-2 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => setCursorDate(prev => mode === 'month' ? addMonths(prev, 1) : new Date(prev.getFullYear() + 1, 0, 1))}
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-2 text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
            >
              <ChevronRight size={16} />
            </button>
            <span className="whitespace-nowrap rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-muted)]">
              {mode === 'month' ? formatMonthLabel(cursorDate) : cursorDate.getFullYear()}
            </span>
            <div className="ml-2 inline-flex rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] p-1">
              <button
                type="button"
                onClick={() => setMode('month')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs transition',
                  mode === 'month'
                    ? 'bg-[var(--surface)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
              >
                Month
              </button>
              <button
                type="button"
                onClick={() => setMode('year')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs transition',
                  mode === 'year'
                    ? 'bg-[var(--surface)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
              >
                Year
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface)]">
        {mode === 'month' ? (
          <>
            {/* Day headers */}
            <div className="flex border-b border-[var(--border-soft)]">
              <div className="w-56 shrink-0 border-r border-[var(--border-soft)] px-4 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                  Task
                </span>
              </div>
              <div className="flex flex-1 min-w-0">
                {days.map((day, i) => {
                  const isToday = day.getTime() === today.getTime();
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  return (
                    <div
                      key={i}
                      className={cn(
                        'flex-1 min-w-[28px] border-r border-[var(--border-soft)] last:border-r-0 px-0.5 py-2 text-center',
                        isWeekend && 'bg-[var(--surface-muted)]',
                      )}
                    >
                      <span className={cn(
                        'block text-[9px] font-semibold uppercase tracking-[0.18em]',
                        isToday ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'
                      )}>
                        {day.toLocaleDateString('en-US', { weekday: 'narrow' })}
                      </span>
                      <span className={cn(
                        'mt-1 block text-[10px]',
                        isToday ? 'text-[var(--accent)] font-bold' : 'text-[var(--text-faint)]'
                      )}>
                        {day.getDate()}
                      </span>
                      {deadlines.some(dl => {
                        const dayStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
                        return dl.dueDate === dayStr && dl.status !== 'done' && dl.status !== 'missed';
                      }) && (
                        <div className="w-2 h-2 rotate-45 bg-orange-400 mx-auto mt-0.5" title={
                          deadlines
                            .filter(dl => {
                              const dayStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
                              return dl.dueDate === dayStr;
                            })
                            .map(dl => dl.title)
                            .join(', ')
                        } />
                      )}
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
              const storedBarEnd = Math.min(DAYS_VISIBLE, daysBetween(rangeStart, end) + 1);
              const previewDayIndex = dragState?.taskId === task.id ? Math.max(barStart, dragState.dayIndex) : null;
              const barEnd = previewDayIndex !== null ? previewDayIndex + 1 : storedBarEnd;
              const barWidth = Math.max(1, barEnd - barStart);
              const subtaskProgress = task.subtasks.length > 0
                ? Math.round((task.subtasks.filter(s => s.done).length / task.subtasks.length) * 100)
                : null;
              const barColor = project?.color ?? priorityColor[task.priority] ?? 'var(--chart-accent)';
              const isDragging = dragState?.taskId === task.id;
              const previewDateLabel = previewDayIndex !== null
                ? formatShortDate(addDays(rangeStart, previewDayIndex))
                : null;

                  return (
                    <div key={task.id} className="flex items-center border-b border-[var(--border-soft)] transition-colors last:border-b-0 hover:bg-[var(--surface-muted)]/70">
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
                        </div>
                      </div>
                      <div ref={gridRef} className="flex flex-1 min-w-0 relative" style={{ height: 48 }}>
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
                        {today >= rangeStart && today <= rangeEnd && (
                          <div
                            className="absolute top-0 bottom-0 w-px bg-[var(--accent)] opacity-40"
                            style={{ left: `${(daysBetween(rangeStart, today) / DAYS_VISIBLE) * 100}%` }}
                          />
                        )}
                        <div
                          className={cn(
                            'absolute top-2.5 rounded-full group/bar shadow-sm',
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
                          {previewDateLabel && (
                            <div className="absolute -top-8 right-0 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-2 py-1 text-[10px] font-medium text-[var(--text-primary)] shadow-sm">
                              {previewDateLabel}
                            </div>
                          )}
                          {onUpdateDueDate && task.status !== 'done' && (
                            <div
                              className="absolute -right-1 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 opacity-0 group-hover/bar:opacity-100 transition-opacity cursor-ew-resize"
                              style={{ borderColor: barColor }}
                              onMouseDown={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                const initialDayIndex = getDayIndexFromMouse(e.clientX);
                                setDragState({
                                  taskId: task.id,
                                  dayIndex: initialDayIndex !== null ? Math.max(barStart, initialDayIndex) : storedBarEnd - 1,
                                });

                                const onMove = (moveEvent: MouseEvent) => {
                                  const nextDayIndex = getDayIndexFromMouse(moveEvent.clientX);
                                  if (nextDayIndex === null) return;
                                  setDragState({
                                    taskId: task.id,
                                    dayIndex: Math.max(barStart, nextDayIndex),
                                  });
                                };
                                const onUp = (ue: MouseEvent) => {
                                  window.removeEventListener('mousemove', onMove);
                                  window.removeEventListener('mouseup', onUp);
                                  const nextDayIndex = getDayIndexFromMouse(ue.clientX);
                                  const clampedIndex = Math.max(barStart, nextDayIndex ?? storedBarEnd - 1);
                                  const newDueDate = addDays(rangeStart, clampedIndex);
                                  setDragState(null);
                                  onUpdateDueDate(task.id, `${newDueDate.getFullYear()}-${String(newDueDate.getMonth() + 1).padStart(2, '0')}-${String(newDueDate.getDate()).padStart(2, '0')}`);
                                };
                                window.addEventListener('mousemove', onMove);
                                window.addEventListener('mouseup', onUp);
                              }}
                            />
                          )}
                        </div>
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

                {tasksWithoutDates.length > 0 && (
                  <div className="border-t border-[var(--border-soft)] bg-[var(--surface)] px-4 py-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                        Tasks without dates
                      </p>
                      <span className="rounded-full border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-muted)]">
                        {tasksWithoutDates.length} total
                      </span>
                    </div>
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
          </>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[220px_repeat(12,minmax(64px,1fr))] border-b border-[var(--border-soft)]">
                <div className="border-r border-[var(--border-soft)] px-4 py-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                    Task
                  </span>
                </div>
                {MONTH_NAMES.map((monthName, monthIndex) => {
                  const isCurrentMonth = monthIndex === today.getMonth() && cursorDate.getFullYear() === today.getFullYear();
                  return (
                    <div
                      key={monthName}
                      className={cn(
                        'border-r border-[var(--border-soft)] px-2 py-3 text-center last:border-r-0',
                        isCurrentMonth && 'bg-[var(--surface-muted)]'
                      )}
                    >
                      <span className={cn(
                        'block text-[9px] font-semibold uppercase tracking-[0.14em]',
                        isCurrentMonth ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'
                      )}>
                        {monthName.slice(0, 3)}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--text-secondary)]">
                        {yearCounts[monthIndex]}
                      </span>
                    </div>
                  );
                })}
              </div>

              {yearRows.length === 0 ? (
                <div className="flex min-h-[200px] items-center justify-center text-sm text-[var(--text-faint)]">
                  No tasks to show for {cursorDate.getFullYear()}.
                </div>
              ) : (
                yearRows.map(({ task, due, project }) => (
                  <div key={task.id} className="grid grid-cols-[220px_repeat(12,minmax(64px,1fr))] items-center border-b border-[var(--border-soft)] last:border-b-0">
                    <div className="border-r border-[var(--border-soft)] px-4 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {project && <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: project.color }} />}
                        <span className="truncate text-sm text-[var(--text-primary)]">{task.title}</span>
                      </div>
                    </div>
                    {MONTH_NAMES.map((_, monthIndex) => {
                      const isDueMonth = due.getMonth() === monthIndex;
                      const isCurrentMonth = monthIndex === today.getMonth() && cursorDate.getFullYear() === today.getFullYear();
                      return (
                        <div
                          key={`${task.id}-${monthIndex}`}
                          className={cn(
                            'border-r border-[var(--border-soft)] px-2 py-4 text-center last:border-r-0',
                            isCurrentMonth && 'bg-[var(--surface-muted)]'
                          )}
                        >
                          {isDueMonth ? (
                            <span className="inline-flex rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--accent)]">
                              {formatShortDate(due)}
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--text-faint)]">0</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
