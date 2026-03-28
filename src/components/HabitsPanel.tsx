import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Flame } from 'lucide-react';
import { cn } from '../utils/cn';
import type { Habit } from '../hooks/useHabits';

interface HabitsPanelProps {
  habits: Habit[];
  isLoading: boolean;
  onToggle: (id: string) => void;
  onAdd: (title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

export function HabitsPanel({
  habits,
  isLoading,
  onToggle,
  onAdd,
  onDelete,
  onClose,
  anchorRef,
}: HabitsPanelProps) {
  const [newTitle, setNewTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  // Position panel below anchor button
  const [pos, setPos] = useState({ top: 60, right: 16 });
  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleAdd = () => {
    const t = newTitle.trim();
    if (!t) return;
    onAdd(t);
    setNewTitle('');
    inputRef.current?.focus();
  };

  const pending = habits.filter(h => !h.doneToday);
  const done = habits.filter(h => h.doneToday);
  const doneCount = done.length;
  const totalCount = habits.length;

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-50 flex w-80 flex-col overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-2xl"
      style={{ top: pos.top, right: pos.right }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Routines</p>
          <p className="text-[11px] text-[var(--text-faint)]">{today}</p>
        </div>
        <div className="flex items-center gap-3">
          {totalCount > 0 && (
            <span className="text-[11px] text-[var(--text-faint)]">
              {doneCount}/{totalCount} done
            </span>
          )}
          <button onClick={onClose} className="rounded-lg p-1 text-[var(--text-faint)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="h-0.5 bg-[var(--border-soft)]">
          <div
            className="h-0.5 bg-emerald-400 transition-all duration-500"
            style={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }}
          />
        </div>
      )}

      {/* Habit list */}
      <div className="max-h-80 overflow-y-auto">
        {isLoading ? (
          <div className="px-4 py-6 text-center text-xs text-[var(--text-faint)]">Loading…</div>
        ) : habits.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium text-[var(--text-primary)]">No routines yet</p>
            <p className="mt-1 text-xs text-[var(--text-faint)]">Add one below to start tracking</p>
          </div>
        ) : (
          <ul className="py-1">
            {/* Pending */}
            {pending.map(habit => (
              <HabitRow
                key={habit.id}
                habit={habit}
                deletingId={deletingId}
                onToggle={onToggle}
                onDelete={onDelete}
                setDeletingId={setDeletingId}
              />
            ))}

            {/* Divider between pending and done */}
            {pending.length > 0 && done.length > 0 && (
              <li className="mx-4 my-1 border-t border-[var(--border-soft)]" />
            )}

            {/* Done */}
            {done.map(habit => (
              <HabitRow
                key={habit.id}
                habit={habit}
                deletingId={deletingId}
                onToggle={onToggle}
                onDelete={onDelete}
                setDeletingId={setDeletingId}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Add input */}
      <div className="border-t border-[var(--border-soft)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="Add a routine…"
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none"
          />
          <button
            onClick={handleAdd}
            disabled={!newTitle.trim()}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-strong)] text-white disabled:opacity-30 transition"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function HabitRow({
  habit,
  deletingId,
  onToggle,
  onDelete,
  setDeletingId,
}: {
  habit: Habit;
  deletingId: string | null;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  setDeletingId: (id: string | null) => void;
}) {
  return (
    <li
      className={cn(
        'group flex items-center gap-3 px-4 py-2 transition-colors hover:bg-[var(--surface-muted)]',
        habit.doneToday && 'opacity-50',
      )}
    >
      {/* Checkbox */}
      <button
        onClick={() => onToggle(habit.id)}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all',
          habit.doneToday
            ? 'border-emerald-400 bg-emerald-400'
            : 'border-[var(--border-strong)] hover:border-emerald-400',
        )}
      >
        {habit.doneToday && (
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1.5 5l2.5 2.5 4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Title */}
      <span className={cn(
        'flex-1 text-sm text-[var(--text-primary)]',
        habit.doneToday && 'line-through',
      )}>
        {habit.title}
      </span>

      {/* Streak */}
      {habit.streak > 1 && !deletingId && (
        <span className="flex items-center gap-0.5 text-[11px] text-orange-400">
          <Flame size={11} />
          {habit.streak}
        </span>
      )}

      {/* Delete */}
      {deletingId === habit.id ? (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onDelete(habit.id)}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-rose-400 hover:bg-rose-400/10"
          >
            Delete
          </button>
          <button
            onClick={() => setDeletingId(null)}
            className="rounded px-1.5 py-0.5 text-[10px] text-[var(--text-faint)] hover:bg-[var(--surface)]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setDeletingId(habit.id)}
          className="hidden rounded p-1 text-[var(--text-faint)] hover:text-rose-400 group-hover:flex"
        >
          <Trash2 size={12} />
        </button>
      )}
    </li>
  );
}
