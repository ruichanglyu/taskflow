import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Task, Deadline, Project, WorkoutPlan, WorkoutDayTemplate, Exercise, WorkoutDayExercise } from '../types';

export interface ImageAttachment {
  base64: string;      // data without prefix
  mimeType: string;    // e.g. "image/png"
  preview: string;     // data URL for display
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  images?: ImageAttachment[];
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ImportBlock {
  type: 'tasks' | 'deadlines' | 'subtasks' | 'delete-tasks' | 'deadline-links';
  raw: string;
  rows: ParsedImportRow[];
  imported?: boolean;
  parentTaskTitle?: string;  // for subtasks — the parent task to attach to
}

export interface ParsedImportRow {
  // Tasks
  title: string;
  course?: string;
  dueDate?: string;
  priority?: 'low' | 'medium' | 'high';
  description?: string;
  status?: string;
  recurrence?: string;
  // Deadlines
  type?: string;
  dueTime?: string;
  notes?: string;
  // Deadline links
  taskTitle?: string;
}

const KEY_STORAGE = 'taskflow_ai_key';

const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const GEMINI_MODEL_VISION = 'gemini-2.5-flash';  // lite model doesn't support images, use 2.5 flash for multimodal
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const CHAT_STORAGE = 'taskflow_ai_chats';
const ACTIVE_CHAT_STORAGE = 'taskflow_ai_active_chat';
const LEGACY_CHAT_STORAGE = 'taskflow_ai_chat';

export function getAPIKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setAPIKey(key: string) {
  localStorage.setItem(KEY_STORAGE, key);
}

export function removeAPIKey() {
  localStorage.removeItem(KEY_STORAGE);
}


function buildSystemPrompt(data: {
  tasks: Task[];
  deadlines: Deadline[];
  projects: Project[];
  plans: WorkoutPlan[];
  dayTemplates: WorkoutDayTemplate[];
  exercises: Exercise[];
  dayExercises: WorkoutDayExercise[];
}): string {
  const today = new Date().toISOString().split('T')[0];

  const activeTasks = data.tasks.filter(t => t.status !== 'done');
  const doneTasks = data.tasks.filter(t => t.status === 'done');
  const upcomingDeadlines = data.deadlines
    .filter(d => d.dueDate >= today && d.status !== 'done')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 20);
  const activePlan = data.plans.find(p => p.isActive);

  const tasksSummary = activeTasks.length > 0
    ? activeTasks.map(t => {
        const proj = t.projectId ? data.projects.find(p => p.id === t.projectId)?.name : null;
        return `- ${t.title}${proj ? ` [${proj}]` : ''}${t.dueDate ? ` (due ${t.dueDate})` : ''} [${t.priority}] [${t.status}]`;
      }).join('\n')
    : '(none)';

  const deadlinesSummary = upcomingDeadlines.length > 0
    ? upcomingDeadlines.map(d => {
        const proj = d.projectId ? data.projects.find(p => p.id === d.projectId)?.name : null;
        return `- ${d.title}${proj ? ` [${proj}]` : ''} — ${d.dueDate}${d.dueTime ? ' ' + d.dueTime : ''} (${d.type}) [${d.status}]`;
      }).join('\n')
    : '(none)';

  const coursesList = data.projects.length > 0
    ? data.projects.map(p => `- ${p.name}${p.description ? ': ' + p.description : ''}`).join('\n')
    : '(none)';

  let gymSummary = '(no active plan)';
  if (activePlan) {
    const days = data.dayTemplates.filter(d => d.planId === activePlan.id).sort((a, b) => a.position - b.position);
    gymSummary = `${activePlan.name} (${activePlan.daysPerWeek} days/week)\n` +
      days.map(day => {
        const exs = data.dayExercises.filter(de => de.workoutDayTemplateId === day.id);
        const exNames = exs.map(de => data.exercises.find(e => e.id === de.exerciseId)?.name ?? '?');
        return `  ${day.name}: ${exNames.join(', ') || '(empty)'}`;
      }).join('\n');
  }

