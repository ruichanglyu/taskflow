import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Sparkles, Square, Trash2, Key, Check, AlertCircle, Download, ChevronDown, ImagePlus } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useAI, getAPIKey, setAPIKey, removeAPIKey, parseImportBlocks, type ChatMessage, type ImportBlock, type ImageAttachment } from '../hooks/useAI';
import type { Task, Deadline, Project, WorkoutPlan, WorkoutDayTemplate, Exercise, WorkoutDayExercise, Priority, DeadlineType, DeadlineStatus } from '../types';
import type { Recurrence } from '../types';
import { cn } from '../utils/cn';

interface AIPanelProps {
  open: boolean;
  onClose: () => void;
  // App data for context
  tasks: Task[];
  deadlines: Deadline[];
  projects: Project[];
  plans: WorkoutPlan[];
  dayTemplates: WorkoutDayTemplate[];
  exercises: Exercise[];
  dayExercises: WorkoutDayExercise[];
  // Callbacks for imports
  onAddTask: (title: string, description: string, priority: Priority, projectId: string | null, dueDate: string | null, recurrence: Recurrence) => Promise<string | null>;
  onAddDeadline: (title: string, projectId: string | null, type: DeadlineType, dueDate: string, dueTime: string | null, notes: string, status?: DeadlineStatus) => Promise<boolean>;
  onAddProject: (name: string, description: string) => Promise<string | null>;
  onAddSubtask: (taskId: string, title: string) => Promise<boolean>;
  onDeleteTask: (taskId: string) => Promise<boolean>;
}

