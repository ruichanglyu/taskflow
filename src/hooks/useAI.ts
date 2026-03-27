import { useState, useCallback, useRef, useEffect } from 'react';
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

export interface ImportBlock {
  type: 'tasks' | 'deadlines' | 'subtasks' | 'delete-tasks';
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
}

const KEY_STORAGE = 'taskflow_ai_key';

const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const GEMINI_MODEL_VISION = 'gemini-2.5-flash';  // lite model doesn't support images, use 2.5 flash for multimodal
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

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

FIELD RULES:
- Tasks: title (required), course, due (YYYY-MM-DD), priority (low/medium/high), description, status (todo/in-progress/done), recurrence (none/daily/weekly/monthly)
- Deadlines: title (required), course, date (YYYY-MM-DD required), time (HH:MM AM/PM), type (assignment/exam/quiz/lab/project/other), notes, status (not-started/in-progress/done/missed)
- Course names should match existing courses when possible

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
  const regex = /```import:(tasks|deadlines|delete-tasks|subtasks:([^\n]*))\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const rawType = match[1];
    const isSubtasks = rawType.startsWith('subtasks:');
    const type: ImportBlock['type'] = isSubtasks ? 'subtasks' : rawType as 'tasks' | 'deadlines' | 'delete-tasks';
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

const CHAT_STORAGE = 'taskflow_ai_chat';

function loadSavedMessages(): ChatMessage[] {
  try {
    const saved = localStorage.getItem(CHAT_STORAGE);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function saveMessages(messages: ChatMessage[]) {
  try {
    // Strip base64 image data before saving — keep a placeholder so we know images were attached
    const toSave = messages.map(m => {
      if (!m.images?.length) return m;
      return {
        ...m,
        images: m.images.map(img => ({
          base64: '',           // don't persist large base64
          mimeType: img.mimeType,
          preview: '',          // don't persist data URLs either
        })),
      };
    });
    localStorage.setItem(CHAT_STORAGE, JSON.stringify(toSave));
  } catch { /* storage full — ignore */ }
}

export function useAI() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadSavedMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    if (!isStreaming) saveMessages(messages);
  }, [messages, isStreaming]);

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

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      images: images?.length ? images : undefined,
    };

    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    setError(null);

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, assistantMsg]);

    const updateContent = (text: string) => {
      setMessages(prev =>
        prev.map(m => m.id === assistantMsg.id ? { ...m, content: text } : m)
      );
    };

    try {
      abortRef.current = new AbortController();
      const systemPrompt = buildSystemPrompt(appData);
      await streamGemini(key, systemPrompt, [...messages, userMsg], updateContent, abortRef.current.signal);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const errMsg = err instanceof Error ? err.message : 'Something went wrong';
      setError(errMsg);
      setMessages(prev => prev.filter(m => m.id !== assistantMsg.id));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [messages]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
    localStorage.removeItem(CHAT_STORAGE);
  }, []);

  return { messages, isStreaming, error, sendMessage, stopStreaming, clearChat };
}