  return `You are a personal AI assistant inside TaskFlow, a student life management app. Today is ${today}.

USER'S DATA:

COURSES (${data.projects.length}):
${coursesList}

ACTIVE TASKS (${activeTasks.length} active, ${doneTasks.length} done):
${tasksSummary}

UPCOMING DEADLINES (next 20):
${deadlinesSummary}

ACTIVE GYM PLAN:
${gymSummary}

CAPABILITIES:
You can have normal conversations AND help create/import data. When the user asks you to create tasks, deadlines, or workout plans, output them in special import blocks.

IMPORT BLOCK FORMAT:
To create tasks, output a fenced code block with language "import:tasks":
\`\`\`import:tasks
Task title | course: CourseName | due: YYYY-MM-DD | priority: high | description: optional text
Another task | course: CourseName | due: YYYY-MM-DD | priority: medium
\`\`\`

To create deadlines, output a fenced code block with language "import:deadlines":
\`\`\`import:deadlines
Deadline title | course: CourseName | date: YYYY-MM-DD | time: 11:59 PM | type: assignment | notes: optional
Another deadline | course: CourseName | date: YYYY-MM-DD | type: exam
\`\`\`

To create subtasks under an existing task, output a fenced code block with language "import:subtasks:Parent Task Title":
\`\`\`import:subtasks:Practice CS 1332 Demo 2
Review HashMap implementation
Review AVL Tree logic
Code Trace DaleDB
\`\`\`
The parent task title after "subtasks:" MUST exactly match an existing task title. Each line is just a subtask title (no pipes/fields needed). PREFER subtasks over separate tasks when the user wants to break down an existing task into smaller pieces.

To delete tasks, output a fenced code block with language "import:delete-tasks":
\`\`\`import:delete-tasks
Exact Task Title 1
Exact Task Title 2
\`\`\`
Each line must be the EXACT title of an existing task. Only include tasks the user explicitly asked to delete.

To link an existing task to an existing deadline, output a fenced code block with language "import:deadline-links":
\`\`\`import:deadline-links
Deadline title | task: Task Title | course: CourseName
Another deadline | task: Another Task Title
\`\`\`
Treat the deadline title and task title as lookup keys only. They do not create a link by themselves. Include \`course\` when there may be duplicates so the app can find the right deadline. The app will only create a real \`deadline_tasks\` link when it can find a unique deadline and a unique task.
If the user asks you to both create a task and link it to a deadline, you MUST output the \`import:tasks\` block first and then an \`import:deadline-links\` block that references the exact task title you just created.

FIELD RULES:
- Tasks: title (required), course, due (YYYY-MM-DD), priority (low/medium/high), description, status (todo/in-progress/done), recurrence (none/daily/weekly/monthly)
- Deadlines: title (required), course, date (YYYY-MM-DD required), time (HH:MM AM/PM), type (assignment/exam/quiz/lab/project/other), notes, status (not-started/in-progress/done/missed)
- Course names should match existing courses when possible

LINKING RULES:
- Never say a task is linked just because the task title or course name looks similar to a deadline.
- If the user asks to link a task to a deadline, use the \`deadline-links\` import block so the app can create the real \`deadline_tasks\` link.
- If you create a task that should be linked, include \`import:tasks\` and \`import:deadline-links\` in the same response.
- If you do not emit an \`import:deadline-links\` block, then you must not claim the task is linked.
- If the user asks to "link", "attach", "connect", or "match" a task to a deadline, do NOT fake it by renaming the task.
- When linking is requested, prefer a single \`import:deadline-links\` block and avoid creating a duplicate task unless the user explicitly asked for a new task.
- If the link cannot be created because the app cannot find a unique deadline and task, ask the user for the exact titles instead of pretending it worked.
- Only say a task is linked if the app explicitly created or updated a real \`deadline_tasks\` link.
\`\`\`import:deadline-links
Exam 3 [MATH 2550] | task: Study for MATH 2550 Exam 3 | course: MATH 2550
\`\`\`

You can also generate CSV files for manual import when asked. For deadlines CSV:
status,course,date,time,title,type,notes

For tasks CSV:
title,status,priority,course,due_date,description,recurrence

When generating CSVs, wrap them in a fenced code block with language "csv".

Be concise, helpful, and friendly. Use the user's actual data to answer questions about their schedule.`;
}

