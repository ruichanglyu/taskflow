import { useState, useRef, useEffect, useCallback, useMemo, Component, type ReactNode } from 'react';
import { Minus, Send, Sparkles, Square, Check, AlertCircle, Download, ImagePlus, Plus, Mic, MicOff, CopyPlus, FileSearch, CheckCircle2, ChevronDown, LayoutPanelLeft, PanelRightOpen, Wand2, Pencil, Trash2, X, CalendarDays, Upload } from 'lucide-react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useAI, getAPIKey, getAPIKeyCached, parseImportBlocks, type ChatMessage, type ImportBlock, type ParsedImportRow, type ImageAttachment, type ChatThread } from '../hooks/useAI';
import type { BehaviorLearningActionOptions } from '../hooks/useBehaviorLearning';
import type { Habit } from '../hooks/useHabits';
import type { Task, Deadline, Project, WorkoutPlan, WorkoutDayTemplate, Exercise, WorkoutDayExercise, Priority, DeadlineType, DeadlineStatus, DeadlineSource, TaskStatus } from '../types';
import type { Recurrence } from '../types';
import { cn } from '../utils/cn';
import type { GoogleCalendarEvent, GoogleCalendarListItem, NewGoogleCalendarEvent } from '../lib/googleCalendar';
import { isStudyBlockLikeEvent, normalizeCalendarSummary } from '../utils/studyBlockDetection';
import { getEventDateKey } from '../utils/calendarEventHelpers';
import { addDays, formatDateKey } from '../utils/dateHelpers';
import { buildAcademicPlanMetadataDescription, parseAcademicPlanMetadata } from '../lib/academicPlanning';

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
              className="mt-3 rounded-lg bg-[var(--accent-strong)] px-3 py-1.5 text-xs font-medium text-[var(--accent-contrast)]"
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

interface ImportExecutionOptions {
  frozenCalendarDeleteTargets?: Record<string, GoogleCalendarEvent[]>;
}

interface PendingSuggestionSnapshot {
  signature: string;
  blockCount: number;
  actionCount: number;
  blockTypes: string[];
}

interface StudySlotCandidate {
  startMinutes: number;
  endMinutes: number;
  score: number;
  distance: number;
}

interface SlotSearchResult {
  startMinutes: number;
  endMinutes: number;
  candidates: StudySlotCandidate[];
}

interface SlotResolutionResult {
  payload: NewGoogleCalendarEvent | null;
  adjusted: boolean;
  dateKey: string | null;
  requestedStartMinutes: number | null;
  durationMinutes: number | null;
  selectedStartMinutes: number | null;
  candidates: StudySlotCandidate[];
  exactTimeConflict?: boolean;
}

interface RecentCalendarTarget {
  id?: string;
  calendarId?: string;
  title: string;
  calendarSummary?: string;
  dateKey?: string;
  startKey?: string;
  updatedAt: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: {
    transcript: string;
  };
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
  onerror: ((this: SpeechRecognitionLike, ev: Event & { error?: string }) => void) | null;
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEventLike) => void) | null;
  start(): void;
  stop(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

const IMPORTED_BLOCKS_STORAGE_PREFIX = 'taskflow_ai_imported_blocks';
const RECENT_APPLIED_CALENDAR_ACTIONS_STORAGE_PREFIX = 'taskflow_ai_recent_calendar_actions';
const RECENT_LISTED_CALENDAR_EVENTS_STORAGE_PREFIX = 'taskflow_ai_recent_listed_calendar_events';
const RECENT_CALENDAR_TARGETS_STORAGE_PREFIX = 'taskflow_ai_recent_calendar_targets';
const AI_PERSONALITY_STORAGE_PREFIX = 'taskflow_ai_personality';

interface AIPersonality {
  name: string;
  badge: string;
}

function importedBlocksStorageKey(userId: string) {
  return `${IMPORTED_BLOCKS_STORAGE_PREFIX}:${userId}`;
}

function recentAppliedCalendarActionsStorageKey(userId: string) {
  return `${RECENT_APPLIED_CALENDAR_ACTIONS_STORAGE_PREFIX}:${userId}`;
}

function recentListedCalendarEventsStorageKey(userId: string) {
  return `${RECENT_LISTED_CALENDAR_EVENTS_STORAGE_PREFIX}:${userId}`;
}

function recentCalendarTargetsStorageKey(userId: string) {
  return `${RECENT_CALENDAR_TARGETS_STORAGE_PREFIX}:${userId}`;
}

function aiPersonalityStorageKey(userId: string) {
  return `${AI_PERSONALITY_STORAGE_PREFIX}:${userId}`;
}

function loadImportedBlocks(userId: string) {
  if (typeof window === 'undefined') return new Set<string>();

  try {
    const raw = localStorage.getItem(importedBlocksStorageKey(userId));
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set<string>();
  }
}

function loadRecentAppliedCalendarActions(userId: string) {
  if (typeof window === 'undefined') return [] as string[];
  try {
    const raw = localStorage.getItem(recentAppliedCalendarActionsStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecentAppliedCalendarActions(userId: string, entries: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      recentAppliedCalendarActionsStorageKey(userId),
      JSON.stringify(entries.slice(-40)),
    );
  } catch {
    // ignore storage failures
  }
}

function loadRecentListedCalendarEvents(userId: string) {
  if (typeof window === 'undefined') return [] as string[];
  try {
    const raw = localStorage.getItem(recentListedCalendarEventsStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecentListedCalendarEvents(userId: string, entries: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      recentListedCalendarEventsStorageKey(userId),
      JSON.stringify(entries.slice(-25)),
    );
  } catch {
    // ignore local storage quota errors
  }
}

function loadAIPersonality(userId: string): AIPersonality {
  if (typeof window === 'undefined') return { name: '', badge: '✨' };
  try {
    const raw = localStorage.getItem(aiPersonalityStorageKey(userId));
    if (!raw) return { name: '', badge: '✨' };
    const parsed = JSON.parse(raw) as Partial<AIPersonality>;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      badge: typeof parsed.badge === 'string' ? parsed.badge : '✨',
    };
  } catch {
    return { name: '', badge: '✨' };
  }
}

function saveAIPersonality(userId: string, personality: AIPersonality) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(aiPersonalityStorageKey(userId), JSON.stringify(personality));
  } catch {
    // ignore storage failures
  }
}

function resetAIPersonality(userId: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(aiPersonalityStorageKey(userId));
  } catch {
    // ignore storage failures
  }
}

function isScrolledNearBottom(element: HTMLDivElement, threshold = 96) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function loadRecentCalendarTargets(userId: string) {
  if (typeof window === 'undefined') return [] as RecentCalendarTarget[];
  try {
    const raw = localStorage.getItem(recentCalendarTargetsStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is RecentCalendarTarget => Boolean(value && typeof value === 'object' && typeof value.title === 'string'))
      .slice(-40);
  } catch {
    return [];
  }
}

function saveRecentCalendarTargets(userId: string, entries: RecentCalendarTarget[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      recentCalendarTargetsStorageKey(userId),
      JSON.stringify(entries.slice(-40)),
    );
  } catch {
    // ignore local storage quota errors
  }
}

function mergeRecentCalendarTargets(existing: RecentCalendarTarget[], additions: RecentCalendarTarget[]) {
  const merged = new Map<string, RecentCalendarTarget>();
  for (const item of [...existing, ...additions]) {
    const key = [
      item.calendarId ?? '',
      item.id ?? '',
      normalizeDeleteCandidate(item.title),
      normalizeCalendarCandidate(item.calendarSummary ?? ''),
      item.dateKey ?? '',
      item.startKey ?? '',
    ].join('::');
    merged.set(key, item);
  }
  return [...merged.values()]
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-40);
}

function normalizeCalendarLookupValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s+calendar$/, '');
}

function messageLooksLikeCalendarListingRequest(message: string) {
  const normalized = message.toLowerCase();
  return (
    /(find|list|show|what|which)/.test(normalized) &&
    /(event|events)/.test(normalized) &&
    /(calendar|under|in|from)/.test(normalized)
  );
}

function findCalendarMention(message: string, calendars: GoogleCalendarListItem[]) {
  const normalizedMessage = normalizeCalendarLookupValue(message);
  return calendars.find(calendar => {
    const summary = normalizeCalendarLookupValue(calendar.summary);
    return summary.length > 0 && normalizedMessage.includes(summary);
  });
}

function promptLooksLikeSuggestionAdjustment(message: string) {
  return /\b(change|adjust|instead|move|later|earlier|different|another|shift|reschedule|update|edit|tweak|not that|doesn'?t work)\b/i.test(message);
}

function getLatestPendingSuggestion(messages: ChatMessage[], importedBlocks: Set<string>): PendingSuggestionSnapshot | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message.role !== 'assistant' || !message.content?.trim()) continue;

    let blocks: ImportBlock[] = [];
    try {
      blocks = parseImportBlocks(message.content);
    } catch {
      blocks = [];
    }

    const pendingEntries = blocks
      .map((block, index) => ({ block, key: `${message.id}:block:${index}` }))
      .filter(entry => !importedBlocks.has(entry.key));

    if (pendingEntries.length === 0) continue;

    return {
      signature: `${message.id}:${pendingEntries.map(entry => entry.key).join('|')}`,
      blockCount: pendingEntries.length,
      actionCount: pendingEntries.reduce((sum, entry) => sum + entry.block.rows.length, 0),
      blockTypes: Array.from(new Set(pendingEntries.map(entry => entry.block.type))),
    };
  }

  return null;
}

