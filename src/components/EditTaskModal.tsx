import { useState } from 'react';
import { X, Plus, Trash2, Check, MessageSquare, Send } from 'lucide-react';
import { Task, Project, Priority, Recurrence } from '../types';
import { cn } from '../utils/cn';

interface EditTaskModalProps {
  task: Task;
  projects: Project[];
  onSave: (id: string, updates: { title?: string; description?: string; priority?: Priority; projectId?: string | null; dueDate?: string | null; recurrence?: Recurrence }) => Promise<void> | void;
  onAddSubtask: (taskId: string, title: string) => Promise<boolean>;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
  onDeleteSubtask: (subtaskId: string) => void;
  onAddComment: (taskId: string, text: string) => Promise<boolean>;
  onDeleteComment: (commentId: string) => void;
  onClose: () => void;
}

export function EditTaskModal({ task, projects, onSave, onAddSubtask, onToggleSubtask, onDeleteSubtask, onAddComment, onDeleteComment, onClose }: EditTaskModalProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [projectId, setProjectId] = useState<string>(task.projectId ?? '');
  const [dueDate, setDueDate] = useState(task.dueDate ? task.dueDate.slice(0, 10) : '');
  const [isSaving, setIsSaving] = useState(false);
  const [newSubtask, setNewSubtask] = useState('');
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [isAddingComment, setIsAddingComment] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await onSave(task.id, {
        title: title.trim(),
        description: description.trim(),
        priority,
        projectId: projectId || null,
        dueDate: dueDate || null,
        recurrence: 'none',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Edit Task</h2>
          <button onClick={onClose} className="text-[var(--text-faint)] transition-colors hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              autoFocus
              className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Add details..."
              rows={3}
              className="w-full resize-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Priority</label>
              <div className="flex gap-1.5">
                {(['low', 'medium', 'high'] as Priority[]).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={cn(
                      'flex-1 py-1.5 rounded-md text-xs font-medium capitalize border transition-all',
                      priority === p
                        ? p === 'high' ? 'bg-red-500/20 text-red-400 border-red-500/30'
                          : p === 'medium' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                          : 'bg-[var(--surface-strong)] text-[var(--text-secondary)] border-[var(--border-strong)]'
                        : 'bg-[var(--surface-muted)] text-[var(--text-faint)] border-[var(--border-soft)] hover:border-[var(--border-strong)]'
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Course</label>
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="w-full cursor-pointer appearance-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
            >
              <option value="">No Course</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {/* Subtasks */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Subtasks</label>
            <div className="space-y-1.5">
              {task.subtasks.map(st => (
                <div key={st.id} className="flex items-center gap-2 group">
                  <button
                    type="button"
                    onClick={() => onToggleSubtask(st.id, !st.done)}
                    className={cn(
                      'flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition-colors',
                      st.done
                        ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                        : 'border-[var(--border-soft)] text-transparent hover:border-[var(--border-strong)]'
                    )}
                  >
                    <Check size={10} />
                  </button>
                  <span className={cn('flex-1 text-sm', st.done ? 'text-[var(--text-faint)] line-through' : 'text-[var(--text-secondary)]')}>
                    {st.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDeleteSubtask(st.id)}
                    className="p-0.5 text-[var(--text-faint)] opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={newSubtask}
                onChange={e => setNewSubtask(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && newSubtask.trim() && !isAddingSubtask) {
                    e.preventDefault();
                    setIsAddingSubtask(true);
                    const ok = await onAddSubtask(task.id, newSubtask.trim());
                    if (ok) setNewSubtask('');
                    setIsAddingSubtask(false);
                  }
                }}
                placeholder="Add a subtask..."
                className="flex-1 rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                disabled={!newSubtask.trim() || isAddingSubtask}
                onClick={async () => {
                  if (!newSubtask.trim() || isAddingSubtask) return;
                  setIsAddingSubtask(true);
                  const ok = await onAddSubtask(task.id, newSubtask.trim());
                  if (ok) setNewSubtask('');
                  setIsAddingSubtask(false);
                }}
                className="rounded-md border border-[var(--border-soft)] p-1.5 text-[var(--text-faint)] transition hover:border-[var(--border-strong)] hover:text-[var(--accent)] disabled:opacity-40"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Comments */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <MessageSquare size={12} className="text-[var(--text-faint)]" />
              <label className="text-xs font-medium text-[var(--text-muted)]">Comments</label>
            </div>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {task.comments.map(c => (
                <div key={c.id} className="flex items-start gap-2 group">
                  <div className="flex-1 rounded-md bg-[var(--surface-muted)] px-2.5 py-1.5">
                    <p className="text-sm text-[var(--text-secondary)]">{c.text}</p>
                    <p className="text-[9px] text-[var(--text-faint)] mt-0.5">
                      {new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteComment(c.id)}
                    className="p-0.5 mt-1 text-[var(--text-faint)] opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              {task.comments.length === 0 && (
                <p className="text-xs text-[var(--text-faint)] py-1">No comments yet</p>
              )}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && newComment.trim() && !isAddingComment) {
                    e.preventDefault();
                    setIsAddingComment(true);
                    const ok = await onAddComment(task.id, newComment.trim());
                    if (ok) setNewComment('');
                    setIsAddingComment(false);
                  }
                }}
                placeholder="Add a comment..."
                className="flex-1 rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                disabled={!newComment.trim() || isAddingComment}
                onClick={async () => {
                  if (!newComment.trim() || isAddingComment) return;
                  setIsAddingComment(true);
                  const ok = await onAddComment(task.id, newComment.trim());
                  if (ok) setNewComment('');
                  setIsAddingComment(false);
                }}
                className="rounded-md border border-[var(--border-soft)] p-1.5 text-[var(--text-faint)] transition hover:border-[var(--border-strong)] hover:text-[var(--accent)] disabled:opacity-40"
              >
                <Send size={14} />
              </button>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-[var(--border-soft)] py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || isSaving}
              className="flex-1 rounded-lg py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent-strong)' }}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