export function AIPanel({
  open, onClose,
  tasks, deadlines, projects, plans, dayTemplates, exercises, dayExercises,
  onAddTask, onAddDeadline, onAddProject, onAddSubtask, onDeleteTask,
}: AIPanelProps) {
  const { messages, isStreaming, error, sendMessage, stopStreaming, clearChat } = useAI();
  const [input, setInput] = useState('');
  const [apiKey, setApiKey] = useState(getAPIKey() ?? '');
  const [hasKey, setHasKey] = useState(!!getAPIKey());
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [importedBlocks, setImportedBlocks] = useState<Set<string>>(new Set());
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open && hasKey) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open, hasKey]);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && !pendingImages.length) || isStreaming) return;
    const msg = input.trim() || (pendingImages.length ? 'What do you see in this image?' : '');
    const images = pendingImages.length ? [...pendingImages] : undefined;
    setInput('');
    setPendingImages([]);
    await sendMessage(msg, { tasks, deadlines, projects, plans, dayTemplates, exercises, dayExercises }, images);
  }, [input, pendingImages, isStreaming, sendMessage, tasks, deadlines, projects, plans, dayTemplates, exercises, dayExercises]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      // Limit to 4MB per image (base64 will be ~33% larger)
      if (file.size > 4 * 1024 * 1024) {
        setError('Image too large (max 4MB). Try a smaller image or screenshot.');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // Extract base64 data and mime type
        const [header, base64] = dataUrl.split(',');
        const mimeType = header.match(/data:(.*?);/)?.[1] ?? 'image/png';
        setPendingImages(prev => [...prev, { base64, mimeType, preview: dataUrl }]);
      };
      reader.readAsDataURL(file);
    });

    // Reset file input so same file can be selected again
    e.target.value = '';
  };

  const removePendingImage = (index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSaveKey = () => {
    if (apiKey.trim()) {
      setAPIKey(apiKey.trim());
      setHasKey(true);
      setShowKeyInput(false);
    }
  };

  const handleRemoveKey = () => {
    removeAPIKey();
    setApiKey('');
    setHasKey(false);
    setShowKeyInput(false);
  };

  const handleImport = async (block: ImportBlock, blockKey: string) => {
    let imported = 0;
    const projectCache = new Map<string, string | null>();

    // Resolve course name → projectId, create if needed
    const resolveProject = async (courseName?: string): Promise<string | null> => {
      if (!courseName) return null;
      const normalized = courseName.trim().toLowerCase();
      if (projectCache.has(normalized)) return projectCache.get(normalized) ?? null;

      const existing = projects.find(p => p.name.trim().toLowerCase() === normalized);
      if (existing) {
        projectCache.set(normalized, existing.id);
        return existing.id;
      }

      const newId = await onAddProject(courseName.trim(), '');
      projectCache.set(normalized, newId);
      return newId;
    };

    if (block.type === 'delete-tasks') {
      let skipped = 0;
      for (const row of block.rows) {
        const matches = tasks.filter(t => t.title.trim().toLowerCase() === row.title.trim().toLowerCase());
        if (matches.length !== 1) {
          skipped++;
          continue;
        }

        const ok = await onDeleteTask(matches[0].id);
        if (ok) {
          imported++;
        } else {
          skipped++;
        }
      }

      if (skipped > 0) {
        setError(
          skipped === 1
            ? 'Skipped 1 AI delete entry because it was ambiguous, missing, or failed to delete.'
            : `Skipped ${skipped} AI delete entries because they were ambiguous, missing, or failed to delete.`,
        );
      }
    } else if (block.type === 'subtasks') {
      // Find the parent task by title (case-insensitive)
      const parentTitle = block.parentTaskTitle?.toLowerCase() ?? '';
      const parentTask = tasks.find(t => t.title.toLowerCase() === parentTitle);
      if (!parentTask) {
        // If parent not found, fall back to creating as top-level tasks
        for (const row of block.rows) {
          const result = await onAddTask(row.title, '', 'medium', null, null, 'none');
          if (result) imported++;
        }
      } else {
        for (const row of block.rows) {
          const ok = await onAddSubtask(parentTask.id, row.title);
          if (ok) imported++;
        }
      }
    } else if (block.type === 'tasks') {
      for (const row of block.rows) {
        const projectId = await resolveProject(row.course);
        const priority = (['low', 'medium', 'high'].includes(row.priority ?? '') ? row.priority : 'medium') as Priority;
        const recurrence = (['none', 'daily', 'weekly', 'monthly'].includes(row.recurrence ?? '') ? row.recurrence : 'none') as Recurrence;
        const result = await onAddTask(
          row.title,
          row.description ?? '',
          priority,
          projectId,
          row.dueDate ?? null,
          recurrence,
        );
        if (result) imported++;
      }
    } else if (block.type === 'deadlines') {
      for (const row of block.rows) {
        if (!row.dueDate) continue;
        const projectId = await resolveProject(row.course);
        const type = (['assignment', 'exam', 'quiz', 'lab', 'project', 'other'].includes(row.type ?? '') ? row.type : 'other') as DeadlineType;
        const status = (['not-started', 'in-progress', 'done', 'missed'].includes(row.status ?? '') ? row.status : 'not-started') as DeadlineStatus;
        const ok = await onAddDeadline(
          row.title,
          projectId,
          type,
          row.dueDate,
          row.dueTime ?? null,
          row.notes ?? '',
          status,
        );
        if (ok) imported++;
      }
    }

    setImportedBlocks(prev => new Set(prev).add(blockKey));
    return imported;
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl animate-in slide-in-from-right duration-200"
        onClick={e => e.stopPropagation()}
        style={{ animationDuration: '200ms' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ backgroundImage: 'var(--sidebar-gradient)' }}>
              <Sparkles size={16} className="text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI Assistant</h3>
              <p className="text-[10px] text-[var(--text-faint)]">Powered by Gemini</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowKeyInput(!showKeyInput)}
              className={cn(
                'rounded-lg p-1.5 transition',
                hasKey
                  ? 'text-[var(--text-faint)] hover:text-[var(--text-primary)]'
                  : 'text-amber-400 hover:text-amber-300'
              )}
              title={hasKey ? 'API key settings' : 'Add API key'}
            >
              <Key size={14} />
            </button>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="rounded-lg p-1.5 text-[var(--text-faint)] transition hover:text-[var(--text-primary)]"
                title="Clear chat"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-[var(--text-faint)] transition hover:text-[var(--text-primary)]"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* API Key Input */}
        {(showKeyInput || !hasKey) && (
          <div className="border-b border-[var(--border-soft)] bg-[var(--surface-muted)] px-4 py-3">
            <p className="mb-2 text-xs text-[var(--text-muted)]">
              {hasKey ? 'Your API key is saved.' : 'Enter your Google Gemini API key to get started (free tier available).'}{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">Get a free key →</a>
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="Paste your Gemini API key"
                className="flex-1 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                onKeyDown={e => { if (e.key === 'Enter') handleSaveKey(); }}
              />
              <button
                onClick={handleSaveKey}
                disabled={!apiKey.trim()}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--accent-contrast)] disabled:opacity-40"
                style={{ backgroundColor: 'var(--accent-strong)' }}
              >
                Save
              </button>
              {hasKey && (
                <button
                  onClick={handleRemoveKey}
                  className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[10px] text-[var(--text-faint)]">
              Key is stored locally in your browser. Free tier: 15 req/min, 500 req/day.
            </p>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <WelcomeScreen hasKey={hasKey} />
          ) : (
            <div className="space-y-4">
              {messages.map(msg => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  projects={projects}
                  importedBlocks={importedBlocks}
                  onImport={handleImport}
                  isStreaming={isStreaming && msg === messages[messages.length - 1] && msg.role === 'assistant'}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-2 flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-[var(--border-soft)] px-4 py-3">
          {/* Pending image previews */}
          {pendingImages.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingImages.map((img, i) => (
                <div key={i} className="group relative">
                  <img
                    src={img.preview}
                    alt="Pending upload"
                    className="h-16 w-16 rounded-lg border border-[var(--border-soft)] object-cover"
                  />
                  <button
                    onClick={() => removePendingImage(i)}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] text-white opacity-0 shadow transition group-hover:opacity-100"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              className="hidden"
            />
            {/* Image upload button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!hasKey || isStreaming}
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border border-[var(--border-soft)] text-[var(--text-faint)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
              title="Attach image"
            >
              <ImagePlus size={16} />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasKey ? 'Ask anything or request tasks/deadlines...' : 'Add your Gemini API key above to start'}
              disabled={!hasKey || isStreaming}
              rows={1}
              className="max-h-32 min-h-[38px] flex-1 resize-none rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-50"
              style={{ height: 'auto' }}
              onInput={e => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = Math.min(target.scrollHeight, 128) + 'px';
              }}
            />
            {isStreaming ? (
              <button
                onClick={stopStreaming}
                className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white transition hover:bg-rose-600"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={(!input.trim() && !pendingImages.length) || !hasKey}
                className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl text-[var(--accent-contrast)] transition disabled:opacity-40"
                style={{ backgroundColor: 'var(--accent-strong)' }}
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// --- Welcome Screen ---
function WelcomeScreen({ hasKey }: { hasKey: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundImage: 'var(--sidebar-gradient)' }}>
        <Sparkles size={24} className="text-white" />
      </div>
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">AI Assistant</h3>
      <p className="mt-2 max-w-xs text-sm text-[var(--text-muted)]">
        {hasKey
          ? 'Ask me anything about your schedule, or tell me to create tasks and deadlines for you.'
          : 'Add your Google Gemini API key above to get started — it\'s free!'}
      </p>
      {hasKey && (
        <div className="mt-6 space-y-2 text-left">
          <SuggestionChip text="What's due this week?" />
          <SuggestionChip text="Create study tasks for my next exam" />
          <SuggestionChip text="Summarize my workload" />
          <SuggestionChip text="Generate a deadlines CSV for this month" />
        </div>
      )}
    </div>
  );
}

function SuggestionChip({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
      {text}
    </div>
  );
}

// --- Message Bubble ---
function MessageBubble({
  message,
  projects,
  importedBlocks,
  onImport,
  isStreaming,
}: {
  message: ChatMessage;
  projects: Project[];
  importedBlocks: Set<string>;
  onImport: (block: ImportBlock, key: string) => Promise<number>;
  isStreaming: boolean;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-2">
          {message.images?.length ? (
            <div className="flex flex-wrap justify-end gap-1.5">
              {message.images.map((img, i) =>
                img.preview ? (
                  <img
                    key={i}
                    src={img.preview}
                    alt="Uploaded"
                    className="max-h-48 max-w-full rounded-xl border border-white/10 object-contain"
                  />
                ) : (
                  <div key={i} className="flex h-16 w-20 items-center justify-center rounded-xl border border-white/10 bg-[var(--surface-muted)]">
                    <ImagePlus size={14} className="text-[var(--text-faint)]" />
                  </div>
                )
              )}
            </div>
          ) : null}
          {message.content && (
            <div className="rounded-2xl rounded-br-md bg-[var(--accent)] px-3.5 py-2 text-sm text-[var(--accent-contrast)]">
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Assistant message: parse import blocks
  const content = message.content;
  const importBlocks = parseImportBlocks(content);

  // Split content around import blocks for rendering
  const segments = renderContentWithBlocks(content, importBlocks);

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%]">
        <div className="space-y-2">
          {segments.map((segment, i) => {
            if (segment.type === 'text') {
              return segment.content ? (
                <div key={i} className="rounded-2xl rounded-bl-md bg-[var(--surface-muted)] px-3.5 py-2 text-sm text-[var(--text-primary)]">
                  <div className="whitespace-pre-wrap">{segment.content}</div>
                </div>
              ) : null;
            }

            if (segment.type === 'import') {
              const block = segment.block!;
              const blockKey = `${block.type}-${block.raw.slice(0, 50)}`;
              const isImported = importedBlocks.has(blockKey);

              return (
                <ImportCard
                  key={i}
                  block={block}
                  blockKey={blockKey}
                  isImported={isImported}
                  onImport={onImport}
                />
              );
            }

            if (segment.type === 'csv') {
              return <CSVDownloadCard key={i} content={segment.content} />;
            }

            return null;
          })}
          {isStreaming && (
            <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
          )}
        </div>
      </div>
    </div>
  );
}

type Segment =
  | { type: 'text'; content: string }
  | { type: 'import'; block: ImportBlock; content: string }
  | { type: 'csv'; content: string };

function renderContentWithBlocks(content: string, importBlocks: ImportBlock[]): Segment[] {
  const segments: Segment[] = [];

  // Find all fenced code blocks
  const blockRegex = /```(import:(?:tasks|deadlines|delete-tasks|subtasks:[^\n]*)|csv)\n([\s\S]*?)```/g;
  let match;
  let lastIndex = 0;

  const allMatches: { start: number; end: number; lang: string; body: string }[] = [];
  while ((match = blockRegex.exec(content)) !== null) {
    allMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      lang: match[1],
      body: match[2].trim(),
    });
  }

  if (allMatches.length === 0) {
    return [{ type: 'text', content: content.trim() }];
  }

  let importIdx = 0;
  for (const m of allMatches) {
    const before = content.slice(lastIndex, m.start).trim();
    if (before) segments.push({ type: 'text', content: before });

    if (m.lang.startsWith('import:')) {
      const block = importBlocks[importIdx++];
      if (block) {
        segments.push({ type: 'import', block, content: m.body });
      }
    } else if (m.lang === 'csv') {
      segments.push({ type: 'csv', content: m.body });
    }

    lastIndex = m.end;
  }

  const after = content.slice(lastIndex).trim();
  if (after) segments.push({ type: 'text', content: after });

  return segments;
}

// --- Import Card ---
function ImportCard({
  block,
  blockKey,
  isImported,
  onImport,
}: {
  block: ImportBlock;
  blockKey: string;
  isImported: boolean;
  onImport: (block: ImportBlock, key: string) => Promise<number>;
}) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleConfirmImport = async () => {
    setImporting(true);
    setDeleteError(null);
    try {
      const count = await onImport(block, blockKey);
      setResult(count);
      setConfirmingDelete(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  const handleClick = async () => {
    if (block.type === 'delete-tasks') {
      setExpanded(true);
      setDeleteError(null);
      setConfirmingDelete(true);
      return;
    }

    await handleConfirmImport();
  };

  const label = block.type === 'delete-tasks' ? 'tasks to delete' : block.type === 'subtasks' ? 'subtasks' : block.type === 'tasks' ? 'tasks' : 'deadlines';
  const isDelete = block.type === 'delete-tasks';
  const done = isImported || result !== null;
  const deletePreview = block.rows.slice(0, 3).map(r => r.title).join(', ');

  return (
    <div className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/30 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {done ? (
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20">
              <Check size={14} className="text-emerald-400" />
            </div>
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
              <Sparkles size={14} className="text-[var(--accent)]" />
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {done
                ? (isDelete ? `Deleted ${result ?? block.rows.length} tasks` : `Imported ${result ?? block.rows.length} ${label}`)
                : `${block.rows.length} ${label} ready`}
            </p>
            <p className="text-[10px] text-[var(--text-faint)]">
              {block.rows.slice(0, 3).map(r => r.title).join(', ')}
              {block.rows.length > 3 ? ` +${block.rows.length - 3} more` : ''}
            </p>
          </div>
        </div>
        {!done && (
          <button
            onClick={handleClick}
            disabled={importing}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-60',
              isDelete
                ? 'bg-rose-500 text-white'
                : 'text-[var(--accent-contrast)]'
            )}
            style={isDelete ? undefined : { backgroundColor: 'var(--accent-strong)' }}
          >
            {importing ? (isDelete ? 'Deleting...' : 'Importing...') : (isDelete ? 'Review delete' : 'Import')}
          </button>
        )}
      </div>

      {!done && isDelete && confirmingDelete && (
        <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-3">
          <p className="text-xs font-medium text-rose-300">Confirm delete</p>
          <p className="mt-1 text-[11px] leading-relaxed text-rose-200/85">
            This will permanently delete the uniquely matched tasks in this list. Ambiguous or missing titles will be skipped.
            {deletePreview ? ` Review: ${deletePreview}${block.rows.length > 3 ? ` +${block.rows.length - 3} more` : ''}.` : ''}
          </p>
          {deleteError && (
            <p className="mt-2 text-[11px] font-medium text-rose-300">{deleteError}</p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setConfirmingDelete(false)}
              className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface)]"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmImport}
              disabled={importing}
              className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              {importing ? 'Deleting...' : 'Confirm Delete'}
            </button>
          </div>
        </div>
      )}

      {/* Expandable preview */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-2 flex items-center gap-1 text-[10px] text-[var(--text-faint)] hover:text-[var(--text-muted)]"
      >
        <ChevronDown size={12} className={cn('transition', expanded && 'rotate-180')} />
        {expanded ? 'Hide' : 'Preview'}
      </button>
      {expanded && (
        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
          {block.rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg bg-[var(--surface)] px-2 py-1 text-[11px]">
              <span className="font-medium text-[var(--text-primary)]">{row.title}</span>
              {row.course && <span className="text-[var(--text-faint)]">[{row.course}]</span>}
              {row.dueDate && <span className="ml-auto text-[var(--text-faint)]">{row.dueDate}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- CSV Download Card ---
function CSVDownloadCard({ content }: { content: string }) {
  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `taskflow-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lines = content.split('\n').filter(l => l.trim());
  const rowCount = Math.max(0, lines.length - 1); // minus header

  return (
    <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">CSV File</p>
          <p className="text-[10px] text-[var(--text-faint)]">{rowCount} rows · Ready to download</p>
        </div>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <Download size={12} />
          Download
        </button>
      </div>
      <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-[var(--surface)] p-2 text-[10px] text-[var(--text-muted)]">
        {content.slice(0, 500)}{content.length > 500 ? '...' : ''}
      </pre>
    </div>
  );
}