function formatRecentListedCalendarEvent(event: GoogleCalendarEvent, calendars: GoogleCalendarListItem[]) {
  const calendarSummary = event.calendarSummary
    || calendars.find(calendar => calendar.id === event.calendarId)?.summary
    || 'Unknown calendar';
  const dateKey = getEventDateKey(event) || 'unknown-date';
  const startLabel = event.start?.date
    ? 'All day'
    : event.start?.dateTime
      ? new Date(event.start.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : 'Unknown time';
  const endLabel = event.end?.dateTime
    ? new Date(event.end.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : event.end?.date
      ? 'All day'
      : '';
  const timeLabel = endLabel && endLabel !== startLabel ? `${startLabel} – ${endLabel}` : startLabel;
  return `${event.summary || 'Untitled event'} · ${calendarSummary} · ${dateKey} · ${timeLabel}`;
}

function formatSummaryTime(dateTime?: string) {
  if (!dateTime) return '';
  return new Date(dateTime).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function summarizePayloadAction(
  action: 'created' | 'updated',
  payload: NewGoogleCalendarEvent,
  calendarSummary?: string,
) {
  const title = payload.summary || 'Untitled event';
  const dateKey = 'date' in payload.start ? payload.start.date : payload.start.dateTime?.slice(0, 10) || '';
  const startLabel = 'dateTime' in payload.start ? formatSummaryTime(payload.start.dateTime) : 'All day';
  return `${action.toUpperCase()}: ${title}${calendarSummary ? ` | calendar: ${calendarSummary}` : ''}${dateKey ? ` | date: ${dateKey}` : ''}${startLabel ? ` | start: ${startLabel}` : ''}`;
}

function summarizeEventAction(
  action: 'deleted' | 'updated',
  event: GoogleCalendarEvent,
) {
  const title = event.summary || 'Untitled event';
  const dateKey = event.start?.date ?? event.start?.dateTime?.slice(0, 10) ?? '';
  const startLabel = event.start?.dateTime ? formatSummaryTime(event.start.dateTime) : event.start?.date ? 'All day' : '';
  return `${action.toUpperCase()}: ${title}${event.calendarSummary ? ` | calendar: ${event.calendarSummary}` : ''}${dateKey ? ` | date: ${dateKey}` : ''}${startLabel ? ` | start: ${startLabel}` : ''}`;
}

function buildRecentTargetFromEvent(event: GoogleCalendarEvent): RecentCalendarTarget {
  return {
    id: event.id,
    calendarId: event.calendarId,
    title: event.summary || 'Untitled event',
    calendarSummary: event.calendarSummary,
    dateKey: event.start?.date ?? event.start?.dateTime?.slice(0, 10),
    startKey: getEventStartKey(event) || undefined,
    updatedAt: Date.now(),
  };
}

function buildRecentTargetFromPayload(
  payload: NewGoogleCalendarEvent,
  calendarId?: string,
  calendarSummary?: string,
  eventId?: string,
): RecentCalendarTarget {
  return {
    id: eventId,
    calendarId,
    title: payload.summary || 'Untitled event',
    calendarSummary,
    dateKey: 'date' in payload.start ? payload.start.date : payload.start.dateTime?.slice(0, 10),
    startKey: 'dateTime' in payload.start ? toTwentyFourHourKey(formatSummaryTime(payload.start.dateTime)) || undefined : undefined,
    updatedAt: Date.now(),
  };
}

function formatDictationElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface AIPanelProps {
  open: boolean;
  mode: 'floating' | 'sidebar';
  onModeChange: (mode: 'floating' | 'sidebar') => void;
  onClose: () => void;
  onOpenDataSettings: () => void;
  userId: string;
  // App data for context
  tasks: Task[];
  deadlines: Deadline[];
  projects: Project[];
  plans: WorkoutPlan[];
  dayTemplates: WorkoutDayTemplate[];
  exercises: Exercise[];
  dayExercises: WorkoutDayExercise[];
  calendarEvents: GoogleCalendarEvent[];
  calendarCalendars: GoogleCalendarListItem[];
  selectedCalendarId: string;
  getCalendarEventsForRange?: (range: { timeMin?: string; timeMax?: string }, calendarIds?: string[]) => Promise<GoogleCalendarEvent[]>;
  aiLearningEnabled: boolean;
  onAiLearningEnabledChange: (enabled: boolean) => void;
  scoreStudySlot: (dateKey: string, startMinutes: number, durationMinutes: number) => number;
  behaviorSummary?: string;
  draftPrompt?: string | null;
  onDraftPromptConsumed?: () => void;
  onAiPromptSubmitted?: (prompt: string, hasImages: boolean) => void;
  onAiActionsApplied?: (blockType: string, appliedCount: number, skippedCount: number) => void;
  onAiSuggestionAccepted?: (blockType: string, actionCount: number) => void;
  onAiSuggestionEdited?: (blockType: string, actionCount: number) => void;
  onAiSuggestionRejected?: (blockTypes: string[], actionCount: number) => void;
  onStudyBlockLinkedTarget?: (params: {
    title: string;
    calendarSummary?: string | null;
    course?: string | null;
    deadlineTitle: string;
    deadlineDate: string;
    deadlineType?: string | null;
  }) => void;
  onStudySlotCandidatesLogged?: (params: {
    title: string;
    calendarSummary?: string | null;
    course?: string | null;
    dateKey: string;
    durationMinutes: number;
    requestedStartMinutes: number;
    adjusted: boolean;
    deadlineTitle?: string | null;
    deadlineDate?: string | null;
    deadlineType?: string | null;
    candidates: Array<{
      startMinutes: number;
      endMinutes: number;
      score: number;
      distance: number;
      selected: boolean;
    }>;
  }) => void;
  // Callbacks for imports
  onAddTask: (title: string, description: string, priority: Priority, projectId: string | null, dueDate: string | null, recurrence: Recurrence, status?: TaskStatus, options?: BehaviorLearningActionOptions) => Promise<string | null>;
  onUpdateTask: (id: string, updates: { title?: string; description?: string; priority?: Priority; projectId?: string | null; dueDate?: string | null; recurrence?: Recurrence; status?: TaskStatus }, options?: BehaviorLearningActionOptions) => Promise<boolean>;
  onAddDeadline: (title: string, projectId: string | null, type: DeadlineType, dueDate: string, dueTime: string | null, notes: string, status?: DeadlineStatus, source?: { sourceType: DeadlineSource; sourceId: string; sourceUrl?: string }, options?: BehaviorLearningActionOptions) => Promise<boolean>;
  onUpdateDeadline: (id: string, updates: {
    title?: string;
    projectId?: string | null;
    status?: DeadlineStatus;
    type?: DeadlineType;
    dueDate?: string;
    dueTime?: string | null;
    notes?: string;
  }) => Promise<boolean>;
  onAddProject: (name: string, description: string, options?: BehaviorLearningActionOptions) => Promise<string | null>;
  onAddSubtask: (taskId: string, title: string, options?: BehaviorLearningActionOptions) => Promise<boolean>;
  onDeleteSubtask: (subtaskId: string, options?: BehaviorLearningActionOptions) => Promise<boolean>;
  onDeleteTask: (taskId: string, options?: BehaviorLearningActionOptions) => Promise<boolean>;
  onLinkTask: (deadlineId: string, taskId: string, options?: BehaviorLearningActionOptions) => Promise<boolean>;
  onCreateCalendarEvent: (event: NewGoogleCalendarEvent, calendarId?: string, options?: BehaviorLearningActionOptions) => Promise<boolean>;
  onUpdateCalendarEvent: (eventId: string, event: Partial<NewGoogleCalendarEvent>, calendarId?: string, options?: BehaviorLearningActionOptions, existingEvent?: GoogleCalendarEvent) => Promise<boolean>;
  onDeleteCalendarEvent: (eventId: string, calendarId?: string, options?: BehaviorLearningActionOptions, existingEvent?: GoogleCalendarEvent, deleteOptions?: { silent?: boolean }) => Promise<boolean>;
  onOpenAcademicPlanner?: (deadlineIds?: string[]) => void;
  onOpenDeadlineImport?: () => void;
  habits: Habit[];
  onAddHabit: (title: string, frequency?: 'daily' | 'weekly', options?: BehaviorLearningActionOptions) => Promise<void>;
  onToggleHabit: (id: string, options?: BehaviorLearningActionOptions) => Promise<void>;
  onDeleteHabit: (id: string, options?: BehaviorLearningActionOptions) => Promise<void>;
}

export function AIPanel({
  open, mode, onModeChange, onClose, onOpenDataSettings, userId,
  tasks, deadlines, projects, plans, dayTemplates, exercises, dayExercises,
  calendarEvents, calendarCalendars, selectedCalendarId, getCalendarEventsForRange, aiLearningEnabled, onAiLearningEnabledChange: _onAiLearningEnabledChange, scoreStudySlot, behaviorSummary, draftPrompt, onDraftPromptConsumed, onAiPromptSubmitted, onAiActionsApplied, onAiSuggestionAccepted, onAiSuggestionEdited, onAiSuggestionRejected, onStudyBlockLinkedTarget, onStudySlotCandidatesLogged,
  onAddTask, onUpdateTask, onAddDeadline, onUpdateDeadline, onAddProject, onAddSubtask, onDeleteSubtask, onDeleteTask, onLinkTask,
  onCreateCalendarEvent, onUpdateCalendarEvent, onDeleteCalendarEvent,
  onOpenAcademicPlanner,
  onOpenDeadlineImport,
  habits, onAddHabit, onToggleHabit, onDeleteHabit,
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
  } = useAI(userId);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [hasKey, setHasKey] = useState(!!getAPIKeyCached(userId));
  const [keyLoading, setKeyLoading] = useState(!getAPIKeyCached(userId));

  useEffect(() => {
    let cancelled = false;

    const syncKey = (showLoading: boolean) => {
      // Only show the loading spinner when we have no cached key at all.
      // Tab-focus and re-open re-syncs happen silently in the background
      // so the chat doesn't flash a spinner.
      if (showLoading) setKeyLoading(true);
      void getAPIKey(userId)
        .then(key => {
          if (cancelled) return;
          setHasKey(!!key);
          setKeyLoading(false);
        })
        .catch(err => {
          console.error('Failed to load API key:', err);
          if (cancelled) return;
          setKeyLoading(false);
        });
    };

    // First load: only show spinner if we have no cached key
    syncKey(!getAPIKeyCached(userId));

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncKey(false);
      }
    };

    const handleFocus = () => {
      syncKey(false);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [userId]);
  const [importedBlocks, setImportedBlocks] = useState<Set<string>>(() => loadImportedBlocks(userId));
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingChatTitle, setEditingChatTitle] = useState('');
  const [pendingDeleteChat, setPendingDeleteChat] = useState<ChatThread | null>(null);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const chatMenuRef = useRef<HTMLDivElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const recentAiTasksRef = useRef<Task[]>([]);
  const handledPendingSuggestionRefs = useRef<Set<string>>(new Set());
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const dictationBaseInputRef = useRef('');
  const composerDragDepthRef = useRef(0);
  const [isDictating, setIsDictating] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isComposerDragActive, setIsComposerDragActive] = useState(false);
  const [dictationSeconds, setDictationSeconds] = useState(0);
  const [stickToBottom, setStickToBottom] = useState(true);
  const aiLearningOptions = useMemo<BehaviorLearningActionOptions>(() => ({
    source: 'ai',
    learn: aiLearningEnabled,
  }), [aiLearningEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(importedBlocksStorageKey(userId), JSON.stringify([...importedBlocks]));
    } catch {
      // ignore storage failures
    }
  }, [importedBlocks, userId]);

  useEffect(() => {
    setImportedBlocks(loadImportedBlocks(userId));
  }, [userId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (!open) return;
    setStickToBottom(true);
    const frame = requestAnimationFrame(() => scrollToBottom('auto'));
    return () => cancelAnimationFrame(frame);
  }, [open, currentChatId, scrollToBottom]);

  useEffect(() => {
    if (!open || !stickToBottom) return;
    const frame = requestAnimationFrame(() => scrollToBottom('auto'));
    return () => cancelAnimationFrame(frame);
  }, [messages, open, scrollToBottom, stickToBottom]);

  useEffect(() => {
    const recognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSpeechSupported(Boolean(recognitionCtor));
  }, []);

  useEffect(() => {
    if (!isDictating) {
      setDictationSeconds(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setDictationSeconds(prev => prev + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isDictating]);

  // Focus input when panel opens
  useEffect(() => {
    if (open && hasKey) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open, hasKey]);

  useEffect(() => {
    if (!open || !draftPrompt?.trim()) return;
    setInput(draftPrompt.trim());
    requestAnimationFrame(() => inputRef.current?.focus());
    onDraftPromptConsumed?.();
  }, [draftPrompt, onDraftPromptConsumed, open]);

  useEffect(() => {
    if (open) return;
    setInput('');
    setPendingImages([]);
    setShowAttachmentMenu(false);
    setPanelError(null);
    composerDragDepthRef.current = 0;
    setIsComposerDragActive(false);
    speechRecognitionRef.current?.stop();
    setIsDictating(false);
    setDictationSeconds(0);
  }, [open]);

  useEffect(() => {
    if (open) return;
    composerDragDepthRef.current = 0;
    setIsComposerDragActive(false);
  }, [open]);

  useEffect(() => {
    if (!showAttachmentMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (attachmentMenuRef.current?.contains(event.target as Node)) return;
      setShowAttachmentMenu(false);
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [showAttachmentMenu]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 128) + 'px';
  }, [input]);

  useEffect(() => {
    if (open) return;
    speechRecognitionRef.current?.stop();
    setIsDictating(false);
  }, [open]);

  useEffect(() => {
    return () => {
      speechRecognitionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (chatMenuRef.current?.contains(target) || modeMenuRef.current?.contains(target)) return;
      setShowChatMenu(false);
      setShowModeMenu(false);
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, []);

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
    speechRecognitionRef.current?.stop();
    setIsDictating(false);
    setDictationSeconds(0);
    setShowAttachmentMenu(false);
    const msg = input.trim() || '';
    const images = pendingImages.length ? [...pendingImages] : undefined;
    const matchedCalendar = messageLooksLikeCalendarListingRequest(msg)
      ? findCalendarMention(msg, calendarCalendars)
      : null;
    const recentListedCalendarEvents = matchedCalendar
      ? calendarEvents
          .filter(event => event.calendarId === matchedCalendar.id)
          .sort((a, b) => {
            const aTime = a.start?.dateTime || a.start?.date || '';
            const bTime = b.start?.dateTime || b.start?.date || '';
            return aTime.localeCompare(bTime);
          })
          .map(event => formatRecentListedCalendarEvent(event, calendarCalendars))
      : loadRecentListedCalendarEvents(userId);
    if (matchedCalendar) {
      saveRecentListedCalendarEvents(userId, recentListedCalendarEvents);
      const matchedCalendarTargets = calendarEvents
        .filter(event => event.calendarId === matchedCalendar.id)
        .sort((a, b) => {
          const aTime = a.start?.dateTime || a.start?.date || '';
          const bTime = b.start?.dateTime || b.start?.date || '';
          return aTime.localeCompare(bTime);
        })
        .map(buildRecentTargetFromEvent);
      saveRecentCalendarTargets(
        userId,
        mergeRecentCalendarTargets(loadRecentCalendarTargets(userId), matchedCalendarTargets),
      );
    }
    setPanelError(null);
    const pendingSuggestion = getLatestPendingSuggestion(messages, importedBlocks);
    if (
      pendingSuggestion &&
      !handledPendingSuggestionRefs.current.has(pendingSuggestion.signature) &&
      !promptLooksLikeSuggestionAdjustment(msg)
    ) {
      onAiSuggestionRejected?.(pendingSuggestion.blockTypes, pendingSuggestion.actionCount);
      handledPendingSuggestionRefs.current.add(pendingSuggestion.signature);
    }
    onAiPromptSubmitted?.(msg, Boolean(images?.length));
    setInput('');
    setPendingImages([]);
    setStickToBottom(true);
    await sendMessage(msg, {
      tasks,
      deadlines,
      projects,
      plans,
      dayTemplates,
      exercises,
      dayExercises,
      calendarEvents,
      calendarCalendars,
      selectedCalendarId,
      habits,
      recentAppliedCalendarActions: loadRecentAppliedCalendarActions(userId),
      recentListedCalendarEvents,
      behaviorSummary,
    }, images);
  }, [input, pendingImages, isStreaming, sendMessage, tasks, deadlines, projects, plans, dayTemplates, exercises, dayExercises, calendarEvents, calendarCalendars, selectedCalendarId, habits, userId, messages, importedBlocks, onAiPromptSubmitted, onAiSuggestionRejected, behaviorSummary]);

  const appendImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return false;

    // Limit to 4MB per image (base64 will be ~33% larger)
    if (file.size > 4 * 1024 * 1024) {
      setPanelError('Image too large (max 4MB). Try a smaller image or screenshot.');
      return true;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [header, base64] = dataUrl.split(',');
      const mimeType = header.match(/data:(.*?);/)?.[1] ?? 'image/png';
      setPendingImages(prev => [...prev, { base64, mimeType, preview: dataUrl }]);
    };
    reader.readAsDataURL(file);
    return true;
  }, []);

  const isFileDragEvent = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types).includes('Files') ||
    Array.from(event.dataTransfer.items ?? []).some(item => item.kind === 'file');

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setShowAttachmentMenu(false);

    Array.from(files).forEach(appendImageFile);

    // Reset file input so same file can be selected again
    e.target.value = '';
  };

  const handleComposerDragEnter = (e: React.DragEvent) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    composerDragDepthRef.current += 1;
    setIsComposerDragActive(true);
  };

  const handleComposerDragOver = (e: React.DragEvent) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isComposerDragActive) setIsComposerDragActive(true);
  };

  const handleComposerDragLeave = (e: React.DragEvent) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    composerDragDepthRef.current = Math.max(0, composerDragDepthRef.current - 1);
    if (composerDragDepthRef.current === 0) {
      setIsComposerDragActive(false);
    }
  };

  const handleComposerDrop = (e: React.DragEvent) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    composerDragDepthRef.current = 0;
    setIsComposerDragActive(false);

    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      setPanelError('Only image files can be attached to the AI composer.');
      return;
    }

    imageFiles.forEach(appendImageFile);
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

  const handleToggleDictation = useCallback(() => {
    if (!speechSupported || isStreaming) {
      if (!speechSupported) {
        setPanelError('Dictation is not supported in this browser.');
      }
      return;
    }

    if (isDictating) {
      speechRecognitionRef.current?.stop();
      return;
    }

    const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!RecognitionCtor) {
      setPanelError('Dictation is not supported in this browser.');
      return;
    }

    const recognition = new RecognitionCtor();
    dictationBaseInputRef.current = input.trim() ? `${input.trim()} ` : '';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setPanelError(null);
      setDictationSeconds(0);
      setIsDictating(true);
    };

    recognition.onresult = event => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript ?? '';
        if (!transcript) continue;
        if (result.isFinal) finalTranscript += transcript;
        else interimTranscript += transcript;
      }

      const combinedTranscript = `${finalTranscript}${interimTranscript}`.trim();
      setInput(combinedTranscript ? `${dictationBaseInputRef.current}${combinedTranscript}` : dictationBaseInputRef.current.trimEnd());
    };

    recognition.onerror = event => {
      if (event.error === 'no-speech') {
        setPanelError('No speech detected. Try again and speak a little closer to the mic.');
      } else if (event.error === 'not-allowed') {
        setPanelError('Microphone access was blocked. Enable mic access for this site to use dictation.');
      } else {
        setPanelError('Dictation stopped because the browser speech service returned an error.');
      }
    };

    recognition.onend = () => {
      setIsDictating(false);
      setDictationSeconds(0);
      speechRecognitionRef.current = null;
    };

    speechRecognitionRef.current = recognition;
    recognition.start();
  }, [input, isDictating, isStreaming, speechSupported]);

  const handleOpenAttachmentPicker = useCallback(() => {
    setShowAttachmentMenu(false);
    fileInputRef.current?.click();
  }, []);

  const selectChatFromMenu = (chatId: string) => {
    stopStreaming();
    selectChat(chatId);
    setPanelError(null);
    setShowChatMenu(false);
    requestAnimationFrame(() => inputRef.current?.focus());
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
    setShowChatMenu(false);
  };

  const handleImport = async (block: ImportBlock, blockKey: string, options?: ImportExecutionOptions) => {
    setPanelError(null);
    let imported = 0;
    let skippedForLog = 0;
    const appliedCalendarActions: string[] = [];
    let recentCalendarTargets = loadRecentCalendarTargets(userId);
    const projectCache = new Map<string, string | null>();
    const workingTasks: Task[] = [
      ...tasks,
      ...recentAiTasksRef.current.filter(recent => !tasks.some(task => task.id === recent.id)),
    ];
    let workingCalendarEvents: GoogleCalendarEvent[] = [...calendarEvents];
    const sourceUserMessage = getSourceUserMessageForBlock(messages, blockKey);
    const explicitEntityTarget = inferExplicitEntityTarget(sourceUserMessage);

    const calendarRange = buildCalendarLookupRange(collectCalendarRangeRows(block));
    if (calendarRange && getCalendarEventsForRange) {
      try {
        const lookupCalendarIds = collectCalendarLookupIds(block.rows, calendarCalendars, selectedCalendarId);
        const remoteEvents = await getCalendarEventsForRange(
          calendarRange,
          lookupCalendarIds.length > 0 ? lookupCalendarIds : undefined,
        );
        workingCalendarEvents = mergeCalendarEventsByIdentity(calendarEvents, remoteEvents);
      } catch (error) {
        console.warn('[AI] Failed to prefetch calendar range for AI action', error);
      }
    }

    const replacementCandidateEvents: GoogleCalendarEvent[] = [...workingCalendarEvents];
    const consumedReplacementKeys = new Set<string>();

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

      const newId = await onAddProject(courseName.trim(), '', aiLearningOptions);
      projectCache.set(normalized, newId);
      return newId;
    };

    if (block.type === 'delete-tasks') {
      let skipped = 0;
      let crossEntityAmbiguous = 0;
      for (const row of block.rows) {
        const deletePool = buildEntityScopedTaskPool(workingTasks, projects, row.title, row.course);
        const matches = matchTaskCandidates(deletePool, row.title);
        const deadlineMatches = matchDeadlineCandidates(deadlines, projects, row.title, row.course);
        if (matches.length === 1 && deadlineMatches.length === 1 && explicitEntityTarget !== 'task') {
          crossEntityAmbiguous++;
          skipped++;
          continue;
        }
        if (matches.length !== 1) {
          skipped++;
          continue;
        }

        const ok = await onDeleteTask(matches[0].id, aiLearningOptions);
        if (ok) {
          imported++;
          onAiSuggestionAccepted?.(block.type, 1);
        } else {
          skipped++;
        }
      }

      skippedForLog = skipped;
      if (crossEntityAmbiguous > 0) {
        setPanelError(
          crossEntityAmbiguous === 1
            ? 'Skipped 1 delete because that title matches both a task and a deadline. Say whether you mean the task or the deadline and try again.'
            : `Skipped ${crossEntityAmbiguous} deletes because those titles match both tasks and deadlines. Say whether you mean the task or the deadline and try again.`,
        );
      } else if (skipped > 0) {
        setPanelError(
          skipped === 1
            ? 'Skipped 1 AI delete entry because it was ambiguous, missing, or failed to delete.'
            : `Skipped ${skipped} AI delete entries because they were ambiguous, missing, or failed to delete.`,
        );
      }
    } else if (block.type === 'update-tasks') {
      let skipped = 0;
      let crossEntityAmbiguous = 0;
      for (const row of block.rows) {
        const updatePool = buildEntityScopedTaskPool(workingTasks, projects, row.title, row.course);
        const matches = matchTaskCandidates(updatePool, row.title);
        const deadlineMatches = matchDeadlineCandidates(deadlines, projects, row.title, row.course);
        if (matches.length === 1 && deadlineMatches.length === 1 && explicitEntityTarget !== 'task') {
          crossEntityAmbiguous++;
          skipped++;
          continue;
        }
        if (matches.length !== 1) {
          skipped++;
          continue;
        }
        const updates: Parameters<typeof onUpdateTask>[1] = {};
        if (row.dueDate !== undefined) updates.dueDate = row.dueDate;
        if (row.priority && ['low', 'medium', 'high'].includes(row.priority)) updates.priority = row.priority as Priority;
        if (row.status && ['todo', 'in-progress', 'done'].includes(row.status)) updates.status = row.status as TaskStatus;
        if (row.description !== undefined) updates.description = row.description;
        if (row.recurrence && ['none', 'daily', 'weekly', 'monthly'].includes(row.recurrence)) updates.recurrence = row.recurrence as Recurrence;
        if (row.course) {
          const projectId = await resolveProject(row.course);
          updates.projectId = projectId;
        }
        const ok = await onUpdateTask(matches[0].id, updates, aiLearningOptions);
        if (ok) {
          imported++;
          onAiSuggestionAccepted?.(block.type, 1);
          onAiSuggestionEdited?.(block.type, 1);
        } else skipped++;
      }
      if (crossEntityAmbiguous > 0) {
        setPanelError(
          crossEntityAmbiguous === 1
            ? 'Skipped 1 update because that title matches both a task and a deadline. Say whether you mean the task or the deadline and try again.'
            : `Skipped ${crossEntityAmbiguous} updates because those titles match both tasks and deadlines. Say whether you mean the task or the deadline and try again.`,
        );
      } else if (skipped > 0) {
        setPanelError(
          skipped === 1
            ? 'Skipped 1 update because the task was ambiguous, missing, or failed to update.'
            : `Skipped ${skipped} updates because tasks were ambiguous, missing, or failed to update.`,
        );
      }
      skippedForLog = skipped;
    } else if (block.type === 'calendar-create') {
      let created = 0;
      let skipped = 0;
      let adjusted = 0;
      let exactTimeConflictSkips = 0;

      for (const row of block.rows) {
        const targetCalendarId = row.calendar
          ? calendarCalendars.find(item => normalizeCalendarCandidate(item.summary) === normalizeCalendarCandidate(row.calendar || ''))?.id
          : selectedCalendarId;
        const targetCalendar = targetCalendarId
          ? calendarCalendars.find(item => item.id === targetCalendarId)
          : undefined;
        const linkedTarget = resolveStudyBlockLinkedDeadline(row, row.title, deadlines, projects);

        const rawPayload = buildCalendarEventPayload(row, 'create');
        if (!rawPayload || !targetCalendarId) {
          skipped++;
          continue;
        }

        const decoratedPayload = isStudyBlockAutoScheduleTarget(row, targetCalendar?.summary ?? row.calendar)
          ? attachAcademicStudyMetadata(rawPayload, row, linkedTarget)
          : rawPayload;

        const resolved = maybeResolveCalendarCreateConflict(
          row,
          decoratedPayload,
          workingCalendarEvents,
          targetCalendar?.summary ?? row.calendar,
          scoreStudySlot,
        );
        if (!resolved.payload) {
          if (resolved.exactTimeConflict) {
            exactTimeConflictSkips++;
          }
          if (
            resolved.dateKey &&
            resolved.durationMinutes !== null &&
            resolved.requestedStartMinutes !== null
          ) {
            const linkedTarget = resolveStudyBlockLinkedDeadline(row, rawPayload.summary, deadlines, projects);
            onStudySlotCandidatesLogged?.({
              title: decoratedPayload.summary,
              calendarSummary: targetCalendar?.summary ?? row.calendar,
              course: linkedTarget?.course ?? row.course ?? extractCourseFromTitle(row.title) ?? extractLeadingCourseCode(rawPayload.summary),
              dateKey: resolved.dateKey,
              durationMinutes: resolved.durationMinutes,
              requestedStartMinutes: resolved.requestedStartMinutes,
              adjusted: false,
              deadlineTitle: linkedTarget?.deadline.title ?? null,
              deadlineDate: linkedTarget?.deadline.dueDate ?? null,
              deadlineType: linkedTarget?.deadline.type ?? null,
              candidates: [],
            });
          }
          skipped++;
          continue;
        }

        const replacementMatch = isStudyBlockAutoScheduleTarget(row, targetCalendar?.summary ?? row.calendar)
          ? findStudyBlockReplacementCandidate(
            replacementCandidateEvents.filter(event => {
              const key = `${event.calendarId ?? ''}:${event.id}`;
              return !consumedReplacementKeys.has(key);
            }),
            calendarCalendars,
            targetCalendarId,
            row,
            resolved.payload,
          )
          : null;

        const ok = replacementMatch
          ? await onUpdateCalendarEvent(replacementMatch.id, resolved.payload, targetCalendarId, aiLearningOptions, replacementMatch)
          : await onCreateCalendarEvent(resolved.payload, targetCalendarId, aiLearningOptions);

        if (ok) {
          created++;
          if (resolved.adjusted) adjusted++;
          const nextSyntheticEvent = buildSyntheticCalendarEvent(
            resolved.payload,
            targetCalendarId,
            targetCalendar?.summary,
            targetCalendar?.backgroundColor,
          );
          if (replacementMatch) {
            consumedReplacementKeys.add(`${replacementMatch.calendarId ?? ''}:${replacementMatch.id}`);
            appliedCalendarActions.push(
              summarizePayloadAction('updated', resolved.payload, targetCalendar?.summary ?? row.calendar),
            );
            recentCalendarTargets = mergeRecentCalendarTargets(recentCalendarTargets, [
              buildRecentTargetFromPayload(
                resolved.payload,
                targetCalendarId,
                targetCalendar?.summary ?? row.calendar,
                replacementMatch.id,
              ),
            ]);
            workingCalendarEvents = workingCalendarEvents.map(event =>
              event.id === replacementMatch.id && event.calendarId === replacementMatch.calendarId
                ? { ...nextSyntheticEvent, id: replacementMatch.id }
                : event
            );
          } else {
            appliedCalendarActions.push(
              summarizePayloadAction('created', resolved.payload, targetCalendar?.summary ?? row.calendar),
            );
            recentCalendarTargets = mergeRecentCalendarTargets(recentCalendarTargets, [
              buildRecentTargetFromPayload(
                resolved.payload,
                targetCalendarId,
                targetCalendar?.summary ?? row.calendar,
              ),
            ]);
            workingCalendarEvents.push(nextSyntheticEvent);
          }

          onAiSuggestionAccepted?.(block.type, 1);

          if (
            resolved.dateKey &&
            resolved.durationMinutes !== null &&
            resolved.requestedStartMinutes !== null
          ) {
            if (linkedTarget) {
              onStudyBlockLinkedTarget?.({
                title: resolved.payload.summary,
                calendarSummary: targetCalendar?.summary ?? row.calendar,
                course: linkedTarget.course,
                deadlineTitle: linkedTarget.deadline.title,
                deadlineDate: linkedTarget.deadline.dueDate,
                deadlineType: linkedTarget.deadline.type,
              });
            }

            onStudySlotCandidatesLogged?.({
              title: resolved.payload.summary,
              calendarSummary: targetCalendar?.summary ?? row.calendar,
              course: linkedTarget?.course ?? row.course ?? extractCourseFromTitle(row.title) ?? extractLeadingCourseCode(resolved.payload.summary),
              dateKey: resolved.dateKey,
              durationMinutes: resolved.durationMinutes,
              requestedStartMinutes: resolved.requestedStartMinutes,
              adjusted: resolved.adjusted,
              deadlineTitle: linkedTarget?.deadline.title ?? null,
              deadlineDate: linkedTarget?.deadline.dueDate ?? null,
              deadlineType: linkedTarget?.deadline.type ?? null,
              candidates: resolved.candidates.map(candidate => ({
                ...candidate,
                selected: resolved.selectedStartMinutes === candidate.startMinutes,
              })),
            });
          }
        } else {
          skipped++;
        }
      }

      imported = created;
      skippedForLog = skipped;
      if (skipped > 0) {
        setPanelError(
          exactTimeConflictSkips > 0
            ? exactTimeConflictSkips === skipped
              ? skipped === 1
                ? 'Skipped 1 calendar create because the exact requested time was not free.'
                : `Skipped ${skipped} calendar creates because the exact requested times were not free.`
              : `Skipped ${skipped} calendar creates because some exact requested times were not free and others were incomplete or failed to save.`
            : skipped === 1
              ? 'Skipped 1 calendar create because it conflicted, was incomplete, or failed to save.'
              : `Skipped ${skipped} calendar creates because they conflicted, were incomplete, or failed to save.`,
        );
      } else if (adjusted > 0) {
        setPanelError(null);
      }
    } else if (block.type === 'calendar-update') {
      let updated = 0;
      let skipped = 0;

      for (const row of block.rows) {
        const matches = resolvePreferredCalendarCandidates(workingCalendarEvents, calendarCalendars, row);
        let payload: NewGoogleCalendarEvent | null = buildCalendarEventPayload(row, 'update');

        if (matches.length !== 1 || !payload) {
          skipped++;
          continue;
        }

        const targetCalendarId = row.newCalendar
          ? calendarCalendars.find(item => normalizeCalendarCandidate(item.summary) === normalizeCalendarCandidate(row.newCalendar || ''))?.id
          : matches[0].calendarId;

        const targetCalendarSummary = row.newCalendar
          ? calendarCalendars.find(item => item.id === targetCalendarId)?.summary ?? row.newCalendar
          : matches[0].calendarSummary;
        const linkedTarget = resolveStudyBlockLinkedDeadline(row, payload.summary, deadlines, projects);

        if (isStudyBlockAutoScheduleTarget(row, targetCalendarSummary)) {
          payload = attachAcademicStudyMetadata(payload, row, linkedTarget, matches[0].description ?? null);
        }

        const updateResolution = maybeResolveCalendarUpdateConflict(
          row,
          payload,
          workingCalendarEvents,
          matches[0],
          targetCalendarSummary,
          scoreStudySlot,
        );

        if (!updateResolution.payload) {
          if (
            updateResolution.dateKey &&
            updateResolution.durationMinutes !== null &&
            updateResolution.requestedStartMinutes !== null
          ) {
            const linkedTarget = resolveStudyBlockLinkedDeadline(row, payload.summary, deadlines, projects);
            onStudySlotCandidatesLogged?.({
              title: payload.summary,
              calendarSummary: targetCalendarSummary,
              course: linkedTarget?.course ?? row.course ?? extractCourseFromTitle(row.title) ?? extractLeadingCourseCode(payload.summary),
              dateKey: updateResolution.dateKey,
              durationMinutes: updateResolution.durationMinutes,
              requestedStartMinutes: updateResolution.requestedStartMinutes,
              adjusted: false,
              deadlineTitle: linkedTarget?.deadline.title ?? null,
              deadlineDate: linkedTarget?.deadline.dueDate ?? null,
              deadlineType: linkedTarget?.deadline.type ?? null,
              candidates: [],
            });
          }
          skipped++;
          continue;
        }

        payload = updateResolution.payload;

        const ok = await onUpdateCalendarEvent(matches[0].id, payload, targetCalendarId, aiLearningOptions, matches[0]);
        if (ok) {
          updated++;
          onAiSuggestionAccepted?.(block.type, 1);
          onAiSuggestionEdited?.(block.type, 1);
          const targetCalendar = calendarCalendars.find(item => item.id === targetCalendarId);
          appliedCalendarActions.push(
            summarizePayloadAction('updated', payload, targetCalendar?.summary ?? row.newCalendar ?? matches[0].calendarSummary),
          );
          recentCalendarTargets = mergeRecentCalendarTargets(recentCalendarTargets, [
            buildRecentTargetFromPayload(
              payload,
              targetCalendarId,
              targetCalendar?.summary ?? row.newCalendar ?? matches[0].calendarSummary,
              matches[0].id,
            ),
          ]);
          const nextSyntheticEvent = buildSyntheticCalendarEvent(
            payload,
            targetCalendarId ?? matches[0].calendarId ?? '',
            targetCalendar?.summary ?? matches[0].calendarSummary,
            targetCalendar?.backgroundColor ?? matches[0].calendarColor,
          );
          workingCalendarEvents = workingCalendarEvents.map(event =>
            event.id === matches[0].id && event.calendarId === matches[0].calendarId
              ? { ...nextSyntheticEvent, id: matches[0].id }
              : event
          );

          if (
            updateResolution.dateKey &&
            updateResolution.durationMinutes !== null &&
            updateResolution.requestedStartMinutes !== null
          ) {
            if (linkedTarget) {
              onStudyBlockLinkedTarget?.({
                title: payload.summary,
                calendarSummary: targetCalendar?.summary ?? row.newCalendar ?? matches[0].calendarSummary,
                course: linkedTarget.course,
                deadlineTitle: linkedTarget.deadline.title,
                deadlineDate: linkedTarget.deadline.dueDate,
                deadlineType: linkedTarget.deadline.type,
              });
            }

            onStudySlotCandidatesLogged?.({
              title: payload.summary,
              calendarSummary: targetCalendar?.summary ?? row.newCalendar ?? matches[0].calendarSummary,
              course: linkedTarget?.course ?? row.course ?? extractCourseFromTitle(row.title) ?? extractLeadingCourseCode(payload.summary),
              dateKey: updateResolution.dateKey,
              durationMinutes: updateResolution.durationMinutes,
              requestedStartMinutes: updateResolution.requestedStartMinutes,
              adjusted: updateResolution.adjusted,
              deadlineTitle: linkedTarget?.deadline.title ?? null,
              deadlineDate: linkedTarget?.deadline.dueDate ?? null,
              deadlineType: linkedTarget?.deadline.type ?? null,
              candidates: updateResolution.candidates.map(candidate => ({
                ...candidate,
                selected: updateResolution.selectedStartMinutes === candidate.startMinutes,
              })),
            });
          }
        } else skipped++;
      }

      imported = updated;
      skippedForLog = skipped;
      if (skipped > 0) {
        setPanelError(
          skipped === 1
            ? 'Skipped 1 calendar update because it was ambiguous, incomplete, or failed to save.'
            : `Skipped ${skipped} calendar updates because they were ambiguous, incomplete, or failed to save.`,
        );
      }
    } else if (block.type === 'calendar-delete') {
      let deleted = 0;
      let skipped = 0;
      const deletedKeys = new Set<string>();
      const processedDeleteRows = new Set<string>();
      const frozenCalendarDeleteTargets = options?.frozenCalendarDeleteTargets ?? {};

      for (const row of block.rows) {
        const deleteRequestKey = buildCalendarDeleteRequestKey(row);
        if (processedDeleteRows.has(deleteRequestKey)) {
          continue;
        }
        processedDeleteRows.add(deleteRequestKey);

        const matches = frozenCalendarDeleteTargets[deleteRequestKey]
          ?? resolveCalendarDeleteCandidates(workingCalendarEvents, calendarCalendars, selectedCalendarId, row, recentCalendarTargets);
        if (matches.length === 0) {
          skipped++;
          continue;
        }

        let allDeleted = true;
        for (const match of matches) {
          const deleteKey = `${match.calendarId || ''}:${match.id}`;
          if (deletedKeys.has(deleteKey)) {
            continue;
          }
          const ok = await onDeleteCalendarEvent(match.id, match.calendarId, aiLearningOptions, match, { silent: true });
          if (ok) {
            deleted++;
            onAiSuggestionAccepted?.(block.type, 1);
            appliedCalendarActions.push(summarizeEventAction('deleted', match));
            recentCalendarTargets = recentCalendarTargets.filter(target => !(
              target.id === match.id &&
              (target.calendarId ?? '') === (match.calendarId ?? '')
            ));
            deletedKeys.add(deleteKey);
            workingCalendarEvents = workingCalendarEvents.filter(event => !(event.id === match.id && event.calendarId === match.calendarId));
          } else {
            allDeleted = false;
          }
        }

        if (!allDeleted) {
          skipped++;
        }
      }

      imported = deleted;
      skippedForLog = skipped;
      if (skipped > 0) {
        setPanelError(
          skipped === 1
            ? 'Skipped 1 calendar delete because it was ambiguous, missing, or failed to delete.'
            : `Skipped ${skipped} calendar deletes because they were ambiguous, missing, or failed to delete.`,
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

        // Narrow candidates by course first so "Study for Exam 3 [MATH 2550]" doesn't
        // ambiguously match "Study for Exam 3 [MATH 3012]" after tag-stripping
        const linkCourse = row.course ?? extractCourseFromTitle(row.taskTitle ?? '');
        const taskPool = linkCourse
          ? filterTasksByCourse(workingTasks, projects, linkCourse)
          : workingTasks;
        const taskMatches = resolvePreferredTaskCandidates(taskPool, row.taskTitle ?? '', recentAiTasksRef.current);
        const deadlineMatches = matchDeadlineCandidates(deadlines, projects, row.title, row.course);

        if (taskMatches.length !== 1 || deadlineMatches.length !== 1) {
          skipped++;
          continue;
        }

        const ok = await onLinkTask(deadlineMatches[0].id, taskMatches[0].id, aiLearningOptions);
        if (ok) {
          linked++;
          onAiSuggestionAccepted?.(block.type, 1);
        } else skipped++;
      }

      imported = linked;
      skippedForLog = skipped;
      if (skipped > 0) {
        setPanelError(
          skipped === 1
            ? 'Skipped 1 deadline link because it was ambiguous, missing, or failed to link.'
            : `Skipped ${skipped} deadline links because they were ambiguous, missing, or failed to link.`,
        );
      }
    } else if (block.type === 'subtasks') {
      const rowsByParent = new Map<string, { title: string; course?: string; rows: ParsedImportRow[] }>();
      for (const row of block.rows) {
        const parentTitle = (row.taskTitle ?? block.parentTaskTitle ?? '').trim();
        const parentCourse = row.course ?? extractCourseFromTitle(parentTitle);
        const key = `${normalizeDeleteCandidate(parentTitle)}::${normalizeDeleteCandidate(parentCourse ?? '')}`;
        const group = rowsByParent.get(key) ?? { title: parentTitle, course: parentCourse, rows: [] };
        group.rows.push(row);
        rowsByParent.set(key, group);
      }

      const skippedParents: string[] = [];
      for (const group of rowsByParent.values()) {
        const parentMatches = resolveSubtaskParentCandidates(workingTasks, projects, group.title, group.course);
        if (parentMatches.length !== 1) {
          skippedForLog += group.rows.length;
          skippedParents.push(group.title || 'missing parent task');
          continue;
        }

        const parentTask = parentMatches[0];
        const subtaskResults = await Promise.all(
          group.rows.map(row => onAddSubtask(parentTask.id, row.title, aiLearningOptions))
        );
        imported += subtaskResults.filter(Boolean).length;
        subtaskResults.filter(Boolean).forEach(() => onAiSuggestionAccepted?.(block.type, 1));
        skippedForLog += subtaskResults.length - subtaskResults.filter(Boolean).length;
      }

      if (skippedParents.length > 0) {
        setPanelError(
          `Skipped ${skippedForLog} subtask${skippedForLog === 1 ? '' : 's'} because the parent task was missing or ambiguous: ` +
          skippedParents.join(', ')
        );
      }
    } else if (block.type === 'delete-subtasks') {
      let skipped = 0;
      for (const row of block.rows) {
        const parentTitle = (row.taskTitle ?? block.parentTaskTitle ?? '').trim();
        const parentCourse = row.course ?? extractCourseFromTitle(parentTitle);
        const parentMatches = resolveSubtaskParentCandidates(workingTasks, projects, parentTitle, parentCourse);
        if (parentMatches.length !== 1) {
          skipped++;
          continue;
        }

        const subtaskMatches = matchSubtaskCandidates(parentMatches[0], row.title);
        if (subtaskMatches.length !== 1) {
          skipped++;
          continue;
        }

        const ok = await onDeleteSubtask(subtaskMatches[0].id, aiLearningOptions);
        if (ok) {
          imported++;
          onAiSuggestionAccepted?.(block.type, 1);
        } else {
          skipped++;
        }
      }
      skippedForLog = skipped;
      if (skipped > 0) {
        setPanelError(
          skipped === 1
            ? 'Skipped 1 subtask delete because the parent or subtask was missing or ambiguous.'
            : `Skipped ${skipped} subtask deletes because the parent or subtask was missing or ambiguous.`,
        );
      }
    } else if (block.type === 'tasks') {
      // Resolve all project IDs first (may create projects), then insert all tasks in parallel
      const resolvedRows = await Promise.all(
        block.rows.map(async row => ({
          row,
          projectId: await resolveProject(row.course),
          priority: (['low', 'medium', 'high'].includes(row.priority ?? '') ? row.priority : 'medium') as Priority,
          recurrence: (['none', 'daily', 'weekly', 'monthly'].includes(row.recurrence ?? '') ? row.recurrence : 'none') as Recurrence,
          status: (['todo', 'in-progress', 'done'].includes(row.status ?? '') ? row.status : 'todo') as TaskStatus,
        }))
      );

      const taskResults = await Promise.all(
        resolvedRows.map(({ row, projectId, priority, recurrence, status }) =>
          onAddTask(row.title, row.description ?? '', priority, projectId, row.dueDate ?? null, recurrence, status, aiLearningOptions)
            .then(result => ({ result, row, projectId, priority, recurrence, status }))
        )
      );

      for (const { result, row, projectId, priority, recurrence, status } of taskResults) {
        if (result) {
          imported++;
          onAiSuggestionAccepted?.(block.type, 1);
          const newTask: Task = {
            id: result,
            title: row.title,
            description: row.description ?? '',
            status,
            priority,
            projectId,
            createdAt: new Date().toISOString(),
            dueDate: row.dueDate ?? null,
            recurrence,
            subtasks: [],
            comments: [],
          };
          recentAiTasksRef.current = [...recentAiTasksRef.current, newTask];
          workingTasks.push(newTask);
        }
      }
      skippedForLog = taskResults.length - imported;
    } else if (block.type === 'deadlines') {
      let skipped = 0;
      let crossEntityAmbiguous = 0;
      for (const row of block.rows) {
        if (!row.dueDate) {
          skipped++;
          continue;
        }
        const projectId = await resolveProject(row.course);
        const type = (['assignment', 'exam', 'quiz', 'lab', 'project', 'other'].includes(row.type ?? '') ? row.type : 'other') as DeadlineType;
        const status = (['not-started', 'in-progress', 'done', 'missed'].includes(row.status ?? '') ? row.status : 'not-started') as DeadlineStatus;
        const matches = matchDeadlineCandidates(deadlines, projects, row.title, row.course);
        const taskMatches = matchTaskCandidates(
          buildEntityScopedTaskPool(workingTasks, projects, row.title, row.course),
          row.title,
        );
        if (matches.length === 1 && taskMatches.length === 1 && explicitEntityTarget !== 'deadline') {
          crossEntityAmbiguous++;
          skipped++;
          continue;
        }
        const ok = matches.length === 1
          ? await onUpdateDeadline(matches[0].id, {
              title: row.title,
              projectId,
              type,
              dueDate: row.dueDate,
              dueTime: row.dueTime ?? null,
              notes: row.notes ?? '',
              status,
            })
          : await onAddDeadline(
              row.title,
              projectId,
              type,
              row.dueDate,
              row.dueTime ?? null,
              row.notes ?? '',
              status,
              undefined,
              aiLearningOptions,
            );
        if (ok) {
          imported++;
          onAiSuggestionAccepted?.(block.type, 1);
          if (matches.length === 1) {
            onAiSuggestionEdited?.(block.type, 1);
          }
        } else skipped++;
      }
      skippedForLog = skipped;
      if (crossEntityAmbiguous > 0) {
        setPanelError(
          crossEntityAmbiguous === 1
            ? 'Skipped 1 deadline update because that title matches both a task and a deadline. Say whether you mean the task or the deadline and try again.'
            : `Skipped ${crossEntityAmbiguous} deadline updates because those titles match both tasks and deadlines. Say whether you mean the task or the deadline and try again.`,
        );
      } else if (skipped > 0) {
        setPanelError(
          skipped === 1
            ? 'Skipped 1 deadline entry because it was incomplete, ambiguous, or failed to save.'
            : `Skipped ${skipped} deadline entries because they were incomplete, ambiguous, or failed to save.`,
        );
      }
    } else if (block.type === 'habits-create') {
      for (const row of block.rows) {
        const freq = (row.frequency === 'weekly' ? 'weekly' : 'daily') as 'daily' | 'weekly';
        await onAddHabit(row.title, freq, aiLearningOptions);
        imported++;
        onAiSuggestionAccepted?.(block.type, 1);
      }
      skippedForLog = Math.max(0, block.rows.length - imported);
    } else if (block.type === 'habits-complete') {
      let skipped = 0;
      for (const row of block.rows) {
        const habit = habits.find(h => h.title.toLowerCase() === row.title.toLowerCase());
        if (habit && !habit.doneToday) {
          await onToggleHabit(habit.id, aiLearningOptions);
          imported++;
          onAiSuggestionAccepted?.(block.type, 1);
        } else {
          skipped++;
        }
      }
      skippedForLog = skipped;
    } else if (block.type === 'habits-delete') {
      let skipped = 0;
      for (const row of block.rows) {
        const habit = habits.find(h => h.title.toLowerCase() === row.title.toLowerCase());
        if (habit) {
          await onDeleteHabit(habit.id, aiLearningOptions);
          imported++;
          onAiSuggestionAccepted?.(block.type, 1);
        } else {
          skipped++;
        }
      }
      skippedForLog = skipped;
    }

    if (appliedCalendarActions.length > 0) {
      const existingActions = loadRecentAppliedCalendarActions(userId);
      saveRecentAppliedCalendarActions(userId, [...existingActions, ...appliedCalendarActions]);
    }
    saveRecentCalendarTargets(userId, recentCalendarTargets);
    onAiActionsApplied?.(block.type, imported, skippedForLog);

    setImportedBlocks(prev => new Set(prev).add(blockKey));
    return imported;
  };

  if (!open) return null;

  const handleCreateChat = () => {
    setPanelError(null);
    setShowChatMenu(false);
    setShowModeMenu(false);
    stopStreaming();
    createChat();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      scrollToBottom('auto');
    });
  };

  const handleStarterPrompt = (prompt: string) => {
    setInput(prompt);
    setStickToBottom(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleMessagesScroll = useCallback(() => {
    const element = messagesScrollRef.current;
    if (!element) return;
    setStickToBottom(isScrolledNearBottom(element));
  }, []);

  const panelContent = (
      <div
        data-walkthrough-panel="ai"
        className={cn(
          'flex min-h-0 flex-col overflow-hidden border border-[var(--border-soft)] bg-[var(--surface-elevated)]',
          mode === 'floating'
            ? 'fixed bottom-6 right-6 z-[70] h-[min(72vh,680px)] w-[min(440px,calc(100vw-3rem))] rounded-[28px] shadow-[0_24px_80px_rgba(15,23,42,0.18)] animate-in fade-in slide-in-from-bottom-2 duration-200'
            : 'h-full w-[420px] shrink-0 rounded-none border-y-0 border-r-0 shadow-none'
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div ref={chatMenuRef} className="relative min-w-0">
              <button
                type="button"
                onClick={() => {
                  setShowChatMenu(prev => !prev);
                  setShowModeMenu(false);
                }}
                className="inline-flex max-w-[220px] items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface)]"
              >
                <span className="truncate">{messages.length > 0 ? currentChat?.title || 'New AI chat' : 'New AI chat'}</span>
                <ChevronDown size={14} className="shrink-0 text-[var(--text-faint)]" />
              </button>
              {showChatMenu && (
                <div className="absolute left-0 top-full z-20 mt-2 w-72 overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-[0_18px_50px_rgba(15,23,42,0.12)]">
                  <div className="border-b border-[var(--border-soft)] px-4 py-3 text-xs font-medium text-[var(--text-faint)]">Recent chats</div>
                  <div className="max-h-72 overflow-y-auto px-2 py-2">
                    {threads.map(chat => {
                      const active = chat.id === currentChatId;
                      const isEditing = editingChatId === chat.id;
                      return (
                        <div
                          key={chat.id}
                          className={cn(
                            'group flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition',
                            active
                              ? 'bg-[var(--surface)] text-[var(--text-primary)]'
                              : 'text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]'
                          )}
                        >
                          {isEditing ? (
                            <>
                              <input
                                value={editingChatTitle}
                                onChange={e => setEditingChatTitle(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') commitRenameChat();
                                  if (e.key === 'Escape') cancelRenameChat();
                                }}
                                autoFocus
                                className="min-w-0 flex-1 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={commitRenameChat}
                                className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--surface-elevated)]"
                              >
                                Save
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => selectChatFromMenu(chat.id)}
                                className="min-w-0 flex-1 truncate text-left"
                              >
                                {chat.title}
                              </button>
                              <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => startRenameChat(chat)}
                                  className="rounded-md p-1 text-[var(--text-faint)] transition hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]"
                                  title="Rename chat"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPendingDeleteChat(chat)}
                                  className="rounded-md p-1 text-[var(--text-faint)] transition hover:bg-rose-500/10 hover:text-rose-400"
                                  title="Delete chat"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCreateChat}
              className="rounded-lg p-1.5 text-[var(--text-faint)] transition hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
              title="New chat"
            >
              <Plus size={16} />
            </button>
            <div ref={modeMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowModeMenu(prev => !prev);
                  setShowChatMenu(false);
                }}
                className="rounded-lg p-1.5 text-[var(--text-faint)] transition hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
                title="AI panel mode"
              >
                {mode === 'sidebar' ? <LayoutPanelLeft size={16} /> : <PanelRightOpen size={16} />}
              </button>
              {showModeMenu && (
                <div className="absolute right-0 top-full z-20 mt-2 w-44 overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-[0_18px_50px_rgba(15,23,42,0.12)]">
                  <button
                    type="button"
                    onClick={() => {
                      onModeChange('sidebar');
                      setShowModeMenu(false);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-[var(--text-primary)] transition hover:bg-[var(--surface)]"
                    title="Sidebar"
                  >
                    <LayoutPanelLeft size={15} className="text-[var(--text-faint)]" />
                    <span className="flex-1">Sidebar</span>
                    {mode === 'sidebar' && <Check size={14} className="text-[var(--text-muted)]" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onModeChange('floating');
                      setShowModeMenu(false);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-[var(--text-primary)] transition hover:bg-[var(--surface)]"
                    title="Floating"
                  >
                    <PanelRightOpen size={15} className="text-[var(--text-faint)]" />
                    <span className="flex-1">Floating</span>
                    {mode === 'floating' && <Check size={14} className="text-[var(--text-muted)]" />}
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-[var(--text-faint)] transition hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
              title="Minimize AI"
            >
              <Minus size={16} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <section className="min-w-0 flex-1 flex min-h-0 flex-col">
            {/* Messages */}
            <div key={currentChatId} ref={messagesScrollRef} onScroll={handleMessagesScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <AIPanelErrorBoundary>
                {keyLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-soft)] border-t-[var(--accent)]" />
                  </div>
                ) : !hasKey ? (
                  <div className="flex h-full items-center justify-center px-4">
                    <div className="w-full max-w-md rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface)] p-6 text-center shadow-sm">
                      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--surface-muted)]">
                        <Sparkles size={22} className="text-[var(--text-primary)]" />
                      </div>
                      <h3 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Set up AI first</h3>
                      <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                        Add your Gemini API key in Profile → Data, then come right back here to start planning, scheduling, and chatting.
                      </p>
                      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
                        <button
                          type="button"
                          onClick={onOpenDataSettings}
                          className="rounded-xl px-4 py-2.5 text-sm font-medium bg-[var(--accent-strong)] text-[var(--accent-contrast)]"
                         
                        >
                          Open Data settings
                        </button>
                        <a
                          href="https://aistudio.google.com/apikey"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-xl border border-[var(--border-soft)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--border-strong)]"
                        >
                          Get a free Gemini key
                        </a>
                      </div>
                    </div>
                  </div>
                ) : messages.length === 0 ? (
                  <WelcomeScreen userId={userId} hasKey={hasKey} onUsePrompt={handleStarterPrompt} onOpenAcademicPlanner={onOpenAcademicPlanner} onOpenDeadlineImport={onOpenDeadlineImport} />
                ) : (
                  <div className="space-y-4">
                    {messages.map((msg, index) => (
                      <MessageBubble
                        key={msg.id}
                        userId={userId}
                        message={msg}
                        promptContext={getPriorUserPrompt(messages, index)}
                        tasks={tasks}
                        deadlines={deadlines}
                        projects={projects}
                        calendarEvents={calendarEvents}
                        calendarCalendars={calendarCalendars}
                        selectedCalendarId={selectedCalendarId}
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
            <div className="border-t border-[var(--border-soft)] px-4 py-4">
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
              <div
                className={`relative flex flex-col gap-2.5 rounded-[22px] border px-3.5 py-3 transition-colors ${
                  isComposerDragActive
                    ? 'border-[var(--accent)]/55 bg-[var(--accent)]/8 pt-8 shadow-[0_0_0_1px_rgba(99,102,241,0.12)]'
                    : 'border-[var(--border-soft)] bg-[var(--surface)]'
                }`}
                onDragEnter={handleComposerDragEnter}
                onDragOver={handleComposerDragOver}
                onDragLeave={handleComposerDragLeave}
                onDrop={handleComposerDrop}
              >
                {isComposerDragActive && (
                  <div className="pointer-events-none absolute inset-x-3 top-2 flex justify-center">
                    <div className="rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/12 px-3 py-1 text-[10px] font-medium text-[var(--accent)]">
                      Drop photos here to attach
                    </div>
                  </div>
                )}
                {isDictating && (
                  <button
                    type="button"
                    onClick={handleToggleDictation}
                    className="absolute bottom-full right-3 z-10 mb-2 flex items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs text-[var(--text-primary)] transition hover:bg-[var(--surface)]"
                    title="Stop dictation"
                  >
                    <span className="font-medium">Stop dictation</span>
                    <span className="text-white/70">{formatDictationElapsed(dictationSeconds)}</span>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/12">
                      <Square size={10} fill="currentColor" />
                    </span>
                  </button>
                )}
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageSelect}
                  className="hidden"
                />
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={hasKey ? 'Ask anything or request tasks, deadlines, or calendar events...' : 'Add your Gemini API key above to start'}
                  disabled={!hasKey || isStreaming}
                  rows={1}
                  className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none disabled:opacity-50"
                  style={{ height: 'auto' }}
                />
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div ref={attachmentMenuRef} className="relative shrink-0">
                      <button
                        onClick={() => setShowAttachmentMenu(prev => !prev)}
                        disabled={!hasKey || isStreaming}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] disabled:opacity-40"
                        title="Add photo"
                        aria-haspopup="menu"
                        aria-expanded={showAttachmentMenu}
                      >
                        <Plus size={15} />
                      </button>
                      {showAttachmentMenu && (
                        <div className="absolute bottom-full left-0 z-20 mb-2 min-w-[170px] rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-1.5 shadow-sm">
                          <button
                            onClick={handleOpenAttachmentPicker}
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] transition hover:bg-[var(--surface)]"
                          >
                            <ImagePlus size={15} className="text-[var(--text-muted)]" />
                            <span>Add photo</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                  {isDictating ? (
                    <button
                      onClick={handleToggleDictation}
                      disabled={!hasKey || isStreaming}
                      className="flex h-8 items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 text-sm font-medium text-rose-400 transition hover:bg-rose-500/15 disabled:opacity-40"
                      title="Stop dictation"
                    >
                      <span className="h-2.5 w-2.5 rounded-full bg-current animate-pulse" />
                      <MicOff size={14} />
                      <span>Stop</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleToggleDictation}
                      disabled={!hasKey || isStreaming || !speechSupported}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-faint)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] disabled:opacity-40"
                      title={
                        !speechSupported
                          ? 'Dictation is not supported in this browser'
                          : isStreaming
                            ? 'Wait for the current response to finish'
                            : 'Start dictation'
                      }
                    >
                      <Mic size={15} />
                    </button>
                  )}
                  {isStreaming ? (
                    <button
                      onClick={stopStreaming}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-500 text-white transition hover:bg-rose-600"
                      title="Stop response"
                    >
                      <Square size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={(!input.trim() && !pendingImages.length) || !hasKey}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--text-primary)] text-[var(--bg-app)] transition hover:scale-[1.02] disabled:opacity-40"
                      title="Send message"
                    >
                      <Send size={15} />
                    </button>
                  )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {pendingDeleteChat && (
          <div
            className="absolute inset-0 z-[80] flex items-center justify-center bg-black/35 px-4"
            onClick={() => setPendingDeleteChat(null)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-4 shadow-[0_18px_50px_rgba(15,23,42,0.12)]"
              onClick={e => e.stopPropagation()}
            >
              <p className="text-sm font-semibold text-[var(--text-primary)]">Delete chat?</p>
              <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                This will permanently remove “{pendingDeleteChat.title}”.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingDeleteChat(null)}
                  className="rounded-xl border border-[var(--border-soft)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteChat}
                  className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-600"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );

  if (mode === 'floating') {
    return createPortal(panelContent, document.body);
  }

  return panelContent;
}

// --- Welcome Screen ---
function WelcomeScreen({
  userId,
  hasKey,
  onUsePrompt,
  onOpenAcademicPlanner,
  onOpenDeadlineImport,
}: {
  userId: string;
  hasKey: boolean;
  onUsePrompt: (prompt: string) => void;
  onOpenAcademicPlanner?: (deadlineIds?: string[]) => void;
  onOpenDeadlineImport?: () => void;
}) {
  const badgeOptions = ['✨', '🎓', '🪄', '🧠', '🌿', '👑', '🦆', '🌶️', '🪐', '🍅', '🎀', '🧢'];
  const [showPersonalize, setShowPersonalize] = useState(false);
  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  const [personality, setPersonality] = useState<AIPersonality>(() => loadAIPersonality(userId));
  const starterPrompts = [
    { icon: CopyPlus, label: 'Build a study plan', prompt: 'Build me a study plan for my next few deadlines and keep it realistic.' },
    { icon: FileSearch, label: 'Analyze my workload', prompt: 'Analyze my current workload and tell me what needs attention first.' },
    { icon: CheckCircle2, label: 'Create prep tasks', prompt: 'Create prep tasks for my upcoming exams and assignments.' },
    { icon: Sparkles, label: 'Personalize your AI', prompt: 'Help me personalize how you plan my workload and schedule.' },
  ];

  useEffect(() => {
    setPersonality(loadAIPersonality(userId));
  }, [userId]);

  const handleSavePersonality = () => {
    saveAIPersonality(userId, personality);
    setPersonalizeOpen(false);
  };

  const handleResetPersonality = () => {
    const resetValue = { name: '', badge: '✨' };
    setPersonality(resetValue);
    resetAIPersonality(userId);
  };

  return (
    <>
    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
      <div
        className="group relative mb-5"
        onMouseEnter={() => setShowPersonalize(true)}
        onMouseLeave={() => setShowPersonalize(false)}
      >
        <button
          type="button"
          onClick={() => setPersonalizeOpen(true)}
          className="relative flex h-16 w-16 items-center justify-center rounded-full bg-[var(--surface)] shadow-sm transition hover:shadow-[0_12px_28px_rgba(15,23,42,0.12)]"
        >
          <Sparkles size={26} className="text-[var(--text-primary)]" />
          <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-xl leading-none">{personality.badge}</span>
        </button>
        <button
          type="button"
          onClick={() => setPersonalizeOpen(true)}
          className={cn(
            'absolute left-full top-1/2 ml-3 -translate-y-1/2 whitespace-nowrap rounded-full border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition',
            showPersonalize ? 'opacity-100 translate-x-0' : 'pointer-events-none opacity-0 -translate-x-1'
          )}
        >
          <span className="inline-flex items-center gap-2">
            <Wand2 size={14} />
            Personalize
          </span>
        </button>
      </div>
      <h3 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">How can I help you today?</h3>
      <p className="mt-3 max-w-md text-sm leading-6 text-[var(--text-muted)]">
        {hasKey
          ? 'Use AI to turn your deadlines, calendar, and messy school input into an actionable plan you can actually follow.'
          : 'Add your Google Gemini API key above to get started — it\'s free!'}
      </p>
      {hasKey && (
        <div className="mt-8 grid w-full max-w-md gap-2.5 text-left">
          <button
            type="button"
            onClick={onOpenDeadlineImport}
            className="group flex w-full items-center gap-3 rounded-[20px] border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 text-left text-sm text-[var(--text-secondary)] transition duration-150 hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)] transition group-hover:scale-105">
              <Upload size={15} />
            </span>
            <div>
              <div className="font-medium">Import your deadlines</div>
              <div className="text-xs text-[var(--text-faint)]">Start with a screenshot, syllabus, email, or CSV</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => onOpenAcademicPlanner?.()}
            className="group flex w-full items-center gap-3 rounded-[20px] border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 text-left text-sm text-[var(--text-secondary)] transition duration-150 hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)] transition group-hover:scale-105">
              <CalendarDays size={15} />
            </span>
            <span className="font-medium">Open the study planner</span>
          </button>
          {starterPrompts.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => onUsePrompt(item.prompt)}
                className="group flex w-full items-center gap-3 rounded-[20px] border border-transparent px-4 py-3 text-left text-sm text-[var(--text-secondary)] transition duration-150 hover:-translate-y-0.5 hover:border-[var(--border-soft)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)] hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text-muted)] transition group-hover:text-[var(--text-primary)]">
                  <Icon size={15} />
                </span>
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
    {personalizeOpen && (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 px-4" onClick={() => setPersonalizeOpen(false)}>
        <div
          className="w-full max-w-2xl rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)]"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Personalize your AI</h3>
            <button
              type="button"
              onClick={() => setPersonalizeOpen(false)}
              className="rounded-full p-2 text-[var(--text-faint)] transition hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
            >
              <Minus size={16} />
            </button>
          </div>

          <div className="mt-8 flex flex-col items-center">
            <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm">
              <Sparkles size={38} className="text-[var(--text-primary)]" />
              <span className="absolute -top-3 text-3xl leading-none">{personality.badge}</span>
            </div>
            <input
              value={personality.name}
              onChange={e => setPersonality(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Enter a name"
              className="mt-6 w-full max-w-xs rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 text-center text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>

          <div className="mt-8 rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Instructions</p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">Add guidance for how your AI should behave. We can wire the real behavior next.</p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
              >
                Add instructions
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-4">
            <div className="grid grid-cols-6 gap-3">
              {badgeOptions.map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPersonality(prev => ({ ...prev, badge: option }))}
                  className={cn(
                    'flex h-14 items-center justify-center rounded-2xl border text-2xl transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]',
                    personality.badge === option
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]/30'
                      : 'border-[var(--border-soft)] bg-[var(--surface-elevated)] hover:border-[var(--border-strong)]'
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={handleResetPersonality}
              className="rounded-xl border border-[var(--border-soft)] px-5 py-2.5 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface)]"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={handleSavePersonality}
              className="rounded-xl px-5 py-2.5 text-sm font-medium bg-[var(--accent-strong)] text-[var(--accent-contrast)]"
             
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function normalizeDeleteCandidate(value: string) {
  return value.trim().toLowerCase();
}

function stripTrailingCourseTag(value: string) {
  return value.replace(/\s*\[[^\]]+\]\s*$/, '').trim();
}

function normalizeCalendarCandidate(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*\((primary|read-only|read only|owner)\)\s*$/i, '')
    .replace(/\s+calendar$/i, '')
    .trim();
}

function getCalendarSummaryById(calendars: GoogleCalendarListItem[], calendarId?: string) {
  if (!calendarId) return '';
  return calendars.find(calendar => calendar.id === calendarId)?.summary ?? '';
}

function resolveCalendarTarget(
  rawCalendar: string | undefined,
  calendars: GoogleCalendarListItem[],
  selectedCalendarId: string,
) {
  const normalizedCalendar = normalizeCalendarCandidate(rawCalendar ?? '');
  if (normalizedCalendar) {
    const matched = calendars.find(calendar => normalizeCalendarCandidate(calendar.summary) === normalizedCalendar);
    if (matched) return matched;
  }

  if (selectedCalendarId) {
    const selected = calendars.find(calendar => calendar.id === selectedCalendarId);
    if (selected) return selected;
  }

  return calendars[0] ?? null;
}

function parseClockTime(value?: string) {
  if (!value) return null;
  const trimmed = value.trim();
  const ampmMatch = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (ampmMatch) {
    let hours = Number(ampmMatch[1]);
    const minutes = Number(ampmMatch[2] || '0');
    const meridiem = ampmMatch[3].toUpperCase();
    if (hours === 12) hours = 0;
    if (meridiem === 'PM') hours += 12;
    return { hours, minutes };
  }

  const twentyFourMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourMatch) {
    return { hours: Number(twentyFourMatch[1]), minutes: Number(twentyFourMatch[2]) };
  }

  return null;
}

/** Format a time string (e.g. "14:30", "2:30 PM") into pretty 12-hour format like "2:30 PM" */
function formatTimePretty(value?: string): string | null {
  const parsed = parseClockTime(value);
  if (!parsed) return null;
  const h = parsed.hours % 12 || 12;
  const m = parsed.minutes.toString().padStart(2, '0');
  const ampm = parsed.hours < 12 ? 'AM' : 'PM';
  return m === '00' ? `${h} ${ampm}` : `${h}:${m} ${ampm}`;
}

/** Build a time range string like "2:30 PM – 4:00 PM" from start/end time values */
function formatTimeRange(start?: string, end?: string): string {
  const s = formatTimePretty(start);
  const e = formatTimePretty(end);
  if (s && e) return `${s} – ${e}`;
  if (s) return s;
  return '';
}

function toTwentyFourHourKey(value?: string) {
  const parsed = parseClockTime(value);
  if (!parsed) return '';
  return `${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}`;
}

function buildLocalDateTimeString(dateKey: string, timeKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hours, minutes] = timeKey.split(':').map(Number);
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
  const offsetMins = String(absoluteOffset % 60).padStart(2, '0');

  return `${dateKey}T${timeKey}:00${sign}${offsetHours}:${offsetMins}`;
}

function getEventStartKey(event: GoogleCalendarEvent) {
  if (!event.start?.dateTime) return '';
  const date = new Date(event.start.dateTime);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function parseFlag(value?: string) {
  if (!value) return false;
  return ['true', 'yes', 'y', '1'].includes(value.trim().toLowerCase());
}

function addOneDay(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeDateParts(year: number, month: number, day: number) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return '';
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseNaturalDateKey(value: string) {
  const cleaned = value
    .trim()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');

  const monthLookup: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };

  const monthFirst = cleaned.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/i);
  if (monthFirst) {
    const month = monthLookup[monthFirst[1].toLowerCase()];
    const day = Number(monthFirst[2]);
    const year = monthFirst[3] ? Number(monthFirst[3]) : new Date().getFullYear();
    if (month) return normalizeDateParts(year, month, day);
  }

  const dayFirst = cleaned.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/i);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = monthLookup[dayFirst[2].toLowerCase()];
    const year = dayFirst[3] ? Number(dayFirst[3]) : new Date().getFullYear();
    if (month) return normalizeDateParts(year, month, day);
  }

  return '';
}

function resolveCalendarDateInput(value?: string) {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  const absoluteMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (absoluteMatch) return trimmed;

  const today = new Date();
  const normalized = trimmed.toLowerCase();
  if (normalized === 'today') {
    return formatDateKey(today);
  }
  if (normalized === 'tomorrow') {
    return formatDateKey(addDays(today, 1));
  }

  const naturalDate = parseNaturalDateKey(trimmed);
  if (naturalDate) return naturalDate;

  return '';
}

function buildCalendarEventPayload(row: ImportBlock['rows'][number], mode: 'create' | 'update') {
  const date = resolveCalendarDateInput(mode === 'update' ? (row.newDate || row.dueDate || '') : (row.dueDate || ''));
  const startTime = mode === 'update' ? (row.newStartTime || row.startTime || '') : (row.startTime || '');
  const endTime = mode === 'update' ? (row.newEndTime || row.endTime || '') : (row.endTime || '');
  const isAllDay = mode === 'update'
    ? row.newAllDay !== undefined
      ? parseFlag(row.newAllDay)
      : parseFlag(row.allDay)
    : parseFlag(row.allDay);
  const rawSummary = mode === 'update' ? (row.newTitle || row.title) : row.title;
  const summary = buildCalendarSummary(row, rawSummary);
  const description = mode === 'update' ? (row.newDescription ?? row.description) : row.description;
  const location = mode === 'update' ? (row.newLocation ?? row.location) : row.location;

  if (!summary || !date) return null;

  if (isAllDay) {
    return {
      summary,
      ...(description ? { description } : {}),
      ...(location ? { location } : {}),
      start: { date },
      end: { date: addOneDay(date) },
    } satisfies NewGoogleCalendarEvent;
  }

  if (!startTime || !endTime) return null;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const startKey = toTwentyFourHourKey(startTime);
  const endKey = toTwentyFourHourKey(endTime);
  if (!startKey || !endKey) return null;

  return {
    summary,
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    start: { dateTime: buildLocalDateTimeString(date, startKey), timeZone },
    end: { dateTime: buildLocalDateTimeString(date, endKey), timeZone },
  } satisfies NewGoogleCalendarEvent;
}

function buildCalendarSummary(row: ParsedImportRow, rawSummary?: string) {
  const summary = (rawSummary ?? '').trim();
  if (!summary) return '';

  if (!/^study block\b/i.test(summary)) return summary;

  const context = extractStudyBlockContext(row) || normalizeStudyBlockContext(summary);
  return context || summary;
}

function extractStudyBlockContext(row: ParsedImportRow) {
  const normalizedCourse = normalizeStudyBlockContext(row.course ?? '');
  const contextualSummary = normalizeStudyBlockContext(row.title);
  const candidates = [
    row.description,
    row.notes,
    contextualSummary,
    row.calendar,
  ]
    .map(value => (value ?? '').trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const cleaned = normalizeStudyBlockContext(candidate);
    if (!cleaned) continue;
    if (normalizedCourse && !cleaned.toLowerCase().includes(normalizedCourse.toLowerCase())) {
      return `${normalizedCourse} ${cleaned}`.replace(/\s+/g, ' ').trim();
    }
    return cleaned;
  }

  return normalizedCourse;
}

function normalizeStudyBlockContext(value: string) {
  let cleaned = value
    .replace(/^(study|studying|study block|prep|prepping|prepare|preparing)\s*[:\-–—]?\s*(for\s+)?/i, '')
    .replace(/^(review|reviewing)\s+/i, '')
    .replace(/\b(on|under|in)\s+(the\s+)?(study blocks?|exam prep|personal|primary)\b/gi, '')
    .replace(/\b(calendar|class)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = cleaned.replace(/^[-:()\s]+|[-:()\s]+$/g, '').trim();
  if (!cleaned) return '';

  const lowered = cleaned.toLowerCase();
  if (['study blocks', 'exam prep', 'personal', 'primary'].includes(lowered)) return '';

  return cleaned;
}

function buildStudyBlockMatchKeys(value: string) {
  const normalized = normalizeStudyBlockContext(value);
  if (!normalized) return [] as string[];

  const strippedCourse = normalized
    .replace(/^[A-Za-z]{2,6}\s*\d{3,4}[A-Za-z]?\s+/i, '')
    .trim();

  return Array.from(new Set(
    [normalized, strippedCourse]
      .map(entry => entry.trim().toLowerCase())
      .filter(Boolean)
  ));
}

function extractLeadingCourseCode(value: string) {
  const match = value.match(/^([A-Za-z]{2,6}\s*\d{3,4}[A-Za-z]?)/);
  return match?.[1]?.replace(/\s+/g, ' ').trim();
}

function extractStudyTargetPhrase(value: string) {
  const match = value.match(/\b(exam|demo|quiz|lab|project|homework|hw|webwork)\s*([a-z0-9.-]+)?\b/i);
  if (!match) return '';
  return [match[1], match[2]].filter(Boolean).join(' ').trim();
}

function resolveStudyBlockLinkedDeadline(
  row: ParsedImportRow,
  summary: string,
  deadlines: Deadline[],
  projects: Project[],
) {
  const course = row.course ?? extractCourseFromTitle(row.title) ?? extractLeadingCourseCode(summary) ?? extractLeadingCourseCode(row.title);
  if (!course) return null;

  const normalizedCourse = normalizeDeleteCandidate(course);
  const sameCourseDeadlines = deadlines.filter(deadline => {
    const projectName = deadline.projectId
      ? projects.find(project => project.id === deadline.projectId)?.name ?? ''
      : '';
    return normalizeDeleteCandidate(projectName) === normalizedCourse;
  });
  if (sameCourseDeadlines.length === 0) return null;

  const targetPhrase = extractStudyTargetPhrase(summary) || extractStudyTargetPhrase(row.title);
  const normalizedTarget = normalizeDeleteCandidate(targetPhrase);
  const datedMatches = sameCourseDeadlines
    .filter(deadline => normalizedTarget ? normalizeDeleteCandidate(deadline.title).includes(normalizedTarget) : true)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const preferred = datedMatches.find(deadline => ['exam', 'quiz', 'project', 'lab'].includes((deadline.type || '').toLowerCase()))
    ?? datedMatches[0];

  if (!preferred) return null;

  return {
    deadline: preferred,
    course,
  };
}

function attachAcademicStudyMetadata(
  payload: NewGoogleCalendarEvent,
  row: ParsedImportRow,
  linkedTarget: ReturnType<typeof resolveStudyBlockLinkedDeadline> | null,
  existingDescription?: string | null,
) {
  const payloadMetadata = parseAcademicPlanMetadata(payload.description ?? null);
  const existingMetadata = parseAcademicPlanMetadata(existingDescription ?? null);
  const metadata = payloadMetadata ?? existingMetadata;
  const plainDescription = payloadMetadata ? '' : (payload.description ?? '').trim();

  if (!linkedTarget && !metadata) {
    return payload;
  }

  const deadlineId = linkedTarget?.deadline.id ?? metadata?.deadlineId;
  const deadlineTitle = linkedTarget?.deadline.title ?? metadata?.deadlineTitle;
  const deadlineDate = linkedTarget?.deadline.dueDate ?? metadata?.deadlineDate;
  const deadlineType = linkedTarget?.deadline.type ?? metadata?.deadlineType;

  if (!deadlineId || !deadlineTitle || !deadlineDate || !deadlineType) {
    return payload;
  }

  return {
    ...payload,
    description: buildAcademicPlanMetadataDescription({
      deadlineId,
      deadlineTitle,
      deadlineDate,
      deadlineType,
      courseName: linkedTarget?.course ?? metadata?.courseName ?? row.course ?? null,
      explanation: metadata?.explanation ?? 'AI-suggested study block linked from chat.',
      notes: plainDescription || row.notes?.trim() || row.description?.trim() || metadata?.notes || null,
      origin: metadata?.origin ?? 'ai-assisted',
    }),
  } satisfies NewGoogleCalendarEvent;
}

function getTimedPayloadDetails(payload: NewGoogleCalendarEvent) {
  if (!('dateTime' in payload.start) || !('dateTime' in payload.end)) return null;

  const start = new Date(payload.start.dateTime);
  const end = new Date(payload.end.dateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const dateKey = formatDateKey(start);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const durationMinutes = Math.max(0, endMinutes - startMinutes);

  if (durationMinutes <= 0) return null;

  return {
    dateKey,
    startMinutes,
    endMinutes,
    durationMinutes,
    timeZone: payload.start.timeZone ?? payload.end.timeZone,
  };
}

function getTimedEventDetails(event: GoogleCalendarEvent) {
  if (!event.start?.dateTime || !event.end?.dateTime) return null;

  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const dateKey = formatDateKey(start);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();

  if (endMinutes <= startMinutes) return null;

  return { dateKey, startMinutes, endMinutes };
}

function isStudyBlockAutoScheduleTarget(row: ParsedImportRow, calendarSummary?: string) {
  return isStudyBlockLikeEvent({
    title: row.title,
    calendarSummary: normalizeCalendarSummary(calendarSummary ?? row.calendar ?? ''),
    description: row.description,
  });
}

function findStudyBlockReplacementCandidate(
  events: GoogleCalendarEvent[],
  calendars: GoogleCalendarListItem[],
  calendarId: string,
  row: ParsedImportRow,
  payload: NewGoogleCalendarEvent,
) {
  const payloadDateKey = 'date' in payload.start ? payload.start.date : payload.start.dateTime?.slice(0, 10);
  if (!payloadDateKey) return null;
  const payloadTimedDetails = getTimedPayloadDetails(payload);

  const targetContext =
    normalizeStudyBlockContext(payload.summary) ||
    normalizeStudyBlockContext(row.title) ||
    extractStudyBlockContext(row);
  if (!targetContext) return null;
  const targetKeys = buildStudyBlockMatchKeys(targetContext);

  const matches = events.filter(event => {
    if (event.calendarId !== calendarId) return false;
    if (getEventDateKey(event) !== payloadDateKey) return false;

    const eventCalendarSummary = event.calendarSummary || getCalendarSummaryById(calendars, event.calendarId);
    if (!isStudyBlockAutoScheduleTarget({ ...row, calendar: eventCalendarSummary || row.calendar }, eventCalendarSummary)) {
      return false;
    }

    const eventKeys = buildStudyBlockMatchKeys(event.summary || '');
    return targetKeys.some(key => eventKeys.includes(key));
  });

  if (matches.length <= 1) return matches[0] ?? null;

  if (payloadTimedDetails) {
    const exactTimeMatches = matches.filter(event => {
      const eventTimedDetails = getTimedEventDetails(event);
      if (!eventTimedDetails) return false;
      return (
        eventTimedDetails.startMinutes === payloadTimedDetails.startMinutes &&
        eventTimedDetails.endMinutes === payloadTimedDetails.endMinutes
      );
    });

    if (exactTimeMatches.length === 1) {
      return exactTimeMatches[0];
    }
  }

  return null;
}

function findFreeSlotForDuration(
  events: GoogleCalendarEvent[],
  dateKey: string,
  durationMinutes: number,
  preferredStartMinutes: number,
  minStartMinutes: number,
  scoreStudySlot?: (dateKey: string, startMinutes: number, durationMinutes: number) => number,
) : SlotSearchResult | null {
  const DEFAULT_DAY_START = 6 * 60;
  const DAY_START = Math.min(DEFAULT_DAY_START, minStartMinutes, preferredStartMinutes);
  const DAY_END = 23 * 60 + 59;

  const mergedBusy = events
    .map(getTimedEventDetails)
    .filter((details): details is NonNullable<ReturnType<typeof getTimedEventDetails>> => Boolean(details))
    .filter(details => details.dateKey === dateKey)
    .map(details => ({
      start: Math.max(DAY_START, details.startMinutes),
      end: Math.min(DAY_END, details.endMinutes),
    }))
    .filter(details => details.end > details.start)
    .sort((a, b) => a.start - b.start)
    .reduce<Array<{ start: number; end: number }>>((acc, current) => {
      const previous = acc[acc.length - 1];
      if (!previous || current.start > previous.end) {
        acc.push({ ...current });
      } else {
        previous.end = Math.max(previous.end, current.end);
      }
      return acc;
    }, []);

  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = DAY_START;
  for (const busy of mergedBusy) {
    if (busy.start > cursor) {
      gaps.push({ start: cursor, end: busy.start });
    }
    cursor = Math.max(cursor, busy.end);
  }
  if (cursor < DAY_END) {
    gaps.push({ start: cursor, end: DAY_END });
  }

  const step = 15;
  const candidates: Array<{ startMinutes: number; endMinutes: number; score: number; distance: number }> = [];

  for (const gap of gaps) {
    if (gap.end - gap.start < durationMinutes) continue;

    const gapStart = Math.max(gap.start, DAY_START, minStartMinutes);
    const gapEnd = Math.min(gap.end, DAY_END);
    let start = gapStart;
    while (start + durationMinutes <= gapEnd) {
      const preferenceScore = scoreStudySlot?.(dateKey, start, durationMinutes) ?? 0;
      const distance = Math.abs(start - preferredStartMinutes);
      const proximityBonus = Math.max(0, 1 - distance / 240);
      candidates.push({
        startMinutes: start,
        endMinutes: start + durationMinutes,
        score: preferenceScore + proximityBonus,
        distance,
      });
      start += step;
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.startMinutes - b.startMinutes;
  });

  const topCandidates = candidates.slice(0, 8).map(candidate => ({
    startMinutes: candidate.startMinutes,
    endMinutes: candidate.endMinutes,
    score: candidate.score,
    distance: candidate.distance,
  }));

  return {
    startMinutes: candidates[0].startMinutes,
    endMinutes: candidates[0].endMinutes,
    candidates: topCandidates,
  };
}

function maybeResolveCalendarCreateConflict(
  row: ParsedImportRow,
  payload: NewGoogleCalendarEvent,
  events: GoogleCalendarEvent[],
  calendarSummary?: string,
  scoreStudySlot?: (dateKey: string, startMinutes: number, durationMinutes: number) => number,
) : SlotResolutionResult {
  const timedDetails = getTimedPayloadDetails(payload);
  if (!timedDetails) {
    return {
      payload,
      adjusted: false,
      dateKey: null,
      requestedStartMinutes: null,
      durationMinutes: null,
      selectedStartMinutes: null,
      candidates: [],
      exactTimeConflict: false,
    };
  }

  const nextSlot = findFreeSlotForDuration(
    events,
    timedDetails.dateKey,
    timedDetails.durationMinutes,
    timedDetails.startMinutes,
    timedDetails.startMinutes,
    scoreStudySlot,
  );

  if (isStudyBlockAutoScheduleTarget(row, calendarSummary)) {
    if (!nextSlot) {
      return {
        payload: null,
        adjusted: false,
        dateKey: timedDetails.dateKey,
        requestedStartMinutes: timedDetails.startMinutes,
        durationMinutes: timedDetails.durationMinutes,
        selectedStartMinutes: null,
        candidates: [],
      };
    }

    if (
      nextSlot.startMinutes === timedDetails.startMinutes &&
      nextSlot.endMinutes === timedDetails.endMinutes
    ) {
      return {
        payload,
        adjusted: false,
        dateKey: timedDetails.dateKey,
        requestedStartMinutes: timedDetails.startMinutes,
        durationMinutes: timedDetails.durationMinutes,
        selectedStartMinutes: timedDetails.startMinutes,
        candidates: nextSlot.candidates,
        exactTimeConflict: false,
      };
    }

    return {
      payload: null,
      adjusted: false,
      dateKey: timedDetails.dateKey,
      requestedStartMinutes: timedDetails.startMinutes,
      durationMinutes: timedDetails.durationMinutes,
      selectedStartMinutes: nextSlot.startMinutes,
      candidates: nextSlot.candidates,
      exactTimeConflict: true,
    };
  }

  return {
    payload,
    adjusted: false,
    dateKey: timedDetails.dateKey,
    requestedStartMinutes: timedDetails.startMinutes,
    durationMinutes: timedDetails.durationMinutes,
    selectedStartMinutes: timedDetails.startMinutes,
    candidates: nextSlot?.candidates ?? [],
    exactTimeConflict: false,
  };
}

function maybeResolveCalendarUpdateConflict(
  _row: ParsedImportRow,
  payload: NewGoogleCalendarEvent,
  _events: GoogleCalendarEvent[],
  _existingEvent: GoogleCalendarEvent,
  _calendarSummary?: string,
  _scoreStudySlot?: (dateKey: string, startMinutes: number, durationMinutes: number) => number,
) {
  // For updates, always respect the exact time the AI specified.
  // The user and AI already agreed on the time — don't silently reschedule.
  const timedDetails = getTimedPayloadDetails(payload);
  return {
    payload,
    adjusted: false,
    dateKey: timedDetails?.dateKey ?? null,
    requestedStartMinutes: timedDetails?.startMinutes ?? null,
    durationMinutes: timedDetails?.durationMinutes ?? null,
    selectedStartMinutes: timedDetails?.startMinutes ?? null,
    candidates: [],
  } as SlotResolutionResult;
}

function buildSyntheticCalendarEvent(
  payload: NewGoogleCalendarEvent,
  calendarId: string,
  calendarSummary?: string,
  calendarColor?: string,
): GoogleCalendarEvent {
  return {
    id: `synthetic-${Math.random().toString(36).slice(2, 10)}`,
    summary: payload.summary,
    description: payload.description,
    location: payload.location,
    start: payload.start,
    end: payload.end,
    calendarId,
    calendarSummary,
    calendarColor,
  };
}

function mergeCalendarEventsByIdentity(...groups: GoogleCalendarEvent[][]) {
  const merged = new Map<string, GoogleCalendarEvent>();

  for (const group of groups) {
    for (const event of group) {
      const key = `${event.calendarId || ''}:${event.id || ''}:${getEventDateKey(event) || ''}:${normalizeDeleteCandidate(event.summary || '')}:${getEventStartKey(event) || ''}`;
      if (!merged.has(key)) {
        merged.set(key, event);
      }
    }
  }

  return [...merged.values()].sort((a, b) => {
    const aTime = a.start?.dateTime || a.start?.date || '';
    const bTime = b.start?.dateTime || b.start?.date || '';
    return aTime.localeCompare(bTime);
  });
}

function collectCalendarRangeRows(block: ImportBlock) {
  if (!['calendar-create', 'calendar-update', 'calendar-delete'].includes(block.type)) {
    return [] as ParsedImportRow[];
  }
  return block.rows;
}

function buildCalendarLookupRange(rows: ParsedImportRow[]) {
  const dates = rows.flatMap(row => [row.dueDate, row.newDate]).filter((value): value is string => Boolean(value));
  if (dates.length === 0) {
    const rangeStart = new Date();
    const rangeEnd = new Date();
    rangeStart.setDate(rangeStart.getDate() - 90);
    rangeEnd.setDate(rangeEnd.getDate() + 180);
    rangeStart.setHours(0, 0, 0, 0);
    rangeEnd.setHours(0, 0, 0, 0);
    return {
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
    };
  }

  const sorted = [...dates].sort();
  const minDate = sorted[0];
  const maxDate = sorted[sorted.length - 1];
  const rangeStart = new Date(`${minDate}T00:00:00`);
  const rangeEnd = new Date(`${maxDate}T00:00:00`);
  rangeEnd.setDate(rangeEnd.getDate() + 1);
  rangeStart.setHours(0, 0, 0, 0);
  rangeEnd.setHours(0, 0, 0, 0);

  return {
    timeMin: rangeStart.toISOString(),
    timeMax: rangeEnd.toISOString(),
  };
}

function collectCalendarLookupIds(
  rows: ParsedImportRow[],
  calendars: GoogleCalendarListItem[],
  selectedCalendarId: string,
) {
  const resolvedIds = rows.flatMap(row => [row.calendar, row.newCalendar])
    .filter((value): value is string => Boolean(value?.trim()))
    .map(name => calendars.find(item => normalizeCalendarCandidate(item.summary) === normalizeCalendarCandidate(name))?.id)
    .filter((value): value is string => Boolean(value));

  if (resolvedIds.length > 0) {
    return Array.from(new Set(resolvedIds));
  }

  return selectedCalendarId ? [selectedCalendarId] : [];
}

function matchTaskCandidates<T extends { title: string }>(tasks: T[], rawTitle: string): T[] {
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

function resolvePreferredTaskCandidates(tasks: Task[], rawTitle: string, recentTasks: Task[] = []) {
  const matches = matchTaskCandidates(tasks, rawTitle);
  if (matches.length <= 1) return matches;

  const recentMatches = matchTaskCandidates(recentTasks, rawTitle);
  if (recentMatches.length !== 1) return matches;

  const recentMatch = recentMatches[0];
  return matches.filter(task => task.id === recentMatch.id);
}

function resolveSubtaskParentCandidates(tasks: Task[], projects: Project[], rawTitle: string, course?: string) {
  const title = rawTitle.trim();
  if (!title) return [];

  const taskPool = buildEntityScopedTaskPool(tasks, projects, title, course);
  const normalizedTitle = normalizeDeleteCandidate(title);
  const exactMatches = taskPool.filter(task => normalizeDeleteCandidate(task.title) === normalizedTitle);
  if (exactMatches.length > 0) return exactMatches;

  return matchTaskCandidates(taskPool, title);
}

function matchSubtaskCandidates(task: Task, rawTitle: string) {
  const normalizedTitle = normalizeDeleteCandidate(rawTitle);
  return task.subtasks.filter(subtask => normalizeDeleteCandidate(subtask.title) === normalizedTitle);
}

function getSourceUserMessageForBlock(messages: ChatMessage[], blockKey: string) {
  const messageId = blockKey.split(':block:')[0];
  const assistantIndex = messages.findIndex(message => message.id === messageId);
  if (assistantIndex <= 0) return '';

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate.role === 'user') {
      return candidate.content ?? '';
    }
  }

  return '';
}

function inferExplicitEntityTarget(prompt: string): 'task' | 'deadline' | 'both' | 'unknown' {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return 'unknown';

  const mentionsTask = /\btask\b|\btasks\b|\btodo\b|\btodos\b|\bin tasks\b/.test(normalized);
  const mentionsDeadline = /\bdeadline\b|\bdeadlines\b|\bin deadlines\b|\bdeadline tracker\b/.test(normalized);
  const negativeWord = "(?:not|don't|dont|do not|without|keep)";

  const prefersTask =
    /\bonly\s+(?:the\s+)?tasks?\b/.test(normalized) ||
    new RegExp(`\\b(delete|remove|update|mark)\\b.*\\btasks?\\b.*\\b${negativeWord}\\b.*\\bdeadlines?\\b`).test(normalized) ||
    new RegExp(`\\b${negativeWord}\\b.*\\bdeadlines?\\b`).test(normalized);
  const prefersDeadline =
    /\bonly\s+(?:the\s+)?deadlines?\b/.test(normalized) ||
    new RegExp(`\\b(delete|remove|update|mark)\\b.*\\bdeadlines?\\b.*\\b${negativeWord}\\b.*\\btasks?\\b`).test(normalized) ||
    new RegExp(`\\b${negativeWord}\\b.*\\btasks?\\b`).test(normalized);

  if (prefersTask && !prefersDeadline) return 'task';
  if (prefersDeadline && !prefersTask) return 'deadline';

  if (mentionsTask && mentionsDeadline) return 'both';
  if (mentionsTask) return 'task';
  if (mentionsDeadline) return 'deadline';
  return 'unknown';
}

function buildEntityScopedTaskPool(tasks: Task[], projects: Project[], rawTitle: string, course?: string) {
  const resolvedCourse = course ?? extractCourseFromTitle(rawTitle);
  return resolvedCourse
    ? filterTasksByCourse(tasks, projects, resolvedCourse)
    : tasks;
}

function matchCalendarCandidatesWithOptions(
  events: GoogleCalendarEvent[],
  calendars: GoogleCalendarListItem[],
  row: ParsedImportRow,
  options?: { useDate?: boolean; useStart?: boolean },
) {
  const normalizedTitle = normalizeDeleteCandidate(row.title);
  const strippedTitle = normalizeDeleteCandidate(stripTrailingCourseTag(row.title));
  const normalizedCalendar = row.calendar ? normalizeCalendarCandidate(row.calendar) : '';
  const normalizedDate = options?.useDate === false ? '' : row.dueDate?.trim() ?? '';
  const normalizedStart = options?.useStart === false ? '' : toTwentyFourHourKey(row.startTime);

  return events.filter(event => {
    const eventTitle = normalizeDeleteCandidate(event.summary || '');
    const strippedEventTitle = normalizeDeleteCandidate(stripTrailingCourseTag(event.summary || ''));
    if (
      eventTitle !== normalizedTitle &&
      strippedEventTitle !== normalizedTitle &&
      eventTitle !== strippedTitle &&
      strippedEventTitle !== strippedTitle
    ) {
      return false;
    }

    if (normalizedCalendar) {
      const calendarSummary = event.calendarSummary || calendars.find(calendar => calendar.id === event.calendarId)?.summary || '';
      if (normalizeCalendarCandidate(calendarSummary) !== normalizedCalendar) {
        return false;
      }
    }

    if (normalizedDate && getEventDateKey(event) !== normalizedDate) {
      return false;
    }

    // Skip time comparison for all-day events — they don't have start times
    const isAllDay = !!(event.start?.date && !event.start?.dateTime);
    if (normalizedStart && !isAllDay && getEventStartKey(event) !== normalizedStart) {
      return false;
    }

    return true;
  });
}

function matchCalendarCandidates(
  events: GoogleCalendarEvent[],
  calendars: GoogleCalendarListItem[],
  row: ParsedImportRow,
) {
  return matchCalendarCandidatesWithOptions(events, calendars, row, { useDate: true, useStart: true });
}

function resolvePreferredCalendarCandidates(
  events: GoogleCalendarEvent[],
  calendars: GoogleCalendarListItem[],
  row: ParsedImportRow,
) {
  const strategies: Array<{ useDate: boolean; useStart: boolean }> = [
    { useDate: true, useStart: true },
    { useDate: true, useStart: false },
    { useDate: false, useStart: false },
  ];

  let lastMatches: GoogleCalendarEvent[] = [];

  for (const strategy of strategies) {
    const matches = matchCalendarCandidatesWithOptions(events, calendars, row, strategy);
    if (matches.length === 1) {
      return matches;
    }
    if (matches.length > 1) {
      // Multiple matches at this strategy level — don't give up yet.
      // If a stricter strategy (with date+start) found 0 matches but a
      // looser one found multiple, try to pick the closest match by date.
      if (row.dueDate) {
        const onDate = matches.filter(e => getEventDateKey(e) === row.dueDate?.trim());
        if (onDate.length === 1) return onDate;
      }
      // If there's a start time, try to narrow by closest start time
      if (row.startTime) {
        const targetStart = toTwentyFourHourKey(row.startTime);
        if (targetStart) {
          const withStart = matches.filter(e => getEventStartKey(e) === targetStart);
          if (withStart.length === 1) return withStart;
        }
      }
      // Still ambiguous — return the most recently updated / first match on the target date
      lastMatches = matches;
      continue;
    }
    lastMatches = matches;
  }

  return lastMatches;
}

function resolveCalendarDeleteCandidates(
  events: GoogleCalendarEvent[],
  calendars: GoogleCalendarListItem[],
  selectedCalendarId: string,
  row: ParsedImportRow,
  recentTargets: RecentCalendarTarget[] = [],
) {
  const strictMatches = matchCalendarCandidates(events, calendars, row);
  if (strictMatches.length <= 1) {
    if (strictMatches.length > 0) return strictMatches;
  } else {
    return strictMatches;
  }

  const resolvedMatches = resolvePreferredCalendarCandidates(events, calendars, row);
  if (resolvedMatches.length <= 1) {
    if (resolvedMatches.length > 0) return resolvedMatches;
  } else {
    return resolvedMatches;
  }

  const normalizedTitle = normalizeDeleteCandidate(stripTrailingCourseTag(row.title));
  const normalizedCalendar = row.calendar ? normalizeCalendarCandidate(row.calendar) : '';
  const selectedCalendarSummary = getCalendarSummaryById(calendars, selectedCalendarId);
  const normalizedSelectedCalendar = normalizeCalendarCandidate(selectedCalendarSummary);
  const canUseSelectedCalendarFallback =
    Boolean(selectedCalendarId) && (!normalizedCalendar || normalizedCalendar === normalizedSelectedCalendar);
  const preferredMatches = canUseSelectedCalendarFallback
    ? resolvedMatches.filter(event => {
      const eventCalendarSummary = event.calendarSummary || getCalendarSummaryById(calendars, event.calendarId);
      return (
        event.calendarId === selectedCalendarId ||
        normalizeCalendarCandidate(eventCalendarSummary) === normalizedSelectedCalendar
      );
    })
    : resolvedMatches;

  const preferredDateKeys = new Set(preferredMatches.map(getEventDateKey));
  const isUndatedDelete = !row.dueDate && !row.startTime;
  const isStudyBlockLikeDelete = isStudyBlockAutoScheduleTarget(row);

  const canDeleteDuplicatesTogether = preferredMatches.length > 0 && preferredMatches.every(event => {
    const eventTitle = normalizeDeleteCandidate(stripTrailingCourseTag(event.summary || ''));
    const eventCalendarSummary = event.calendarSummary || getCalendarSummaryById(calendars, event.calendarId);
    const eventCalendar = normalizeCalendarCandidate(
      eventCalendarSummary ?? ''
    );

    return (
      eventTitle === normalizedTitle &&
      (!normalizedCalendar || eventCalendar === normalizedCalendar)
    );
  }) && (preferredDateKeys.size === 1 || (isUndatedDelete && isStudyBlockLikeDelete));

  if (canDeleteDuplicatesTogether) {
    return preferredMatches;
  }

  const recentTargetMatches = recentTargets
    .filter(target => {
      const targetTitle = normalizeDeleteCandidate(stripTrailingCourseTag(target.title));
      const targetCalendar = normalizeCalendarCandidate(target.calendarSummary ?? '');
      return (
        targetTitle === normalizedTitle &&
        (!normalizedCalendar || targetCalendar === normalizedCalendar)
      );
    })
    .flatMap(target => events.filter(event => {
      if (target.id && target.calendarId) {
        return event.id === target.id && event.calendarId === target.calendarId;
      }
      const eventTitle = normalizeDeleteCandidate(stripTrailingCourseTag(event.summary || ''));
      const eventCalendarSummary = event.calendarSummary || getCalendarSummaryById(calendars, event.calendarId);
      const eventCalendar = normalizeCalendarCandidate(eventCalendarSummary ?? '');
      const eventDateKey = getEventDateKey(event) || '';
      const eventStartKey = getEventStartKey(event) || '';
      return (
        eventTitle === normalizedTitle &&
        (!normalizedCalendar || eventCalendar === normalizedCalendar) &&
        (!target.dateKey || target.dateKey === eventDateKey) &&
        (!target.startKey || target.startKey === eventStartKey)
      );
    }));

  if (recentTargetMatches.length > 0) {
    return mergeCalendarEventsByIdentity(recentTargetMatches);
  }

  return resolvedMatches.length === 1 ? resolvedMatches : [];
}

function buildCalendarDeleteRequestKey(row: ParsedImportRow) {
  return [
    normalizeDeleteCandidate(stripTrailingCourseTag(row.title || '')),
    normalizeCalendarCandidate(row.calendar || ''),
    row.dueDate?.trim() || '',
    toTwentyFourHourKey(row.startTime) || '',
  ].join('::');
}

/** Extracts a course name from a trailing bracket tag like "Study for Exam [CS 1332]" → "CS 1332" */
function extractCourseFromTitle(title: string): string | undefined {
  const match = title.match(/\[([^\]]+)\]\s*$/);
  return match?.[1]?.trim() || undefined;
}

/** Normalize for fuzzy course matching: lowercase, trim, collapse spaces, strip common separators */
function normalizeCourse(value: string) {
  return value.trim().toLowerCase().replace(/[\s\-_]+/g, '');
}

/** Narrows a task list to only those belonging to a project whose name matches the given course */
function filterTasksByCourse(tasks: Task[], projects: Project[], course: string): Task[] {
  const normalizedCourse = normalizeCourse(course);
  // Try exact-ish match first, then fuzzy (no spaces) match
  let matchingProjectIds = new Set(
    projects
      .filter(p => normalizeDeleteCandidate(p.name) === normalizeDeleteCandidate(course))
      .map(p => p.id)
  );
  // Fuzzy fallback: "CS1332" matches "CS 1332", "cs-1332", etc.
  if (matchingProjectIds.size === 0) {
    matchingProjectIds = new Set(
      projects
        .filter(p => normalizeCourse(p.name) === normalizedCourse)
        .map(p => p.id)
    );
  }
  if (matchingProjectIds.size === 0) return tasks; // course truly not found, don't filter
  return tasks.filter(t => t.projectId && matchingProjectIds.has(t.projectId));
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
function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        // Headings
        h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-bold first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-1.5 mt-2.5 text-sm font-bold first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>,
        // Paragraphs
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        // Bold & italic
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        // Lists
        ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,
        // Code blocks
        code: ({ className, children, ...props }) => {
          const match = /language-(\w+)/.exec(className || '');
          const codeString = String(children).replace(/\n$/, '');
          if (match) {
            return (
              <div className="my-2 overflow-hidden rounded-lg">
                <div className="flex items-center justify-between bg-[#282c34] px-3 py-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-white/40">{match[1]}</span>
                  <button
                    type="button"
                    className="text-[10px] text-white/40 transition hover:text-white/70"
                    onClick={() => navigator.clipboard.writeText(codeString)}
                  >
                    Copy
                  </button>
                </div>
                <SyntaxHighlighter
                  style={oneDark}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{ margin: 0, borderRadius: 0, fontSize: '12px' }}
                >
                  {codeString}
                </SyntaxHighlighter>
              </div>
            );
          }
          return (
            <code className="rounded bg-black/20 px-1 py-0.5 text-xs" {...props}>
              {children}
            </code>
          );
        },
        // Tables
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-white/5">{children}</thead>,
        th: ({ children }) => <th className="whitespace-nowrap px-3 py-1.5 text-left font-semibold">{children}</th>,
        td: ({ children }) => <td className="whitespace-nowrap border-t border-white/5 px-3 py-1.5">{children}</td>,
        // Blockquotes
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-[var(--accent)] pl-3 text-[var(--text-muted)]">
            {children}
          </blockquote>
        ),
        // Horizontal rules
        hr: () => <hr className="my-3 border-white/10" />,
        // Links
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline decoration-[var(--accent)]/30 hover:decoration-[var(--accent)]">
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function getPriorUserPrompt(messages: ChatMessage[], index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = messages[cursor];
    if (candidate?.role === 'user' && candidate.content.trim()) {
      return candidate.content.trim();
    }
  }
  return '';
}

const THINKING_WORDS = [
  'Pondering',
  'Musing',
  'Noodling',
  'Ruminating',
  'Cogitating',
  'Simmering',
  'Percolating',
  'Contemplating',
  'Deliberating',
  'Brewing',
  'Conjuring',
  'Marinating',
  'Puzzling',
  'Scheming',
  'Unfurling',
  'Wrangling',
  'Distilling',
  'Calibrating',
  'Mulling',
  'Churning',
];

function pickThinkingWord(exclude?: string) {
  const pool = exclude ? THINKING_WORDS.filter(word => word !== exclude) : THINKING_WORDS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function AssistantThinkingBubble(_: { promptContext: string }) {
  const [visible, setVisible] = useState(false);
  const [word, setWord] = useState(() => pickThinkingWord());

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 180);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    const interval = window.setInterval(() => {
      setWord(prev => pickThinkingWord(prev));
    }, 2200);
    return () => window.clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="flex items-center gap-2 py-1.5 text-sm text-[var(--text-secondary)]">
      <Sparkles size={14} className="ai-thinking-icon text-[var(--accent)]" />
      <span key={word} className="ai-thinking-word font-medium">
        {word}
        <span className="ai-thinking-dots">…</span>
      </span>
    </div>
  );
}

function MessageBubble({
  userId,
  message,
  promptContext,
  tasks,
  deadlines,
  projects,
  calendarEvents,
  calendarCalendars,
  selectedCalendarId,
  importedBlocks,
  onImport,
  isStreaming,
}: {
  userId: string;
  message: ChatMessage;
  promptContext: string;
  tasks: Task[];
  deadlines: Deadline[];
  projects: Project[];
  calendarEvents: GoogleCalendarEvent[];
  calendarCalendars: GoogleCalendarListItem[];
  selectedCalendarId: string;
  importedBlocks: Set<string>;
  onImport: (block: ImportBlock, key: string, options?: ImportExecutionOptions) => Promise<number>;
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
            <div className="rounded-xl rounded-br-sm bg-[var(--accent)] px-3.5 py-2 text-sm text-[var(--accent-contrast)]">
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Assistant message: parse import blocks safely
  const content = message.content ?? '';
  const isThinkingPlaceholder = content.trim() === '*Thinking...*';
  let importBlocks: ImportBlock[] = [];
  let segments: Segment[] = [];
  try {
    if (content && !isThinkingPlaceholder) {
      importBlocks = parseImportBlocks(content);
      segments = renderContentWithBlocks(content, importBlocks);
    }
  } catch (err) {
    console.error('[AIPanel] Render error:', err);
    segments = [{ type: 'text' as const, content: content.trim() }];
    importBlocks = [];
  }
  // Ensure no undefined/null segments
  segments = segments.filter((s): s is Segment => s != null && typeof s === 'object' && 'type' in s);

  // While streaming, strip any trailing incomplete import/csv code block from the last text segment
  // so the raw fenced block doesn't flash before the closing ``` arrives.
  if (isStreaming && segments.length > 0) {
    const last = segments[segments.length - 1];
    if (last.type === 'text' && last.content) {
      const partialFence = last.content.search(/```(?:import:[^\n]*|csv)\n[\s\S]*$/);
      if (partialFence !== -1) {
        const trimmed = last.content.slice(0, partialFence).trim();
        if (trimmed) {
          segments[segments.length - 1] = { type: 'text', content: trimmed };
        } else {
          segments.pop();
        }
      }
    }
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%]">
        <div className="space-y-2">
          {isThinkingPlaceholder ? (
            <AssistantThinkingBubble promptContext={promptContext} />
          ) : null}
          {segments.map((segment, i) => {
            if (!segment?.type) return null;
            if (segment.type === 'text') {
              return segment.content ? (
                <div key={i} className="rounded-xl rounded-bl-sm bg-[var(--surface-muted)] px-3.5 py-2 text-sm text-[var(--text-primary)]">
                  <MarkdownContent content={segment.content} />
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
              userId={userId}
              blocks={importBlocks}
              tasks={tasks}
              deadlines={deadlines}
              projects={projects}
              calendarEvents={calendarEvents}
              calendarCalendars={calendarCalendars}
              selectedCalendarId={selectedCalendarId}
              importedBlocks={importedBlocks}
              onImport={onImport}
            />
          )}
          {isStreaming && !isThinkingPlaceholder && (
            <div className="ml-1 mt-1 h-1 w-24 overflow-hidden rounded-full bg-[var(--border-soft)]/75">
              <div className="ai-thinking-progress h-full w-full rounded-full" />
            </div>
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
  const blockRegex = /```(import:(?:tasks|deadlines|delete-tasks|update-tasks|deadline-links|calendar-create|calendar-update|calendar-delete|habits-create|habits-complete|habits-delete|(?:delete-)?subtasks:[^\n]*)|csv)\n([\s\S]*?)```/g;
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
  userId,
  blocks,
  tasks,
  deadlines,
  projects,
  calendarEvents,
  calendarCalendars,
  selectedCalendarId,
  importedBlocks,
  onImport,
}: {
  messageId: string;
  userId: string;
  blocks: ImportBlock[];
  tasks: Task[];
  deadlines: Deadline[];
  projects: Project[];
  calendarEvents: GoogleCalendarEvent[];
  calendarCalendars: GoogleCalendarListItem[];
  selectedCalendarId: string;
  importedBlocks: Set<string>;
  onImport: (block: ImportBlock, key: string, options?: ImportExecutionOptions) => Promise<number>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [applying, setApplying] = useState(false);
  const [optimisticDone, setOptimisticDone] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, number>>({});
  const frozenDeleteGroupsRef = useRef<{ label: string; resolvedTitle: string; valid: boolean }[] | null>(null);
  const frozenCalendarGroupsRef = useRef<{
    creates: { label: string; valid: boolean; mode: 'create' | 'update' }[];
    updates: { label: string; valid: boolean; reason: string }[];
    deletes: { label: string; valid: boolean; reason: string }[];
    deleteTargetsByKey: Record<string, GoogleCalendarEvent[]>;
  } | null>(null);

  const isValidImportBlock = useCallback((block: unknown): block is ImportBlock => {
    return !!block && typeof block === 'object' && typeof (block as ImportBlock).type === 'string' && Array.isArray((block as ImportBlock).rows);
  }, []);

  const safeBlocks = useMemo(
    () => (Array.isArray(blocks) ? blocks : []).filter(isValidImportBlock),
    [blocks, isValidImportBlock],
  );

  const entries = useMemo(() => (
    safeBlocks.map((block, index) => ({
      block,
      key: `${messageId}:block:${index}`,
      imported: importedBlocks.has(`${messageId}:block:${index}`),
      order:
        block.type === 'tasks' ? 0 :
        block.type === 'deadlines' ? 1 :
        block.type === 'calendar-create' ? 2 :
        block.type === 'calendar-update' ? 3 :
        block.type === 'subtasks' ? 4 :
        block.type === 'deadline-links' ? 5 :
        block.type === 'delete-subtasks' ? 6 :
        block.type === 'calendar-delete' ? 7 : 8,
    }))
  ), [safeBlocks, importedBlocks, messageId]);

  const pendingEntries = entries.filter(entry => !entry.imported);
  const hasDeletes = entries.some(entry => entry.block?.type === 'delete-tasks' || entry.block?.type === 'delete-subtasks' || entry.block?.type === 'calendar-delete');
  const allDone = optimisticDone || entries.every(entry => entry.imported);

  const summary = useMemo(() => {
    const counts = {
      tasks: 0,
      updates: 0,
      deadlines: 0,
      subtasks: 0,
      subtaskDeletes: 0,
      links: 0,
      deletes: 0,
      calendarCreates: 0,
      calendarUpdates: 0,
      calendarDeletes: 0,
      habitsCreate: 0,
      habitsComplete: 0,
      habitsDelete: 0,
    };

    for (const block of safeBlocks) {
      if (block.type === 'tasks') counts.tasks += block.rows.length;
      if (block.type === 'update-tasks') counts.updates += block.rows.length;
      if (block.type === 'deadlines') counts.deadlines += block.rows.length;
      if (block.type === 'subtasks') counts.subtasks += block.rows.length;
      if (block.type === 'delete-subtasks') counts.subtaskDeletes += block.rows.length;
      if (block.type === 'deadline-links') counts.links += block.rows.length;
      if (block.type === 'delete-tasks') counts.deletes += block.rows.length;
      if (block.type === 'calendar-update') counts.calendarUpdates += block.rows.length;
      if (block.type === 'calendar-delete') counts.calendarDeletes += block.rows.length;
      if (block.type === 'habits-create') counts.habitsCreate += block.rows.length;
      if (block.type === 'habits-complete') counts.habitsComplete += block.rows.length;
      if (block.type === 'habits-delete') counts.habitsDelete += block.rows.length;
    }

    const createLikeCalendarRows = safeBlocks
      .filter(block => block.type === 'calendar-create')
      .flatMap(block => block.rows);

    for (const row of createLikeCalendarRows) {
      const payload = buildCalendarEventPayload(row, 'create');
      const targetCalendar = resolveCalendarTarget(row.calendar, calendarCalendars, selectedCalendarId);
      const replacementMatch = payload && isStudyBlockAutoScheduleTarget(row, targetCalendar?.summary ?? row.calendar)
        ? findStudyBlockReplacementCandidate(
            calendarEvents,
            calendarCalendars,
            selectedCalendarId,
            row,
            payload,
          )
        : null;
      if (replacementMatch) counts.calendarUpdates += 1;
      else counts.calendarCreates += 1;
    }

    return counts;
  }, [calendarCalendars, calendarEvents, safeBlocks, selectedCalendarId]);

  const previewTasks = useMemo(() => (
    [
      ...tasks,
      ...safeBlocks
        .filter(block => block.type === 'tasks')
        .flatMap(block => block.rows.map(row => ({ title: row.title }))),
    ]
  ), [safeBlocks, tasks]);

  const linkGroups = useMemo(() => {
    return safeBlocks
      .filter(block => block.type === 'deadline-links')
      .flatMap(block =>
        block.rows.map(row => {
          const taskTitle = row.taskTitle ?? '';
          // Use course-aware matching in preview, same as actual import:
          // 1. Extract course from bracket tag if not explicitly provided
          // 2. Try exact title match first before stripped matching
          const linkCourse = row.course ?? extractCourseFromTitle(taskTitle);
          const normalizedTitle = normalizeDeleteCandidate(taskTitle);
          // Exact match check (no stripping) — avoids false ambiguity between
          // "Exam 3 [INTA 1200]" and "Exam 3 [MATH 2550]"
          const exactMatches = previewTasks.filter(
            t => normalizeDeleteCandidate(t.title) === normalizedTitle
          );
          const taskMatches = exactMatches.length === 1
            ? exactMatches
            : linkCourse
              ? matchTaskCandidates(
                  filterTasksByCourse(tasks, projects, linkCourse),
                  taskTitle,
                )
              : matchTaskCandidates(previewTasks, taskTitle);
          const deadlineMatches = matchDeadlineCandidates(deadlines, projects, row.title, row.course);
          const valid = taskMatches.length === 1 && deadlineMatches.length === 1;
          return {
            label: `${taskTitle || 'Unknown task'} → ${row.title}`,
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
  }, [safeBlocks, deadlines, previewTasks, tasks, projects]);

  const deleteGroups = useMemo(() => {
    return safeBlocks
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
  }, [safeBlocks, tasks]);

  const subtaskGroups = useMemo(() => {
    return safeBlocks
      .filter(block => block.type === 'subtasks')
      .flatMap(block =>
        block.rows.map(row => {
          const parentTitle = (row.taskTitle ?? block.parentTaskTitle ?? '').trim();
          const parentCourse = row.course ?? extractCourseFromTitle(parentTitle);
          const matches = resolveSubtaskParentCandidates(tasks, projects, parentTitle, parentCourse);
          return {
            label: `${row.title} → ${parentTitle || 'missing parent task'}`,
            valid: matches.length === 1,
            reason: matches.length === 0 ? 'parent not found' : matches.length > 1 ? 'parent ambiguous' : '',
          };
        }),
      );
  }, [projects, safeBlocks, tasks]);

  const subtaskDeleteGroups = useMemo(() => {
    return safeBlocks
      .filter(block => block.type === 'delete-subtasks')
      .flatMap(block =>
        block.rows.map(row => {
          const parentTitle = (row.taskTitle ?? block.parentTaskTitle ?? '').trim();
          const parentCourse = row.course ?? extractCourseFromTitle(parentTitle);
          const parentMatches = resolveSubtaskParentCandidates(tasks, projects, parentTitle, parentCourse);
          const subtaskMatches = parentMatches.length === 1 ? matchSubtaskCandidates(parentMatches[0], row.title) : [];
          return {
            label: `${row.title} ← ${parentTitle || 'missing parent task'}`,
            valid: parentMatches.length === 1 && subtaskMatches.length === 1,
            reason:
              parentMatches.length === 0 ? 'parent not found' :
              parentMatches.length > 1 ? 'parent ambiguous' :
              subtaskMatches.length === 0 ? 'subtask not found' :
              subtaskMatches.length > 1 ? 'subtask ambiguous' : '',
          };
        }),
      );
  }, [projects, safeBlocks, tasks]);

  const calendarGroups = useMemo(() => {
    const recentCalendarTargets = loadRecentCalendarTargets(userId);
    const creates = safeBlocks
      .filter(block => block.type === 'calendar-create')
      .flatMap(block => block.rows.map(row => {
        const payload = buildCalendarEventPayload(row, 'create');
        const targetCalendar = resolveCalendarTarget(row.calendar, calendarCalendars, selectedCalendarId);
        const replacementMatch = payload && isStudyBlockAutoScheduleTarget(row, targetCalendar?.summary ?? row.calendar)
          ? findStudyBlockReplacementCandidate(
              calendarEvents,
              calendarCalendars,
              selectedCalendarId,
              row,
              payload,
            )
          : null;
        const timeRange = formatTimeRange(row.startTime, row.endTime);
        return {
          label: `${row.title}${row.calendar ? ` · ${row.calendar}` : ''}${row.dueDate ? ` · ${row.dueDate}` : ''}${timeRange ? ` · ${timeRange}` : ''}`,
          valid: Boolean(payload),
          mode: replacementMatch ? 'update' as const : 'create' as const,
        };
      }));

    const updates = safeBlocks
      .filter(block => block.type === 'calendar-update')
      .flatMap(block => block.rows.map(row => {
        const matches = resolvePreferredCalendarCandidates(calendarEvents, calendarCalendars, row);
        const valid = matches.length === 1 && Boolean(buildCalendarEventPayload(row, 'update'));
        const newTimeRange = formatTimeRange(row.newStartTime, row.newEndTime);
        return {
          label: `${row.title}${row.calendar ? ` · ${row.calendar}` : ''}${newTimeRange ? ` · → ${newTimeRange}` : ''}`,
          valid,
          reason: valid
            ? ''
            : matches.length === 0
              ? 'event not found'
              : matches.length > 1
                ? 'event ambiguous'
                : 'replacement details incomplete',
        };
      }));

    const deleteTargetsByKey: Record<string, GoogleCalendarEvent[]> = {};

    const deletes = safeBlocks
      .filter(block => block.type === 'calendar-delete')
      .flatMap(block => {
        const seen = new Set<string>();
        return block.rows.flatMap(row => {
          const deleteRequestKey = buildCalendarDeleteRequestKey(row);
          if (seen.has(deleteRequestKey)) {
            return [];
          }
          seen.add(deleteRequestKey);

          const matches = resolveCalendarDeleteCandidates(calendarEvents, calendarCalendars, selectedCalendarId, row, recentCalendarTargets);
          deleteTargetsByKey[deleteRequestKey] = matches;
          const delTime = formatTimePretty(row.startTime);
          return [{
            label: `${row.title}${row.calendar ? ` · ${row.calendar}` : ''}${row.dueDate ? ` · ${row.dueDate}` : ''}${delTime ? ` · ${delTime}` : ''}${matches.length > 1 ? ` · ${matches.length} matches` : ''}`,
            valid: matches.length > 0,
            reason: matches.length === 0 ? 'event not found' : '',
          }];
        });
      });

    return { creates, updates, deletes, deleteTargetsByKey };
  }, [calendarCalendars, calendarEvents, safeBlocks, selectedCalendarId, userId]);

  const resultSummary = useMemo(() => {
    const total = Object.values(results).reduce((sum, count) => sum + count, 0);
    return total;
  }, [results]);
  const hasRecordedResults = Object.keys(results).length > 0;

  const requestedSummaryTotal = useMemo(() => (
    summary.tasks +
    summary.updates +
    summary.deadlines +
    summary.subtasks +
    summary.subtaskDeletes +
    summary.links +
    summary.deletes +
    summary.calendarCreates +
    summary.calendarUpdates +
    summary.calendarDeletes +
    summary.habitsCreate +
    summary.habitsComplete +
    summary.habitsDelete
  ), [summary]);

  const handleApply = () => {
    if (hasDeletes && !confirmDelete) {
      setExpanded(true);
      setConfirmDelete(true);
      return;
    }

    // Snapshot delete/calendar groups before applying so the preview doesn't re-evaluate after deletion
    frozenDeleteGroupsRef.current = deleteGroups;
    frozenCalendarGroupsRef.current = calendarGroups;

    setApplying(true);
    setActionError(null);

    const sortedEntries = [...pendingEntries].sort((a, b) => a.order - b.order);

    (async () => {
      try {
        const nextResults: Record<string, number> = {};
        for (const entry of sortedEntries) {
          const count = await onImport(
            entry.block,
            entry.key,
            entry.block.type === 'calendar-delete'
              ? { frozenCalendarDeleteTargets: (frozenCalendarGroupsRef.current ?? calendarGroups).deleteTargetsByKey }
              : undefined,
          );
          nextResults[entry.key] = count;
        }
        setResults(prev => ({ ...prev, ...nextResults }));
        setOptimisticDone(true);
        setConfirmDelete(false);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Could not apply these actions.');
      } finally {
        setApplying(false);
      }
    })();
  };

  const primaryLabel = allDone
    ? 'Applied'
    : hasDeletes
      ? (confirmDelete ? 'Approve actions' : 'Review deletes')
      : 'Apply';

  return (
    <div className="rounded-xl border border-[var(--accent)]/28 bg-[var(--accent-soft)]/25 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg',
              allDone
                ? 'bg-emerald-500/20'
                : applying
                  ? 'bg-[var(--accent-strong)]/20'
                  : 'bg-[var(--accent-soft)]',
            )}>
              {allDone ? (
                <Check size={14} className="text-emerald-400" />
              ) : (
                <Sparkles size={14} className={cn(applying ? 'text-[var(--accent-strong)]' : 'text-[var(--accent)]')} />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {allDone
                  ? `Applied ${hasRecordedResults ? resultSummary : requestedSummaryTotal} changes`
                  : applying
                    ? 'Applying changes…'
                    : 'Suggested changes'}
              </p>
              <p className="text-[11px] text-[var(--text-faint)]">
                {[summary.tasks ? `${summary.tasks} task${summary.tasks === 1 ? '' : 's'}` : null,
                  summary.updates ? `${summary.updates} update${summary.updates === 1 ? '' : 's'}` : null,
                  summary.deadlines ? `${summary.deadlines} deadline${summary.deadlines === 1 ? '' : 's'}` : null,
                  summary.calendarCreates ? `${summary.calendarCreates} event create${summary.calendarCreates === 1 ? '' : 's'}` : null,
                  summary.calendarUpdates ? `${summary.calendarUpdates} event update${summary.calendarUpdates === 1 ? '' : 's'}` : null,
                  summary.calendarDeletes ? `${summary.calendarDeletes} event delete${summary.calendarDeletes === 1 ? '' : 's'}` : null,
                  summary.subtasks ? `${summary.subtasks} subtask${summary.subtasks === 1 ? '' : 's'}` : null,
                  summary.subtaskDeletes ? `${summary.subtaskDeletes} subtask delete${summary.subtaskDeletes === 1 ? '' : 's'}` : null,
                  summary.links ? `${summary.links} link${summary.links === 1 ? '' : 's'}` : null,
                  summary.deletes ? `${summary.deletes} delete${summary.deletes === 1 ? '' : 's'}` : null,
                  summary.habitsCreate ? `${summary.habitsCreate} routine${summary.habitsCreate === 1 ? '' : 's'}` : null,
                  summary.habitsComplete ? `${summary.habitsComplete} routine${summary.habitsComplete === 1 ? '' : 's'} done` : null,
                  summary.habitsDelete ? `${summary.habitsDelete} routine delete${summary.habitsDelete === 1 ? '' : 's'}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </div>
        </div>
        {!allDone && (
          <div className="flex shrink-0 items-center gap-2">
            {confirmDelete && (
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface)]"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleApply}
              disabled={applying}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-60',
                confirmDelete
                  ? 'bg-rose-500 text-white'
                  : 'bg-[var(--accent-strong)] text-[var(--accent-contrast)]',
              )}
              style={confirmDelete ? undefined : { backgroundColor: 'var(--accent-strong)' }}
            >
              {applying ? 'Applying…' : primaryLabel}
            </button>
          </div>
        )}
      </div>

      {actionError && (
        <p className="mt-3 text-[11px] font-medium text-rose-300">{actionError}</p>
      )}

      <button
        onClick={() => setExpanded(prev => !prev)}
        className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--text-faint)] hover:text-[var(--text-muted)]"
      >
        <ChevronDown size={12} className={cn('transition', expanded && 'rotate-180')} />
        {expanded ? 'Hide details' : 'Show details'}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {summary.tasks > 0 && (
            <ActionSection
              label="Tasks"
              tone="default"
              items={safeBlocks.filter(block => block.type === 'tasks').flatMap(block => block.rows.map(row => {
                const parts = [row.title];
                if (row.dueDate) parts.push(`due ${row.dueDate}`);
                if (row.priority && row.priority !== 'medium') parts.push(row.priority);
                if (row.status && row.status !== 'todo') parts.push(row.status);
                if (row.course) parts.push(row.course);
                return parts.join(' · ');
              }))}
            />
          )}
          {summary.updates > 0 && (
            <ActionSection
              label="Updates"
              tone="success"
              items={safeBlocks.filter(block => block.type === 'update-tasks').flatMap(block => block.rows.map(row => {
                const changes: string[] = [];
                if (row.dueDate) changes.push(`due ${row.dueDate}`);
                if (row.priority) changes.push(`priority: ${row.priority}`);
                if (row.status) changes.push(`status: ${row.status}`);
                if (row.description) changes.push('description updated');
                if (row.recurrence) changes.push(`repeat: ${row.recurrence}`);
                const taskPool = buildEntityScopedTaskPool(tasks, projects, row.title, row.course);
                const collidesWithDeadline =
                  matchTaskCandidates(taskPool, row.title).length === 1 &&
                  matchDeadlineCandidates(deadlines, projects, row.title, row.course).length === 1;
                const label = changes.length > 0 ? `${row.title} → ${changes.join(', ')}` : row.title;
                return collidesWithDeadline ? `${label} · also matches a deadline` : label;
              }))}
            />
          )}
          {summary.subtasks > 0 && (
            <ActionSection
              label="Subtasks"
              tone="default"
              items={subtaskGroups.map(group => (
                group.valid ? group.label : `${group.label} · ${group.reason}`
              ))}
            />
          )}
          {summary.subtaskDeletes > 0 && (
            <ActionSection
              label="Delete subtasks"
              tone="warning"
              items={subtaskDeleteGroups.map(group => (
                group.valid ? group.label : `${group.label} · ${group.reason}`
              ))}
            />
          )}
          {summary.deadlines > 0 && (
            <ActionSection
              label="Deadlines"
              tone="default"
              items={safeBlocks.filter(block => block.type === 'deadlines').flatMap(block => block.rows.map(row => {
                const taskPool = buildEntityScopedTaskPool(tasks, projects, row.title, row.course);
                const collidesWithTask =
                  matchDeadlineCandidates(deadlines, projects, row.title, row.course).length === 1 &&
                  matchTaskCandidates(taskPool, row.title).length === 1;
                return collidesWithTask ? `${row.title} · also matches a task` : row.title;
              }))}
            />
          )}
          {summary.calendarCreates > 0 && (
            <ActionSection
              label="Create events"
              tone="default"
              items={(frozenCalendarGroupsRef.current ?? calendarGroups).creates
                .filter(group => group.mode === 'create')
                .map(group => group.valid ? group.label : `${group.label} · incomplete`)}
            />
          )}
          {summary.calendarUpdates > 0 && (
            <ActionSection
              label="Update events"
              tone="success"
              items={[
                ...(frozenCalendarGroupsRef.current ?? calendarGroups).creates
                  .filter(group => group.mode === 'update')
                  .map(group => group.valid ? group.label : `${group.label} · incomplete`),
                ...(frozenCalendarGroupsRef.current ?? calendarGroups).updates
                  .map(group => group.valid ? group.label : `${group.label} · ${group.reason}`),
              ]}
            />
          )}
          {summary.calendarDeletes > 0 && (
            <ActionSection
              label="Delete events"
              tone="warning"
              items={(frozenCalendarGroupsRef.current ?? calendarGroups).deletes.map(group => group.valid ? group.label : `${group.label} · ${group.reason}`)}
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
              items={(frozenDeleteGroupsRef.current ?? deleteGroups).map(group => group.valid ? group.resolvedTitle : `${group.label} · ambiguous`)}
            />
          )}
          {summary.habitsCreate > 0 && (
            <ActionSection
              label="New routines"
              tone="default"
              items={safeBlocks.filter(b => b.type === 'habits-create').flatMap(b => b.rows.map(r => `${r.title}${r.frequency && r.frequency !== 'daily' ? ` · ${r.frequency}` : ''}`))}
            />
          )}
          {summary.habitsComplete > 0 && (
            <ActionSection
              label="Mark routines done"
              tone="success"
              items={safeBlocks.filter(b => b.type === 'habits-complete').flatMap(b => b.rows.map(r => r.title))}
            />
          )}
          {summary.habitsDelete > 0 && (
            <ActionSection
              label="Delete routines"
              tone="warning"
              items={safeBlocks.filter(b => b.type === 'habits-delete').flatMap(b => b.rows.map(r => r.title))}
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
  const [open, setOpen] = useState(true);

  const toneClasses =
    tone === 'success'
      ? 'border-emerald-500/15 bg-emerald-500/8'
      : tone === 'warning'
        ? 'border-amber-500/20 bg-amber-500/10'
        : 'border-[var(--border-soft)] bg-[var(--surface)]/80';

  return (
    <div className={cn('rounded-lg border px-2.5 py-2', toneClasses)}>
      <button
        onClick={() => setOpen(prev => !prev)}
        className="flex w-full items-center justify-between gap-2"
      >
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-faint)]">
          {label} <span className="normal-case tracking-normal opacity-60">({items.length})</span>
        </p>
        <ChevronDown size={11} className={cn('text-[var(--text-faint)] transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 text-[11px] text-[var(--text-primary)]">
          {items.map((item, i) => (
            <p key={i}>{item}</p>
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
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3">
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
