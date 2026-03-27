import { useState, useRef, useEffect, useCallback, useMemo, Component, type ReactNode } from 'react';
import { X, Send, Sparkles, Square, Trash2, Key, Check, AlertCircle, Download, ChevronDown, ImagePlus, Plus, Pencil, Search, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useAI, getAPIKey, setAPIKey, removeAPIKey, parseImportBlocks, type ChatMessage, type ImportBlock, type ImageAttachment, type ChatThread } from '../hooks/useAI';
import type { Task, Deadline, Project, WorkoutPlan, WorkoutDayTemplate, Exercise, WorkoutDayExercise, Priority, DeadlineType, DeadlineStatus } from '../types';
import type { Recurrence } from '../types';
import { cn } from '../utils/cn';

/* Error boundary — prevents the entire app from crashing if AI panel rendering fails */
class AIPanelErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: '' };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-8 text-center">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Something went wrong</p>
            <p className="mt-1 text-xs text-[var(--text-faint)]">{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: '' })}
              className="mt-3 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
              style={{ backgroundColor: 'var(--accent-strong)' }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface PanelFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

type PanelInteraction =
  | {
      type: 'move' | 'resize';
      startX: number;
      startY: number;
      initial: PanelFrame;
    }
  | null;

const PANEL_FRAME_STORAGE = 'taskflow_ai_panel_frame';
const CHAT_SIDEBAR_WIDTH_STORAGE = 'taskflow_ai_sidebar_width';
const CHAT_SIDEBAR_COLLAPSED_STORAGE = 'taskflow_ai_sidebar_collapsed';
const DEFAULT_PANEL_FRAME: PanelFrame = {
  x: 0,
  y: 88,
  width: 920,
  height: 760,
};
const DEFAULT_CHAT_SIDEBAR_WIDTH = 184;
const DEFAULT_CHAT_SIDEBAR_COLLAPSED = false;

function clampPanelFrame(frame: PanelFrame): PanelFrame {
  if (typeof window === 'undefined') return frame;

  const minWidth = Math.min(640, window.innerWidth - 32);
  const minHeight = Math.min(520, window.innerHeight - 32);
  const width = Math.max(minWidth, Math.min(frame.width, window.innerWidth - 24));
  const height = Math.max(minHeight, Math.min(frame.height, window.innerHeight - 24));
  const maxX = Math.max(12, window.innerWidth - width - 12);
  const maxY = Math.max(12, window.innerHeight - height - 12);

  return {
    width,
    height,
    x: Math.max(12, Math.min(frame.x, maxX)),
    y: Math.max(12, Math.min(frame.y, maxY)),
  };
}

function loadSavedPanelFrame(): PanelFrame {
  if (typeof window === 'undefined') return DEFAULT_PANEL_FRAME;

  try {
    const saved = localStorage.getItem(PANEL_FRAME_STORAGE);
    if (!saved) {
      const width = Math.min(DEFAULT_PANEL_FRAME.width, window.innerWidth - 24);
      return clampPanelFrame({
        ...DEFAULT_PANEL_FRAME,
        x: Math.max(12, window.innerWidth - width - 24),
        width,
        height: Math.min(DEFAULT_PANEL_FRAME.height, window.innerHeight - 24),
      });
    }

    const parsed = JSON.parse(saved) as Partial<PanelFrame>;
    return clampPanelFrame({
      x: typeof parsed.x === 'number' ? parsed.x : DEFAULT_PANEL_FRAME.x,
      y: typeof parsed.y === 'number' ? parsed.y : DEFAULT_PANEL_FRAME.y,
      width: typeof parsed.width === 'number' ? parsed.width : DEFAULT_PANEL_FRAME.width,
      height: typeof parsed.height === 'number' ? parsed.height : DEFAULT_PANEL_FRAME.height,
    });
  } catch {
    return clampPanelFrame(DEFAULT_PANEL_FRAME);
  }
}

function clampChatSidebarWidth(width: number) {
  if (typeof window === 'undefined') return width;
  const minWidth = 160;
  const maxWidth = Math.min(320, Math.max(160, Math.floor(window.innerWidth * 0.34)));
  return Math.max(minWidth, Math.min(width, maxWidth));
}

function loadSavedChatSidebarState() {
  if (typeof window === 'undefined') {
    return {
      width: DEFAULT_CHAT_SIDEBAR_WIDTH,
      collapsed: DEFAULT_CHAT_SIDEBAR_COLLAPSED,
    };
  }

  try {
    const savedWidth = localStorage.getItem(CHAT_SIDEBAR_WIDTH_STORAGE);
    const savedCollapsed = localStorage.getItem(CHAT_SIDEBAR_COLLAPSED_STORAGE);
    const width = clampChatSidebarWidth(
      savedWidth ? Number(savedWidth) || DEFAULT_CHAT_SIDEBAR_WIDTH : DEFAULT_CHAT_SIDEBAR_WIDTH
    );
    return {
      width,
      collapsed: savedCollapsed === null ? DEFAULT_CHAT_SIDEBAR_COLLAPSED : savedCollapsed === 'true',
    };
  } catch {
    return {
      width: DEFAULT_CHAT_SIDEBAR_WIDTH,
      collapsed: DEFAULT_CHAT_SIDEBAR_COLLAPSED,
    };
  }
}

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
  const initialSidebarState = useMemo(() => loadSavedChatSidebarState(), []);
  const [chatSidebarWidth, setChatSidebarWidth] = useState(initialSidebarState.width);
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(initialSidebarState.collapsed);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [showSidebarSearch, setShowSidebarSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [panelFrame, setPanelFrame] = useState<PanelFrame>(() => loadSavedPanelFrame());
  const [interaction, setInteraction] = useState<PanelInteraction>(null);
  const [sidebarInteraction, setSidebarInteraction] = useState<{
    startX: number;
    initialWidth: number;
  } | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recentAiTasksRef = useRef<Task[]>([]);

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

  useEffect(() => {
    if (!open) return;
    setPanelFrame(prev => clampPanelFrame(prev));
  }, [open]);

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_FRAME_STORAGE, JSON.stringify(panelFrame));
    } catch {
      // ignore storage errors
    }
  }, [panelFrame]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_SIDEBAR_WIDTH_STORAGE, String(chatSidebarWidth));
      localStorage.setItem(CHAT_SIDEBAR_COLLAPSED_STORAGE, String(chatSidebarCollapsed));
    } catch {
      // ignore storage errors
    }
  }, [chatSidebarWidth, chatSidebarCollapsed]);

  useEffect(() => {
    if (!interaction) return;

    const handleMove = (event: MouseEvent) => {
      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;

      if (interaction.type === 'move') {
        setPanelFrame(clampPanelFrame({
          ...interaction.initial,
          x: interaction.initial.x + deltaX,
          y: interaction.initial.y + deltaY,
        }));
        return;
      }

      setPanelFrame(clampPanelFrame({
        ...interaction.initial,
        width: interaction.initial.width + deltaX,
        height: interaction.initial.height + deltaY,
      }));
    };

    const handleUp = () => setInteraction(null);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = interaction.type === 'move' ? 'grabbing' : 'nwse-resize';

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [interaction]);

  useEffect(() => {
    if (!sidebarInteraction) return;

    const handleMove = (event: MouseEvent) => {
      const deltaX = event.clientX - sidebarInteraction.startX;
      setChatSidebarWidth(clampChatSidebarWidth(sidebarInteraction.initialWidth + deltaX));
      if (chatSidebarCollapsed) {
        setChatSidebarCollapsed(false);
      }
    };

    const handleUp = () => setSidebarInteraction(null);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [sidebarInteraction, chatSidebarCollapsed]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

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
    const availableTasks = [
      ...tasks,
      ...recentAiTasksRef.current.filter(recent => !tasks.some(task => task.id === recent.id)),
    ];

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
        const matches = matchTaskCandidates(availableTasks, row.title);
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

        const taskMatches = matchTaskCandidates(availableTasks, row.taskTitle ?? '');
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
      const parentTask = availableTasks.find(t => t.title.toLowerCase() === parentTitle);
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
        if (result) {
          imported++;
          recentAiTasksRef.current = [
            ...recentAiTasksRef.current,
            {
              id: result,
              title: row.title,
              description: row.description ?? '',
              status: 'todo',
              priority,
              projectId,
              createdAt: new Date().toISOString(),
              dueDate: row.dueDate ?? null,
              recurrence,
              subtasks: [],
              comments: [],
            },
          ];
        }
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

  const beginMove = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setInteraction({
      type: 'move',
      startX: event.clientX,
      startY: event.clientY,
      initial: panelFrame,
    });
  };

  const beginResize = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setInteraction({
      type: 'resize',
      startX: event.clientX,
      startY: event.clientY,
      initial: panelFrame,
    });
  };

  const beginSidebarResize = (event: React.MouseEvent) => {
    if (chatSidebarCollapsed || event.button !== 0) return;
    event.preventDefault();
    setSidebarInteraction({
      startX: event.clientX,
      initialWidth: chatSidebarWidth,
    });
  };

  const toggleChatSidebar = () => {
    setChatSidebarCollapsed(prev => !prev);
  };

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <div
        className="pointer-events-auto fixed flex min-h-0 flex-col overflow-hidden rounded-3xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl animate-in fade-in duration-200"
        onClick={e => e.stopPropagation()}
        style={{
          animationDuration: '200ms',
          left: panelFrame.x,
          top: panelFrame.y,
          width: panelFrame.width,
          height: panelFrame.height,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
          <div
            className="flex flex-1 cursor-grab items-center gap-2 active:cursor-grabbing"
            onMouseDown={beginMove}
          >
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

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Chat list */}
          <aside
            className={cn(
              'relative flex min-h-0 shrink-0 flex-col border-b border-[var(--border-soft)] bg-[var(--surface-muted)]/40 md:border-b-0 md:border-r',
              chatSidebarCollapsed ? 'overflow-hidden' : 'overflow-visible',
            )}
            style={{
              width: chatSidebarCollapsed ? 44 : chatSidebarWidth,
              minWidth: chatSidebarCollapsed ? 44 : chatSidebarWidth,
              maxWidth: chatSidebarCollapsed ? 44 : chatSidebarWidth,
            }}
          >
            {/* Top: Collapse toggle */}
            <div className="px-1.5 pt-2 pb-0.5">
              {chatSidebarCollapsed ? (
                <button
                  onClick={toggleChatSidebar}
                  className="flex h-8 w-full items-center justify-center rounded-lg text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
                  title="Expand sidebar"
                >
                  <PanelLeftOpen size={16} />
                </button>
              ) : (
                <button
                  onClick={toggleChatSidebar}
                  className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-xs text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
                >
                  <PanelLeftClose size={16} className="shrink-0" />
                  <span>Collapse</span>
                </button>
              )}
            </div>

            {/* Actions: New session + Search */}
            <div className="flex flex-col gap-0.5 px-1.5 pb-1">
              {chatSidebarCollapsed ? (
                <>
                  <button
                    onClick={handleCreateChat}
                    className="flex h-8 w-full items-center justify-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)]"
                    title="New session"
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    onClick={() => { toggleChatSidebar(); setShowSidebarSearch(true); requestAnimationFrame(() => searchInputRef.current?.focus()); }}
                    className="flex h-8 w-full items-center justify-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)]"
                    title="Search chats"
                  >
                    <Search size={16} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleCreateChat}
                    className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)]"
                  >
                    <Plus size={16} className="shrink-0" />
                    <span>New session</span>
                  </button>
                  <button
                    onClick={() => { setShowSidebarSearch(s => !s); setSidebarSearch(''); requestAnimationFrame(() => searchInputRef.current?.focus()); }}
                    className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)]"
                  >
                    <Search size={16} className="shrink-0" />
                    <span>Search</span>
                  </button>
                </>
              )}
            </div>

            {/* Search input (expanded only) */}
            {!chatSidebarCollapsed && showSidebarSearch && (
              <div className="px-2 pb-1.5">
                <input
                  ref={searchInputRef}
                  value={sidebarSearch}
                  onChange={e => setSidebarSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { setShowSidebarSearch(false); setSidebarSearch(''); } }}
                  placeholder="Search chats..."
                  className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
            )}

            {/* Divider */}
            <div className="mx-2 border-t border-[var(--border-soft)]" />

            {/* Chat list */}
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
              {chatSidebarCollapsed ? (
                <div className="space-y-0.5">
                  {threads.map(chat => {
                    const active = chat.id === currentChatId;
                    return (
                      <button
                        key={chat.id}
                        onClick={() => {
                          stopStreaming();
                          selectChat(chat.id);
                          setPanelError(null);
                          cancelRenameChat();
                          setPendingDeleteChat(null);
                          requestAnimationFrame(() => inputRef.current?.focus());
                        }}
                        className={cn(
                          'flex h-8 w-full items-center justify-center rounded-lg text-[11px] font-medium transition',
                          active
                            ? 'bg-[var(--accent-soft)]/30 text-[var(--accent)]'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]',
                        )}
                        title={chat.title}
                      >
                        {chat.title.slice(0, 2)}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {(() => {
                    const q = sidebarSearch.toLowerCase().trim();
                    const filtered = q ? threads.filter(c => c.title.toLowerCase().includes(q) || c.messages.some(m => m.content.toLowerCase().includes(q))) : threads;
                    if (q && filtered.length === 0) {
                      return <p className="px-2 py-3 text-center text-[11px] text-[var(--text-faint)]">No chats found</p>;
                    }
                    return filtered.map(chat => {
                    const active = chat.id === currentChatId;
                    const isEditing = editingChatId === chat.id;
                    return (
                      <div key={chat.id}>
                        {isEditing ? (
                          <div className="flex items-center gap-1 px-1 py-1">
                            <input
                              value={editingChatTitle}
                              onChange={e => setEditingChatTitle(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') commitRenameChat();
                                if (e.key === 'Escape') cancelRenameChat();
                              }}
                              autoFocus
                              className="min-w-0 flex-1 rounded-md border border-[var(--border-soft)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                            />
                            <button onClick={commitRenameChat} className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">OK</button>
                          </div>
                        ) : (
                          <div
                            onClick={() => {
                              stopStreaming();
                              selectChat(chat.id);
                              setPanelError(null);
                              cancelRenameChat();
                              setPendingDeleteChat(null);
                              setSidebarSearch('');
                              setShowSidebarSearch(false);
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
                                setSidebarSearch('');
                                setShowSidebarSearch(false);
                                requestAnimationFrame(() => inputRef.current?.focus());
                              }
                            }}
                            className={cn(
                              'group flex w-full cursor-pointer items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-left transition',
                              active
                                ? 'bg-[var(--accent-soft)]/30 text-[var(--accent)]'
                                : 'text-[var(--text-primary)] hover:bg-[var(--surface-muted)]',
                            )}
                          >
                            <p className="truncate text-xs">{chat.title}</p>
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                              <button
                                onClick={e => { e.stopPropagation(); startRenameChat(chat); }}
                                className="rounded p-0.5 text-[var(--text-faint)] hover:text-[var(--text-primary)]"
                                title="Rename"
                              >
                                <Pencil size={10} />
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); setPendingDeleteChat(chat); }}
                                className="rounded p-0.5 text-[var(--text-faint)] hover:text-rose-400"
                                title="Delete"
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  });
                  })()}
                </div>
              )}
            </div>

            {/* Bottom branding — aligned with input bar */}
            <div className="border-t border-[var(--border-soft)] px-3 py-3">
              {chatSidebarCollapsed ? (
                <div className="flex items-center justify-center" title="AI Assistant · Powered by Gemini">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ backgroundImage: 'var(--sidebar-gradient)' }}>
                    <Sparkles size={13} className="text-white" />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ backgroundImage: 'var(--sidebar-gradient)' }}>
                    <Sparkles size={13} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-[var(--text-primary)]">AI Assistant</p>
                    <p className="truncate text-[10px] text-[var(--text-faint)]">Powered by Gemini</p>
                  </div>
                </div>
              )}
            </div>

            {!chatSidebarCollapsed && (
              <button
                onMouseDown={beginSidebarResize}
                className="absolute inset-y-0 right-0 w-1 cursor-col-resize bg-transparent hover:bg-[var(--accent)]/20"
                aria-label="Resize chat sidebar"
                title="Drag to resize"
              />
            )}
          </aside>

          {/* Chat area */}
          <section className="min-w-0 flex-1 flex min-h-0 flex-col">
            {/* Messages */}
            <div key={currentChatId} ref={messagesScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <AIPanelErrorBoundary>
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
              </AIPanelErrorBoundary>
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
        <button
          type="button"
          aria-label="Resize AI panel"
          title="Resize"
          className="absolute bottom-1 right-1 z-[75] flex h-8 w-8 cursor-nwse-resize items-end justify-end rounded-full text-[var(--text-faint)] transition hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
          onMouseDown={beginResize}
        >
          <span className="pointer-events-none relative mb-1 mr-1 block h-3 w-3">
            <span className="absolute bottom-0 right-0 h-px w-3 rotate-45 bg-current opacity-80" />
            <span className="absolute bottom-1 right-0 h-px w-2 rotate-45 bg-current opacity-60" />
            <span className="absolute bottom-0 right-1 h-px w-2 rotate-45 bg-current opacity-45" />
          </span>
        </button>
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

  // Assistant message: parse import blocks safely
  const content = message.content;
  let importBlocks: ImportBlock[] = [];
  let segments: Segment[] = [];
  try {
    importBlocks = parseImportBlocks(content);
    segments = renderContentWithBlocks(content, importBlocks);
  } catch {
    // If parsing crashes, just show raw text
    segments = [{ type: 'text', content: content.trim() }];
    importBlocks = [];
  }

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
              return null;
            }

            if (segment.type === 'csv') {
              return <CSVDownloadCard key={i} content={segment.content} />;
            }

            return null;
          })}
          {!isStreaming && importBlocks.length > 0 && (
            <ActionBundleCard
              messageId={message.id}
              blocks={importBlocks}
              tasks={tasks}
              deadlines={deadlines}
              projects={projects}
              importedBlocks={importedBlocks}
              onImport={onImport}
            />
          )}
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

