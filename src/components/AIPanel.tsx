import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, Send, Sparkles, Square, Trash2, Key, Check, AlertCircle, Download, ChevronDown, ImagePlus, Plus, Pencil } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useAI, getAPIKey, setAPIKey, removeAPIKey, parseImportBlocks, type ChatMessage, type ImportBlock, type ImageAttachment, type ChatThread } from '../hooks/useAI';
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
  onLinkTask: (deadlineId: string, taskId: string) => Promise<boolean>;
}

export function AIPanel({
  open, onClose,
  tasks, deadlines, projects, plans, dayTemplates, exercises, dayExercises,
  onAddTask, onAddDeadline, onAddProject, onAddSubtask, onDeleteTask, onLinkTask,
}: AIPanelProps) {
  const {
    threads,
    currentChat,
    currentChatId,
    messages,
    isStreaming,
    error,
    sendMessage,
    stopStreaming,
    createChat,
    selectChat,
    renameChat,
    deleteChat,
  } = useAI();
  const [panelError, setPanelError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [apiKey, setApiKey] = useState(getAPIKey() ?? '');
  const [hasKey, setHasKey] = useState(!!getAPIKey());
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [importedBlocks, setImportedBlocks] = useState<Set<string>>(new Set());
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingChatTitle, setEditingChatTitle] = useState('');
  const [pendingDeleteChat, setPendingDeleteChat] = useState<ChatThread | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => scrollToBottom('auto'));
    return () => cancelAnimationFrame(frame);
  }, [open, currentChatId, messages.length, scrollToBottom]);

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
    setPanelError(null);
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
        setPanelError('Image too large (max 4MB). Try a smaller image or screenshot.');
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

  const startRenameChat = (chat: ChatThread) => {
    setEditingChatId(chat.id);
    setEditingChatTitle(chat.title);
  };

  const commitRenameChat = () => {
    if (!editingChatId) return;
    const nextTitle = editingChatTitle.trim();
    if (!nextTitle) return;
    renameChat(editingChatId, nextTitle);
    setEditingChatId(null);
    setEditingChatTitle('');
  };

  const cancelRenameChat = () => {
    setEditingChatId(null);
    setEditingChatTitle('');
  };

  const confirmDeleteChat = () => {
    if (!pendingDeleteChat) return;
    stopStreaming();
    deleteChat(pendingDeleteChat.id);
    setPendingDeleteChat(null);
  };

  const handleImport = async (block: ImportBlock, blockKey: string) => {
    setPanelError(null);
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
        const matches = matchTaskCandidates(tasks, row.title);
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
        setPanelError(
          skipped === 1
            ? 'Skipped 1 AI delete entry because it was ambiguous, missing, or failed to delete.'
            : `Skipped ${skipped} AI delete entries because they were ambiguous, missing, or failed to delete.`,
        );
      }
    } else if (block.type === 'deadline-links') {
      let linked = 0;
      let skipped = 0;

      for (const row of block.rows) {
        const taskTitle = normalizeDeleteCandidate(row.taskTitle ?? '');
        const deadlineTitle = normalizeDeleteCandidate(row.title);
        if (!taskTitle || !deadlineTitle) {
          skipped++;
          continue;
        }

        const taskMatches = matchTaskCandidates(tasks, row.taskTitle ?? '');
        const deadlineMatches = matchDeadlineCandidates(deadlines, projects, row.title, row.course);

        if (taskMatches.length !== 1 || deadlineMatches.length !== 1) {
          skipped++;
          continue;
        }

        const ok = await onLinkTask(deadlineMatches[0].id, taskMatches[0].id);
        if (ok) linked++;
        else skipped++;
      }

      imported = linked;
      if (skipped > 0) {
        setPanelError(
          skipped === 1
            ? 'Skipped 1 deadline link because it was ambiguous, missing, or failed to link.'
            : `Skipped ${skipped} deadline links because they were ambiguous, missing, or failed to link.`,
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

  const handleCreateChat = () => {
    setPanelError(null);
    setEditingChatId(null);
    setEditingChatTitle('');
    setPendingDeleteChat(null);
    stopStreaming();
    createChat();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      scrollToBottom('auto');
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end" onClick={onClose}>
      <div
        className="relative flex h-full min-h-0 w-[min(100vw,1180px)] flex-col overflow-hidden border-l border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl animate-in slide-in-from-right duration-200"
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
              <p className="text-[10px] text-[var(--text-faint)]">Powered by Gemini · {currentChat.title}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCreateChat}
              className="rounded-lg p-1.5 text-[var(--text-faint)] transition hover:text-[var(--text-primary)]"
              title="New chat"
            >
              <Plus size={14} />
            </button>
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
            <button
              onClick={() => setPendingDeleteChat(currentChat)}
              className="rounded-lg p-1.5 text-[var(--text-faint)] transition hover:text-[var(--text-primary)]"
              title="Delete chat"
            >
              <Trash2 size={14} />
            </button>
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

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[292px_minmax(0,1fr)]">
          {/* Chat list */}
          <aside className="flex min-h-0 flex-col border-b border-[var(--border-soft)] bg-[var(--surface-muted)]/40 md:border-b-0 md:border-r">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-soft)] px-4 py-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-faint)]">Chats</p>
                <p className="text-xs text-[var(--text-muted)]">{threads.length} conversation{threads.length === 1 ? '' : 's'}</p>
              </div>
              <button
                onClick={handleCreateChat}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Plus size={12} />
                New
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="space-y-2">
                {threads.map(chat => {
                  const active = chat.id === currentChatId;
                  const isEditing = editingChatId === chat.id;
                  return (
                    <div
                      key={chat.id}
                      className={cn(
                        'group rounded-2xl border transition',
                        active
                          ? 'border-[var(--accent)]/35 bg-[var(--accent-soft)]/30'
                          : 'border-transparent hover:border-[var(--border-soft)] hover:bg-[var(--surface)]',
                      )}
                    >
                      {isEditing ? (
                        <div className="space-y-2 p-3">
                          <input
                            value={editingChatTitle}
                            onChange={e => setEditingChatTitle(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitRenameChat();
                              if (e.key === 'Escape') cancelRenameChat();
                            }}
                            autoFocus
                            className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={cancelRenameChat}
                              className="rounded-lg border border-[var(--border-soft)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={commitRenameChat}
                              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--accent-contrast)]"
                              style={{ backgroundColor: 'var(--accent-strong)' }}
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => {
                            stopStreaming();
                            selectChat(chat.id);
                            setPanelError(null);
                            cancelRenameChat();
                            setPendingDeleteChat(null);
                            requestAnimationFrame(() => inputRef.current?.focus());
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              stopStreaming();
                              selectChat(chat.id);
                              setPanelError(null);
                              cancelRenameChat();
                              setPendingDeleteChat(null);
                              requestAnimationFrame(() => inputRef.current?.focus());
                            }
                          }}
                          className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[var(--text-primary)]">{chat.title}</p>
                            <p className="mt-0.5 text-[10px] text-[var(--text-faint)]">
                              {chat.messages.length} message{chat.messages.length === 1 ? '' : 's'} · {new Date(chat.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                startRenameChat(chat);
                              }}
                              className="rounded-lg p-1 text-[var(--text-faint)] transition hover:text-[var(--text-primary)]"
                              title="Rename chat"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                setPendingDeleteChat(chat);
                              }}
                              className="rounded-lg p-1 text-[var(--text-faint)] transition hover:text-[var(--text-primary)]"
                              title="Delete chat"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* Chat area */}
          <section className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-faint)]">Current chat</p>
                <p className="text-sm font-medium text-[var(--text-primary)]">{currentChat.title}</p>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-[var(--text-faint)]">
                <span>{messages.length} message{messages.length === 1 ? '' : 's'}</span>
              </div>
            </div>

            {/* Messages */}
            <div ref={messagesScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {messages.length === 0 ? (
                <WelcomeScreen hasKey={hasKey} />
              ) : (
                <div className="space-y-4">
                  {messages.map(msg => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      tasks={tasks}
                      deadlines={deadlines}
                      projects={projects}
                      importedBlocks={importedBlocks}
                      onImport={handleImport}
                      isStreaming={isStreaming && msg === messages[messages.length - 1] && msg.role === 'assistant'}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Error */}
            {(panelError || error) && (
              <div className="mx-4 mb-2 flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{panelError ?? error}</span>
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
          </section>
        </div>

        {pendingDeleteChat && (
          <div
            className="absolute inset-0 z-[70] flex items-center justify-center bg-black/45 backdrop-blur-sm px-4"
            onClick={() => setPendingDeleteChat(null)}
          >
            <div
              className="w-full max-w-sm rounded-3xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-4 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <p className="text-sm font-semibold text-[var(--text-primary)]">Delete chat?</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                This will remove “{pendingDeleteChat.title}” and its message history. A new blank chat will be created if needed.
              </p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setPendingDeleteChat(null)}
                  className="rounded-xl border border-[var(--border-soft)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface)]"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteChat}
                  className="rounded-xl bg-rose-500 px-3 py-1.5 text-xs font-medium text-white"
                >
                  Delete chat
                </button>
              </div>
            </div>
          </div>
        )}
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

function normalizeDeleteCandidate(value: string) {
  return value.trim().toLowerCase();
}

function stripTrailingCourseTag(value: string) {
  return value.replace(/\s*\[[^\]]+\]\s*$/, '').trim();
}

function matchTaskCandidates(tasks: Task[], rawTitle: string) {
  const normalizedTitle = normalizeDeleteCandidate(rawTitle);
  const strippedTitle = normalizeDeleteCandidate(stripTrailingCourseTag(rawTitle));

  return tasks.filter(task => {
    const taskTitle = normalizeDeleteCandidate(task.title);
    const strippedTaskTitle = normalizeDeleteCandidate(stripTrailingCourseTag(task.title));
    return (
      taskTitle === normalizedTitle ||
      strippedTaskTitle === normalizedTitle ||
      taskTitle === strippedTitle ||
      strippedTaskTitle === strippedTitle
    );
  });
}

function matchDeadlineCandidates(deadlines: Deadline[], projects: Project[], rawTitle: string, course?: string) {
  const normalizedTitle = normalizeDeleteCandidate(rawTitle);
  const strippedTitle = normalizeDeleteCandidate(stripTrailingCourseTag(rawTitle));
  const normalizedCourse = course ? normalizeDeleteCandidate(course) : '';

  return deadlines.filter(deadline => {
    const deadlineTitle = normalizeDeleteCandidate(deadline.title);
    const strippedDeadlineTitle = normalizeDeleteCandidate(stripTrailingCourseTag(deadline.title));
    if (
      deadlineTitle !== normalizedTitle &&
      strippedDeadlineTitle !== normalizedTitle &&
      deadlineTitle !== strippedTitle &&
      strippedDeadlineTitle !== strippedTitle
    ) {
      return false;
    }

    if (!course) return true;

    const projectName = deadline.projectId
      ? projects.find(project => project.id === deadline.projectId)?.name ?? ''
      : '';

    return normalizeDeleteCandidate(projectName) === normalizedCourse;
  });
}

// --- Message Bubble ---
function MessageBubble({
  message,
  tasks,
  deadlines,
  projects,
  importedBlocks,
  onImport,
  isStreaming,
}: {
  message: ChatMessage;
  tasks: Task[];
  deadlines: Deadline[];
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
              const blockKey = `${message.id}:${i}`;
              const isImported = importedBlocks.has(blockKey);

              return (
                <ImportCard
                  key={i}
                  block={block}
                  blockKey={blockKey}
                  isImported={isImported}
                  tasks={tasks}
                  deadlines={deadlines}
                  projects={projects}
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
  const blockRegex = /```(import:(?:tasks|deadlines|delete-tasks|deadline-links|subtasks:[^\n]*)|csv)\n([\s\S]*?)```/g;
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
  tasks,
  deadlines,
  projects,
  onImport,
}: {
  block: ImportBlock;
  blockKey: string;
  isImported: boolean;
  tasks: Task[];
  deadlines: Deadline[];
  projects: Project[];
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

  const label = block.type === 'delete-tasks'
    ? 'tasks to delete'
    : block.type === 'subtasks'
      ? 'subtasks'
      : block.type === 'tasks'
        ? 'tasks'
        : block.type === 'deadline-links'
          ? 'deadline links'
          : 'deadlines';
  const isDelete = block.type === 'delete-tasks';
  const isLink = block.type === 'deadline-links';
  const done = isImported || result !== null;
  const deleteGroups = useMemo(() => {
    if (!isDelete) return null;

    return block.rows.reduce(
      (acc, row) => {
        const matches = matchTaskCandidates(tasks, row.title);
        if (matches.length === 1) {
          acc.willDelete.push(matches[0].title);
        } else {
          acc.skipped.push(row.title);
        }
        return acc;
      },
      { willDelete: [] as string[], skipped: [] as string[] },
    );
  }, [block.rows, isDelete, tasks]);

  const linkGroups = useMemo(() => {
    if (!isLink) return null;

    return block.rows.reduce(
      (acc, row) => {
        const taskMatches = matchTaskCandidates(tasks, row.taskTitle ?? '');
        const deadlineMatches = matchDeadlineCandidates(deadlines, projects, row.title, row.course);

        if (taskMatches.length === 1 && deadlineMatches.length === 1) {
          acc.willLink.push({
            task: taskMatches[0].title,
            deadline: deadlineMatches[0].title,
          });
        } else {
          const reasons: string[] = [];
          if (deadlineMatches.length !== 1) {
            reasons.push(deadlineMatches.length === 0 ? 'deadline not found' : 'deadline ambiguous');
          }
          if (taskMatches.length !== 1) {
            reasons.push(taskMatches.length === 0 ? 'task not found' : 'task ambiguous');
          }
          acc.skipped.push({
            label: `${row.taskTitle ?? 'Unknown task'} → ${row.title}`,
            reason: reasons.join(', '),
          });
        }

        return acc;
      },
      {
        willLink: [] as Array<{ task: string; deadline: string }>,
        skipped: [] as Array<{ label: string; reason: string }>,
      },
    );
  }, [block.rows, deadlines, isLink, projects, tasks]);

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
                ? (isDelete
                    ? `Deleted ${result ?? block.rows.length} tasks`
                    : isLink
                      ? `Linked ${result ?? block.rows.length} task${(result ?? block.rows.length) === 1 ? '' : 's'}`
                      : `Imported ${result ?? block.rows.length} ${label}`)
                : `${block.rows.length} ${label} ready`}
            </p>
            {isDelete && deleteGroups ? (
              <div className="mt-1 space-y-1 text-[10px]">
                <p className="text-[var(--text-faint)]">
                  Will delete: {deleteGroups.willDelete.slice(0, 3).join(', ') || 'No exact matches'}
                  {deleteGroups.willDelete.length > 3 ? ` +${deleteGroups.willDelete.length - 3} more` : ''}
                </p>
                <p className="text-amber-300/90">
                  Skipped: {deleteGroups.skipped.slice(0, 3).join(', ') || 'None'}
                  {deleteGroups.skipped.length > 3 ? ` +${deleteGroups.skipped.length - 3} more` : ''}
                </p>
              </div>
            ) : isLink && linkGroups ? (
              <div className="mt-1 space-y-1 text-[10px]">
                <p className="text-[var(--text-faint)]">
                  Will link: {linkGroups.willLink.slice(0, 2).map(item => `${item.task} → ${item.deadline}`).join(', ') || 'No exact matches yet'}
                  {linkGroups.willLink.length > 2 ? ` +${linkGroups.willLink.length - 2} more` : ''}
                </p>
                <p className="text-amber-300/90">
                  Needs attention: {linkGroups.skipped.slice(0, 2).map(item => item.label).join(', ') || 'None'}
                  {linkGroups.skipped.length > 2 ? ` +${linkGroups.skipped.length - 2} more` : ''}
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-[var(--text-faint)]">
                {block.rows.slice(0, 3).map(r => r.title).join(', ')}
                {block.rows.length > 3 ? ` +${block.rows.length - 3} more` : ''}
              </p>
            )}
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
            {importing ? (isDelete ? 'Deleting...' : isLink ? 'Linking...' : 'Importing...') : (isDelete ? 'Review delete' : isLink ? 'Link tasks' : 'Import')}
          </button>
        )}
      </div>

      {!done && isDelete && confirmingDelete && (
        <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-3">
          <p className="text-xs font-medium text-rose-300">Confirm delete</p>
          <p className="mt-1 text-[11px] leading-relaxed text-rose-200/85">
            This will permanently delete only exact matches. Ambiguous or missing titles will be skipped.
          </p>
          {deleteGroups && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-rose-200/80">Will delete</p>
                <p className="mt-1 text-[11px] leading-relaxed text-rose-100">
                  {deleteGroups.willDelete.length > 0 ? deleteGroups.willDelete.slice(0, 5).join(', ') : 'No exact matches'}
                  {deleteGroups.willDelete.length > 5 ? ` +${deleteGroups.willDelete.length - 5} more` : ''}
                </p>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-amber-200/80">Skipped</p>
                <p className="mt-1 text-[11px] leading-relaxed text-amber-100/90">
                  {deleteGroups.skipped.length > 0 ? deleteGroups.skipped.slice(0, 5).join(', ') : 'None'}
                  {deleteGroups.skipped.length > 5 ? ` +${deleteGroups.skipped.length - 5} more` : ''}
                </p>
              </div>
            </div>
          )}
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

      {!done && isLink && linkGroups && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/8 px-3 py-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-emerald-300/85">Will link</p>
            <div className="mt-2 space-y-1.5 text-[11px] text-emerald-100">
              {linkGroups.willLink.length > 0 ? (
                linkGroups.willLink.slice(0, 5).map(item => (
                  <p key={`${item.task}:${item.deadline}`}>{item.task} → {item.deadline}</p>
                ))
              ) : (
                <p>No exact matches yet.</p>
              )}
              {linkGroups.willLink.length > 5 && (
                <p className="text-[var(--text-faint)]">+{linkGroups.willLink.length - 5} more</p>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-amber-200/80">Needs attention</p>
            <div className="mt-2 space-y-1.5 text-[11px] text-amber-100/90">
              {linkGroups.skipped.length > 0 ? (
                linkGroups.skipped.slice(0, 5).map(item => (
                  <p key={`${item.label}:${item.reason}`}>{item.label} · {item.reason}</p>
                ))
              ) : (
                <p>None</p>
              )}
              {linkGroups.skipped.length > 5 && (
                <p className="text-[var(--text-faint)]">+{linkGroups.skipped.length - 5} more</p>
              )}
            </div>
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
              <span className="font-medium text-[var(--text-primary)]">
                {isLink ? `${row.taskTitle ?? 'Unknown task'} → ${row.title}` : row.title}
              </span>
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