/** Parse import blocks from AI response */
export function parseImportBlocks(content: string): ImportBlock[] {
  const blocks: ImportBlock[] = [];
  const regex = /```import:(tasks|deadlines|delete-tasks|deadline-links|subtasks:([^\n]*))\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const rawType = match[1];
    const isSubtasks = rawType.startsWith('subtasks:');
    const type: ImportBlock['type'] = isSubtasks ? 'subtasks' : rawType as 'tasks' | 'deadlines' | 'delete-tasks' | 'deadline-links';
    const parentTaskTitle = isSubtasks ? (match[2]?.trim() || '') : undefined;
    const raw = match[3].trim();
    const lines = raw.split('\n').filter(l => l.trim());
    const rows: ParsedImportRow[] = [];

    for (const line of lines) {
      const parts = line.split('|').map(s => s.trim());
      const title = parts[0];
      if (!title) continue;

      const row: ParsedImportRow = { title };

      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        const colonIdx = part.indexOf(':');
        if (colonIdx === -1) continue;
        const key = part.slice(0, colonIdx).trim().toLowerCase();
        const val = part.slice(colonIdx + 1).trim();

        switch (key) {
          case 'course': row.course = val; break;
          case 'due':
          case 'date': row.dueDate = val; break;
          case 'priority': row.priority = val as 'low' | 'medium' | 'high'; break;
          case 'description': row.description = val; break;
          case 'status': row.status = val; break;
          case 'recurrence': row.recurrence = val; break;
          case 'type': row.type = val; break;
          case 'time': row.dueTime = val; break;
          case 'notes': row.notes = val; break;
          case 'task': row.taskTitle = val; break;
        }
      }

      rows.push(row);
    }

    blocks.push({ type, raw, rows, ...(parentTaskTitle !== undefined ? { parentTaskTitle } : {}) });
  }

  return blocks;
}

/* ── Gemini streaming ─────────────────────────────────────────────── */

async function streamGemini(
  key: string,
  systemPrompt: string,
  history: ChatMessage[],
  onUpdate: (text: string) => void,
  signal: AbortSignal,
) {
  // Check if any message has images — if so, use the vision-capable model
  const hasImages = history.some(m => m.images?.some(img => img.base64));
  const model = hasImages ? GEMINI_MODEL_VISION : GEMINI_MODEL;

  const contents = history.map(m => {
    const parts: Record<string, unknown>[] = [];
    // Add image parts first (if any)
    if (m.images?.length) {
      for (const img of m.images) {
        if (img.base64) {
          parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
        }
      }
    }
    // Add text part
    if (m.content) parts.push({ text: m.content });
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });

  const url = `${GEMINI_API_URL}/${model}:streamGenerateContent?alt=sse&key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');

    // Detect quota / billing errors and give a helpful message
    if (res.status === 429 || body.includes('quota') || body.includes('RESOURCE_EXHAUSTED')) {
      throw new Error(
        'Gemini API quota exceeded. This usually means the key was created through Google Cloud Console instead of AI Studio. ' +
        'Go to aistudio.google.com/apikey, click "Create API key in new project", and use that key instead.'
      );
    }
    if (res.status === 400 && body.includes('API_KEY_INVALID')) {
      throw new Error('Invalid API key. Make sure you copied the full key from aistudio.google.com/apikey.');
    }
    if (res.status === 403) {
      throw new Error(
        'API key not authorized. Make sure you generated it at aistudio.google.com/apikey (not Google Cloud Console).'
      );
    }

    throw new Error(`Gemini error ${res.status}: ${body.slice(0, 300)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json || json === '[DONE]') continue;
      try {
        const parsed = JSON.parse(json);
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          accumulated += text;
          onUpdate(accumulated);
        }
      } catch { /* skip malformed lines */ }
    }
  }
}

function loadLegacyMessages(): ChatMessage[] {
  try {
    const saved = localStorage.getItem(LEGACY_CHAT_STORAGE);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function makeChatTitle(messages: ChatMessage[], fallback = 'New chat') {
  const firstUser = messages.find(m => m.role === 'user' && m.content.trim());
  const source = firstUser?.content.trim().replace(/\s+/g, ' ') ?? '';
  if (!source) return fallback;
  return source.length > 42 ? `${source.slice(0, 39).trimEnd()}…` : source;
}

function stripAttachmentPayload(message: ChatMessage): ChatMessage {
  if (!message.images?.length) return message;
  return {
    ...message,
    images: message.images.map(img => ({
      base64: '',
      mimeType: img.mimeType,
      preview: '',
    })),
  };
}

function sanitizeThread(thread: ChatThread): ChatThread {
  return {
    ...thread,
    messages: thread.messages.map(stripAttachmentPayload),
  };
}

function makeNewThread(title = 'New chat'): ChatThread {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function loadSavedThreads(): ChatThread[] {
  try {
    const saved = localStorage.getItem(CHAT_STORAGE);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        const threads = parsed
          .map((item): ChatThread | null => {
            if (!item || typeof item !== 'object') return null;
            const id = typeof item.id === 'string' ? item.id : crypto.randomUUID();
            const title = typeof item.title === 'string' && item.title.trim() ? item.title : 'New chat';
            const createdAt = typeof item.createdAt === 'number' ? item.createdAt : Date.now();
            const updatedAt = typeof item.updatedAt === 'number' ? item.updatedAt : createdAt;
            const messages = Array.isArray(item.messages)
              ? item.messages
                  .map((message: ChatMessage) => {
                    if (!message || typeof message !== 'object') return null;
                    if (typeof message.id !== 'string' || typeof message.role !== 'string') return null;
                    return {
                      id: message.id,
                      role: message.role as ChatMessage['role'],
                      content: typeof message.content === 'string' ? message.content : '',
                      timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
                      images: Array.isArray(message.images)
                        ? message.images
                            .filter(Boolean)
                            .map((img: ImageAttachment) => ({
                              base64: typeof img?.base64 === 'string' ? img.base64 : '',
                              mimeType: typeof img?.mimeType === 'string' ? img.mimeType : 'image/png',
                              preview: typeof img?.preview === 'string' ? img.preview : '',
                            }))
                        : undefined,
                    } as ChatMessage;
                  })
                  .filter(Boolean) as ChatMessage[]
              : [];
            return { id, title, createdAt, updatedAt, messages };
          })
          .filter(Boolean) as ChatThread[];
        if (threads.length > 0) return threads;
      }
    }

    const legacyMessages = loadLegacyMessages();
    if (legacyMessages.length > 0) {
      const now = Date.now();
      return [{
        id: crypto.randomUUID(),
        title: makeChatTitle(legacyMessages),
        createdAt: legacyMessages[0]?.timestamp ?? now,
        updatedAt: legacyMessages[legacyMessages.length - 1]?.timestamp ?? now,
        messages: legacyMessages.map(stripAttachmentPayload),
      }];
    }
  } catch { /* ignore */ }

  return [makeNewThread()];
}

function saveThreads(threads: ChatThread[]) {
  try {
    const toSave = threads.map(sanitizeThread);
    localStorage.setItem(CHAT_STORAGE, JSON.stringify(toSave));
  } catch { /* storage full — ignore */ }
}

export function useAI() {
  const initialStateRef = useRef<{ threads: ChatThread[]; activeChatId: string } | null>(null);
  if (!initialStateRef.current) {
    const initialThreads = loadSavedThreads();
    let initialChatId = initialThreads[0]?.id ?? makeNewThread().id;
    try {
      const saved = localStorage.getItem(ACTIVE_CHAT_STORAGE);
      if (saved && initialThreads.some(thread => thread.id === saved)) {
        initialChatId = saved;
      }
    } catch { /* ignore */ }
    initialStateRef.current = {
      threads: initialThreads,
      activeChatId: initialChatId,
    };
  }

  const [threads, setThreads] = useState<ChatThread[]>(() => initialStateRef.current?.threads ?? [makeNewThread()]);
  const [activeChatId, setActiveChatId] = useState<string>(() => initialStateRef.current?.activeChatId ?? initialStateRef.current?.threads[0]?.id ?? makeNewThread().id);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const threadsRef = useRef<ChatThread[]>(threads);
  const activeChatIdRef = useRef(activeChatId);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    if (!threads.some(thread => thread.id === activeChatId) && threads[0]) {
      setActiveChatId(threads[0].id);
    }
  }, [threads, activeChatId]);

  const currentChat = useMemo(() => {
    const found = threads.find(thread => thread.id === activeChatId);
    if (found) return found;
    return [...threads].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? threads[0];
  }, [threads, activeChatId]);

  const messages = currentChat.messages;
  const orderedThreads = useMemo(
    () => [...threads].sort((a, b) => b.updatedAt - a.updatedAt),
    [threads],
  );

  // Persist threads to localStorage whenever they change
  useEffect(() => {
    if (!isStreaming) {
      saveThreads(threads);
      localStorage.setItem(ACTIVE_CHAT_STORAGE, activeChatId);
      localStorage.removeItem(LEGACY_CHAT_STORAGE);
    }
  }, [threads, activeChatId, isStreaming]);

  const updateThread = useCallback((threadId: string, updater: (thread: ChatThread) => ChatThread) => {
    setThreads(prev => prev.map(thread => thread.id === threadId ? updater(thread) : thread));
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const ensureActiveThread = useCallback((threadId: string) => {
    stopStreaming();
    setError(null);
    setActiveChatId(threadId);
  }, [stopStreaming]);

  const createChat = useCallback((title = 'New chat') => {
    stopStreaming();
    const thread = makeNewThread(title);
    setThreads(prev => [thread, ...prev]);
    setActiveChatId(thread.id);
    setError(null);
    return thread.id;
  }, [stopStreaming]);

  const renameChat = useCallback((threadId: string, title: string) => {
    const nextTitle = title.trim() || 'New chat';
    updateThread(threadId, thread => ({
      ...thread,
      title: nextTitle,
      updatedAt: Date.now(),
    }));
  }, [updateThread]);

  const deleteChat = useCallback((threadId: string) => {
    stopStreaming();
    setThreads(prev => {
      const remaining = prev.filter(thread => thread.id !== threadId);
      if (remaining.length === 0) {
        const fresh = makeNewThread();
        setActiveChatId(fresh.id);
        return [fresh];
      }

      if (activeChatIdRef.current === threadId) {
        const nextActive = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        setActiveChatId(nextActive.id);
      }

      return remaining;
    });
    setError(null);
  }, [stopStreaming]);

  const clearChat = useCallback(() => {
    const threadId = activeChatIdRef.current;
    updateThread(threadId, thread => ({
      ...thread,
      messages: [],
      title: thread.title === 'New chat' ? thread.title : thread.title,
      updatedAt: Date.now(),
    }));
    setError(null);
  }, [updateThread]);

  const sendMessage = useCallback(async (
    userMessage: string,
    appData: Parameters<typeof buildSystemPrompt>[0],
    images?: ImageAttachment[],
  ) => {
    const key = getAPIKey();
    if (!key) {
      setError('Please add your Gemini API key first.');
      return;
    }

    let threadId = activeChatIdRef.current;
    let thread = threadsRef.current.find(item => item.id === threadId) ?? threadsRef.current[0];
    if (!thread) {
      const fresh = makeNewThread();
      threadId = fresh.id;
      thread = fresh;
      setThreads(prev => [fresh, ...prev]);
      setActiveChatId(fresh.id);
      threadsRef.current = [fresh, ...threadsRef.current];
      activeChatIdRef.current = fresh.id;
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      images: images?.length ? images : undefined,
    };

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    const nextTitle = thread.title === 'New chat' || thread.messages.length === 0
      ? makeChatTitle([...(thread.messages), userMsg], makeChatTitle([userMsg]))
      : thread.title;

    setThreads(prev => prev.map(item => {
      if (item.id !== threadId) return item;
      const updatedMessages = [...item.messages, userMsg, assistantMsg];
      return {
        ...item,
        title: nextTitle,
        updatedAt: Date.now(),
        messages: updatedMessages,
      };
    }));
    setIsStreaming(true);
    setError(null);

    const updateContent = (text: string) => {
      setThreads(prev => prev.map(item => {
        if (item.id !== threadId) return item;
        return {
          ...item,
          updatedAt: Date.now(),
          messages: item.messages.map(m => m.id === assistantMsg.id ? { ...m, content: text } : m),
        };
      }));
    };

    try {
      abortRef.current = new AbortController();
      const systemPrompt = buildSystemPrompt(appData);
      await streamGemini(
        key,
        systemPrompt,
        [...thread.messages, userMsg],
        updateContent,
        abortRef.current.signal,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const errMsg = err instanceof Error ? err.message : 'Something went wrong';
      setError(errMsg);
      setThreads(prev => prev.map(item => {
        if (item.id !== threadId) return item;
        return {
          ...item,
          messages: item.messages.filter(m => m.id !== assistantMsg.id),
        };
      }));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, []);

  return {
    threads: orderedThreads,
    currentChat,
    currentChatId: activeChatId,
    messages,
    isStreaming,
    error,
    createChat,
    selectChat: ensureActiveThread,
    renameChat,
    deleteChat,
    clearChat,
    sendMessage,
    stopStreaming,
  };
}