function ActionBundleCard({
  messageId,
  blocks,
  tasks,
  deadlines,
  projects,
  importedBlocks,
  onImport,
}: {
  messageId: string;
  blocks: ImportBlock[];
  tasks: Task[];
  deadlines: Deadline[];
  projects: Project[];
  importedBlocks: Set<string>;
  onImport: (block: ImportBlock, key: string) => Promise<number>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, number>>({});

  const entries = useMemo(() => (
    blocks.map((block, index) => ({
      block,
      key: `${messageId}:block:${index}`,
      imported: importedBlocks.has(`${messageId}:block:${index}`),
      order:
        block.type === 'tasks' ? 0 :
        block.type === 'deadlines' ? 1 :
        block.type === 'subtasks' ? 2 :
        block.type === 'deadline-links' ? 3 : 4,
    }))
  ), [blocks, importedBlocks, messageId]);

  const pendingEntries = entries.filter(entry => !entry.imported);
  const hasDeletes = entries.some(entry => entry.block.type === 'delete-tasks');
  const allDone = entries.every(entry => entry.imported);

  const summary = useMemo(() => {
    const counts = {
      tasks: 0,
      deadlines: 0,
      subtasks: 0,
      links: 0,
      deletes: 0,
    };

    for (const { block } of blocks) {
      if (block.type === 'tasks') counts.tasks += block.rows.length;
      if (block.type === 'deadlines') counts.deadlines += block.rows.length;
      if (block.type === 'subtasks') counts.subtasks += block.rows.length;
      if (block.type === 'deadline-links') counts.links += block.rows.length;
      if (block.type === 'delete-tasks') counts.deletes += block.rows.length;
    }

    return counts;
  }, [blocks]);

  const linkGroups = useMemo(() => {
    return blocks
      .filter(block => block.type === 'deadline-links')
      .flatMap(block =>
        block.rows.map(row => {
          const taskMatches = matchTaskCandidates(tasks, row.taskTitle ?? '');
          const deadlineMatches = matchDeadlineCandidates(deadlines, projects, row.title, row.course);
          const valid = taskMatches.length === 1 && deadlineMatches.length === 1;
          return {
            label: `${row.taskTitle ?? 'Unknown task'} → ${row.title}`,
            valid,
            reason: valid
              ? ''
              : [
                  deadlineMatches.length !== 1 ? (deadlineMatches.length === 0 ? 'deadline not found' : 'deadline ambiguous') : null,
                  taskMatches.length !== 1 ? (taskMatches.length === 0 ? 'task not found' : 'task ambiguous') : null,
                ].filter(Boolean).join(', '),
          };
        }),
      );
  }, [blocks, deadlines, projects, tasks]);

  const deleteGroups = useMemo(() => {
    return blocks
      .filter(block => block.type === 'delete-tasks')
      .flatMap(block =>
        block.rows.map(row => {
          const matches = matchTaskCandidates(tasks, row.title);
          return {
            label: row.title,
            valid: matches.length === 1,
            resolvedTitle: matches.length === 1 ? matches[0].title : row.title,
          };
        }),
      );
  }, [blocks, tasks]);

  const resultSummary = useMemo(() => {
    const total = Object.values(results).reduce((sum, count) => sum + count, 0);
    return total;
  }, [results]);

  const handleApply = async () => {
    if (hasDeletes && !confirmDelete) {
      setExpanded(true);
      setConfirmDelete(true);
      return;
    }

    setApplying(true);
    setActionError(null);
    const nextResults: Record<string, number> = {};

    try {
      for (const entry of [...pendingEntries].sort((a, b) => a.order - b.order)) {
        const count = await onImport(entry.block, entry.key);
        nextResults[entry.key] = count;
      }
      setResults(prev => ({ ...prev, ...nextResults }));
      setConfirmDelete(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not apply these actions.');
    } finally {
      setApplying(false);
    }
  };

  const primaryLabel = allDone
    ? 'Applied'
    : hasDeletes
      ? (confirmDelete ? 'Approve actions' : 'Review actions')
      : 'Add';

  return (
    <div className="rounded-2xl border border-[var(--accent)]/28 bg-[var(--accent-soft)]/25 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg',
              allDone ? 'bg-emerald-500/20' : 'bg-[var(--accent-soft)]',
            )}>
              {allDone ? <Check size={14} className="text-emerald-400" /> : <Sparkles size={14} className="text-[var(--accent)]" />}
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {allDone ? `Applied ${resultSummary} changes` : 'Ready to apply'}
              </p>
              <p className="text-[11px] text-[var(--text-faint)]">
                {[summary.tasks ? `${summary.tasks} task${summary.tasks === 1 ? '' : 's'}` : null,
                  summary.deadlines ? `${summary.deadlines} deadline${summary.deadlines === 1 ? '' : 's'}` : null,
                  summary.subtasks ? `${summary.subtasks} subtask${summary.subtasks === 1 ? '' : 's'}` : null,
                  summary.links ? `${summary.links} link${summary.links === 1 ? '' : 's'}` : null,
                  summary.deletes ? `${summary.deletes} delete${summary.deletes === 1 ? '' : 's'}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </div>
        </div>
        {!allDone && (
          <button
            onClick={handleApply}
            disabled={applying}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-60',
              hasDeletes && confirmDelete
                ? 'bg-rose-500 text-white'
                : 'text-[var(--accent-contrast)]',
            )}
            style={hasDeletes && confirmDelete ? undefined : { backgroundColor: 'var(--accent-strong)' }}
          >
            {applying ? 'Applying...' : primaryLabel}
          </button>
        )}
      </div>

      {actionError && (
        <p className="mt-3 text-[11px] font-medium text-rose-300">{actionError}</p>
      )}

      {hasDeletes && confirmDelete && !allDone && (
        <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-3">
          <p className="text-xs font-medium text-rose-300">Approve delete actions</p>
          <p className="mt-1 text-[11px] leading-relaxed text-rose-200/85">
            This response includes deletions. We’ll only delete exact task matches and skip anything ambiguous.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={applying}
              className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              {applying ? 'Applying...' : 'Approve actions'}
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setExpanded(prev => !prev)}
        className="mt-2 flex items-center gap-1 text-[10px] text-[var(--text-faint)] hover:text-[var(--text-muted)]"
      >
        <ChevronDown size={12} className={cn('transition', expanded && 'rotate-180')} />
        {expanded ? 'Hide details' : 'Preview'}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {summary.tasks > 0 && (
            <ActionSection
              label="Tasks"
              tone="default"
              items={blocks.filter(block => block.type === 'tasks').flatMap(block => block.rows.map(row => row.title))}
            />
          )}
          {summary.subtasks > 0 && (
            <ActionSection
              label="Subtasks"
              tone="default"
              items={blocks.filter(block => block.type === 'subtasks').flatMap(block => block.rows.map(row => row.title))}
            />
          )}
          {summary.deadlines > 0 && (
            <ActionSection
              label="Deadlines"
              tone="default"
              items={blocks.filter(block => block.type === 'deadlines').flatMap(block => block.rows.map(row => row.title))}
            />
          )}
          {summary.links > 0 && (
            <ActionSection
              label="Links"
              tone="success"
              items={linkGroups.map(group => group.valid ? group.label : `${group.label} · ${group.reason}`)}
            />
          )}
          {summary.deletes > 0 && (
            <ActionSection
              label="Deletes"
              tone="warning"
              items={deleteGroups.map(group => group.valid ? group.resolvedTitle : `${group.label} · ambiguous`)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ActionSection({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: 'default' | 'success' | 'warning';
}) {
  const toneClasses =
    tone === 'success'
      ? 'border-emerald-500/15 bg-emerald-500/8'
      : tone === 'warning'
        ? 'border-amber-500/20 bg-amber-500/10'
        : 'border-[var(--border-soft)] bg-[var(--surface)]/80';

  return (
    <div className={cn('rounded-xl border px-3 py-3', toneClasses)}>
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-faint)]">{label}</p>
      <div className="mt-2 space-y-1.5 text-[11px] text-[var(--text-primary)]">
        {items.slice(0, 6).map(item => (
          <p key={item}>{item}</p>
        ))}
        {items.length > 6 && (
          <p className="text-[var(--text-faint)]">+{items.length - 6} more</p>
        )}
      </div>
    </div>
  );
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
