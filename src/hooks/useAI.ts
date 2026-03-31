import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Task, Deadline, Project, WorkoutPlan, WorkoutDayTemplate, Exercise, WorkoutDayExercise } from '../types';
import type { GoogleCalendarEvent, GoogleCalendarListItem } from '../lib/googleCalendar';

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
  type: 'tasks' | 'deadlines' | 'subtasks' | 'delete-tasks' | 'update-tasks' | 'deadline-links' | 'calendar-create' | 'calendar-update' | 'calendar-delete' | 'habits-create' | 'habits-complete' | 'habits-delete';
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
  // Habits
  frequency?: string;
  // Calendar
  calendar?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  allDay?: string;
  newTitle?: string;
  newDate?: string;
  newStartTime?: string;
  newEndTime?: string;
  newDescription?: string;
  newLocation?: string;
  newCalendar?: string;
  newAllDay?: string;
}

const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const GEMINI_MODEL_VISION = 'gemini-2.5-flash';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const LEGACY_CHAT_STORAGE = 'taskflow_ai_chat';

// Storage keys scoped per user
function keyStorage(userId: string) { return `taskflow_ai_key_${userId}`; }
function chatStorage(userId: string) { return `taskflow_ai_chats_${userId}`; }
function activeChatStorage(userId: string) { return `taskflow_ai_active_chat_${userId}`; }

interface RemoteChatThreadRow {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface RemoteChatMessageRow {
  id: string;
  thread_id: string;
  user_id: string;
  role: ChatMessage['role'];
  content: string;
  images: unknown;
  created_at: string;
}

function dedupeRowsById<T extends { id: string }>(rows: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}

// --- API key: synced via Supabase, localStorage used as fast cache ---

export async function getAPIKey(userId: string): Promise<string | null> {
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(keyStorage(userId));
  } catch { /* ignore */ }

  // Prefer Supabase so changes on other devices win over stale local cache.
  try {
    const { supabase } = await import('../lib/supabase');
    if (!supabase) return cached;
    const { data, error } = await supabase
      .from('user_settings')
      .select('gemini_api_key')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) return cached;

    if (!data?.gemini_api_key) {
      try { localStorage.removeItem(keyStorage(userId)); } catch { /* ignore */ }
      return null;
    }

    try { localStorage.setItem(keyStorage(userId), data.gemini_api_key); } catch { /* ignore */ }
    return data.gemini_api_key;
  } catch {
    return cached;
  }
}

/** Synchronous read from cache only — used during streaming when we can't await */
export function getAPIKeyCached(userId: string): string | null {
  try {
    return localStorage.getItem(keyStorage(userId));
  } catch {
    return null;
  }
}

export async function setAPIKey(userId: string, key: string) {
  // Write to localStorage cache immediately
  try { localStorage.setItem(keyStorage(userId), key); } catch { /* ignore */ }

  // Persist to Supabase
  try {
    const { supabase } = await import('../lib/supabase');
    if (!supabase) return;
    await supabase
      .from('user_settings')
      .upsert({
        user_id: userId,
        gemini_api_key: key,
        updated_at: new Date().toISOString(),
      });
  } catch { /* ignore — localStorage still has it */ }
}

export async function removeAPIKey(userId: string) {
  try { localStorage.removeItem(keyStorage(userId)); } catch { /* ignore */ }

  try {
    const { supabase } = await import('../lib/supabase');
    if (!supabase) return;
    await supabase
      .from('user_settings')
      .update({ gemini_api_key: null, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  } catch { /* ignore */ }
}

/** One-time migration: move legacy global/localStorage data to Supabase. Call once on app load. */
export async function migrateLegacyAIData(userId: string) {
  try {
    // Migrate legacy global API key
    const legacyKey = localStorage.getItem('taskflow_ai_key');
    if (legacyKey && !localStorage.getItem(keyStorage(userId))) {
      localStorage.setItem(keyStorage(userId), legacyKey);
    }
    localStorage.removeItem('taskflow_ai_key');

    // Migrate chat history
    const legacyChats = localStorage.getItem('taskflow_ai_chats');
    if (legacyChats && !localStorage.getItem(chatStorage(userId))) {
      localStorage.setItem(chatStorage(userId), legacyChats);
    }
    localStorage.removeItem('taskflow_ai_chats');

    // Migrate active chat
    const legacyActive = localStorage.getItem('taskflow_ai_active_chat');
    if (legacyActive && !localStorage.getItem(activeChatStorage(userId))) {
      localStorage.setItem(activeChatStorage(userId), legacyActive);
    }
    localStorage.removeItem('taskflow_ai_active_chat');

    // Push localStorage API key to Supabase if not already there
    const localKey = localStorage.getItem(keyStorage(userId));
    if (localKey) {
      const { supabase } = await import('../lib/supabase');
      if (supabase) {
        const { data } = await supabase
          .from('user_settings')
          .select('gemini_api_key')
          .eq('user_id', userId)
          .maybeSingle();
        if (!data?.gemini_api_key) {
          await supabase
            .from('user_settings')
            .upsert({
              user_id: userId,
              gemini_api_key: localKey,
              updated_at: new Date().toISOString(),
            });
        }
      }
    }
  } catch { /* ignore */ }
}


function buildSystemPrompt(data: {
  tasks: Task[];
  deadlines: Deadline[];
  projects: Project[];
  plans: WorkoutPlan[];
  dayTemplates: WorkoutDayTemplate[];
  exercises: Exercise[];
  dayExercises: WorkoutDayExercise[];
  calendarEvents: GoogleCalendarEvent[];
  calendarCalendars: GoogleCalendarListItem[];
  selectedCalendarId?: string;
  habits?: { id: string; title: string; frequency: string; doneToday: boolean; streak: number }[];
  recentAppliedCalendarActions?: string[];
  recentListedCalendarEvents?: string[];
  behaviorSummary?: string;
}): string {
  const today = new Date().toISOString().split('T')[0];

  const activeTasks = data.tasks.filter(t => t.status !== 'done');
  const doneTasks = data.tasks.filter(t => t.status === 'done');
  const pastDeadlines = data.deadlines
    .filter(d => d.dueDate < today)
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  const upcomingDeadlines = data.deadlines
    .filter(d => d.dueDate >= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
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

  const pastDeadlinesSummary = pastDeadlines.length > 0
    ? pastDeadlines.map(d => {
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

  const calendarsSummary = data.calendarCalendars.length > 0
    ? data.calendarCalendars.map(calendar => `- ${calendar.summary}${calendar.id === data.selectedCalendarId ? ' (active)' : ''}`).join('\n')
    : '(not connected)';

  // Group calendar events by day and compute free slots so the AI can schedule without conflicts
  let upcomingCalendarSummary = '(none loaded)';
  if (data.calendarEvents.length > 0) {
    const timeFmt = (d: Date) => d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });

    // Collect timed events by day
    const dayMap = new Map<string, { summary: string; startMin: number; endMin: number; calendarSummary?: string }[]>();
    for (const event of data.calendarEvents) {
      const startDt = event.start?.dateTime ? new Date(event.start.dateTime) : null;
      const endDt = event.end?.dateTime ? new Date(event.end.dateTime) : null;
      if (!startDt) continue; // skip all-day events for free slot calc
      const dateKey = startDt.toISOString().split('T')[0];
      if (!dayMap.has(dateKey)) dayMap.set(dateKey, []);
      const startMin = startDt.getHours() * 60 + startDt.getMinutes();
      const endMin = endDt ? endDt.getHours() * 60 + endDt.getMinutes() : startMin + 60;
      dayMap.get(dateKey)!.push({
        summary: event.summary || 'Untitled event',
        startMin,
        endMin,
        calendarSummary: event.calendarSummary,
      });
    }

    const minToTime = (m: number) => {
      const h = Math.floor(m / 60);
      const mm = m % 60;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${h12}:${mm.toString().padStart(2, '0')} ${ampm}`;
    };

    const DAY_START = 8 * 60;  // 8:00 AM
    const DAY_END = 23 * 60 + 59;   // 11:59 PM
    const MIN_GAP = 30;        // minimum 30min to be useful

    upcomingCalendarSummary = [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, events]) => {
        const sorted = events.sort((a, b) => a.startMin - b.startMin);
        const busyLines = sorted.map(e =>
          `  BUSY ${minToTime(e.startMin)} – ${minToTime(e.endMin)}: ${e.summary}${e.calendarSummary ? ` [${e.calendarSummary}]` : ''}`
        );

        // Compute free slots
        const freeSlots: string[] = [];
        let cursor = DAY_START;
        for (const e of sorted) {
          if (e.startMin > cursor + MIN_GAP) {
            freeSlots.push(`  FREE ${minToTime(cursor)} – ${minToTime(e.startMin)} (${e.startMin - cursor} min)`);
          }
          cursor = Math.max(cursor, e.endMin);
        }
        if (DAY_END > cursor + MIN_GAP) {
          freeSlots.push(`  FREE ${minToTime(cursor)} – ${minToTime(DAY_END)} (${DAY_END - cursor} min)`);
        }

        return `${date}:\n${busyLines.join('\n')}\n${freeSlots.join('\n')}`;
      })
      .join('\n');
  }

  return `You are a personal AI assistant inside TaskFlow, a student life management app. Today is ${today}.

USER'S DATA:

COURSES (${data.projects.length}):
${coursesList}

ACTIVE TASKS (${activeTasks.length} active, ${doneTasks.length} done):
${tasksSummary}

UPCOMING DEADLINES (${upcomingDeadlines.length}):
${deadlinesSummary}

PAST DEADLINES (${pastDeadlines.length}):
${pastDeadlinesSummary}

ACTIVE GYM PLAN:
${gymSummary}

RECENT APPLIED AI CALENDAR ACTIONS:
${data.recentAppliedCalendarActions && data.recentAppliedCalendarActions.length > 0
  ? data.recentAppliedCalendarActions.map(line => `- ${line}`).join('\n')
  : '(none)'}

RECENT LISTED CALENDAR EVENTS:
${data.recentListedCalendarEvents && data.recentListedCalendarEvents.length > 0
  ? data.recentListedCalendarEvents.map(line => `- ${line}`).join('\n')
  : '(none)'}

CONNECTED CALENDARS:
${calendarsSummary}

LOADED CALENDAR EVENTS:
${upcomingCalendarSummary}

BEHAVIOR INSIGHTS:
${data.behaviorSummary?.trim() || '(not enough behavior history yet)'}

ROUTINES (daily/weekly habits):
${data.habits && data.habits.length > 0
  ? data.habits.map(h => `- ${h.title} (${h.frequency}) [${h.doneToday ? 'done today' : 'not done today'}]${h.streak > 1 ? ` 🔥${h.streak} day streak` : ''}`).join('\n')
  : '(none)'}

CAPABILITIES:
You can have normal conversations AND help create/import data. When the user asks you to create tasks, deadlines, calendar events, routines, or workout plans, output them in special import blocks.

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

To update existing tasks (add/change due date, priority, status, description), output a fenced code block with language "import:update-tasks":
\`\`\`import:update-tasks
Exact Task Title | due: 2026-03-29 | priority: high | status: in-progress | course: CS 1332
Another Task Title | due: 2026-04-10 | status: done
\`\`\`
Each line must be the EXACT title of an existing task. Only include the fields that should change. Valid status values: todo, in-progress, done. Use this instead of creating a new task when the user wants to modify an existing one (e.g. "put a date on it", "mark it as done", "change priority").

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

To create calendar events, output a fenced code block with language "import:calendar-create":
\`\`\`import:calendar-create
Study Block - CS 1332 Demo 2 Prep | calendar: Exam Prep | course: CS 1332 | date: 2026-03-29 | start: 7:00 PM | end: 9:00 PM | description: Demo 2 prep
Office Hours | calendar: Personal | date: 2026-03-30 | start: 1:30 PM | end: 2:15 PM | location: Skiles 268
\`\`\`

To update calendar events, output a fenced code block with language "import:calendar-update":
\`\`\`import:calendar-update
Study Block | calendar: Study Blocks | date: 2026-03-29 | start: 7:00 PM | new date: 2026-03-30 | new start: 8:00 PM | new end: 10:00 PM | new description: Review exam 3 topics
\`\`\`
For updates, the first title/date/start/calendar identify the existing event. The \`new ...\` fields are the replacement values.
Use absolute YYYY-MM-DD dates in both the identifying fields and the \`new date\` field. Do not use relative words like "tomorrow" in calendar update blocks.
If you are converting an all-day event into a timed event, include \`new all day: false\` explicitly.

To delete calendar events, output a fenced code block with language "import:calendar-delete":
\`\`\`import:calendar-delete
Study Block | calendar: Study Blocks | date: 2026-03-29 | start: 7:00 PM
\`\`\`
For update/delete, include calendar, date, and start time whenever possible so the app can find a unique event safely.

To create new routines, output a fenced code block with language "import:habits-create":
\`\`\`import:habits-create
Drink water | frequency: daily
Weekly review | frequency: weekly
\`\`\`
Each line is a routine title with optional frequency (daily/weekly, defaults to daily).

To mark a routine as done for today, output a fenced code block with language "import:habits-complete":
\`\`\`import:habits-complete
Drink water
Morning workout
\`\`\`
Each line must be the EXACT title of an existing routine.

To delete a routine permanently, output a fenced code block with language "import:habits-delete":
\`\`\`import:habits-delete
Drink water
\`\`\`
Each line must be the EXACT title of an existing routine. Only delete when the user explicitly asks to remove it.

FIELD RULES:
- Tasks: title (required), course, due (YYYY-MM-DD), priority (low/medium/high), description, status (todo/in-progress/done), recurrence (none/daily/weekly/monthly)
- Deadlines: title (required), course, date (YYYY-MM-DD required), time (HH:MM AM/PM), type (assignment/exam/quiz/lab/project/other), notes, status (not-started/in-progress/done/missed)
- Calendar create: title, calendar, date (YYYY-MM-DD), start, end, description, location, all day
- Calendar update: title, calendar, date, start, then any \`new ...\` fields to change
- Calendar delete: title, calendar, date, start
- Course names should match existing courses when possible
- For study blocks, do NOT use a generic title like "Study Block" by itself. Use course-first titles without the redundant "Study Block -" prefix, for example: "MATH 3012 Exam 3 Prep" or "CS 1332 Demo 2 Prep".

AMBIGUITY RULES (CRITICAL):
- When the user's intent is not clear enough to map to one safe action, ask a short follow-up question instead of emitting any import block.
- Prefer asking over guessing for ANY destructive or modifying action: delete, move, reschedule, update, unlink, or changing calendars.
- If there are multiple plausible tasks, deadlines, routines, or calendar events that could match, ask which one they mean.
- If the user uses vague references like "it", "them", "that one", "the previous one", or "the ones you just made", only act when the source-of-truth sections above make the target exact. Otherwise ask.
- If you do not have the exact identifying details needed for a safe calendar update/delete (calendar, date, start time, or an exact recently listed/applied event), ask instead of guessing.
- If you are unsure whether a previous suggestion was actually applied, ask before modifying or deleting it.
- For create requests, ask a follow-up when a required scheduling/detail choice is missing and you cannot safely infer it from the user's data.
- A good follow-up question should be short, specific, and offer the smallest clarification needed to proceed safely.

LINKING RULES:
- Never say a task is linked just because the task title or course name looks similar to a deadline.
- If the user asks to link a task to a deadline, use the \`deadline-links\` import block so the app can create the real \`deadline_tasks\` link.
- If you create a task that should be linked, include \`import:tasks\` and \`import:deadline-links\` in the same response.
- If the user asks you to create tasks for existing exams, quizzes, labs, projects, assignments, or deadlines, treat linking as part of the same job whenever there is one clear matching deadline per task. In that case, include the \`import:tasks\` block and the matching \`import:deadline-links\` block in the same response by default.
- When some of those matches are ambiguous but others are clear, do not guess. Ask a short follow-up such as whether they want you to link only the clear matches or create the tasks without links.
- When every intended link is ambiguous, ask before creating unlinked prep tasks if linking appears to be an important part of the request.
- If you do not emit an \`import:deadline-links\` block, then you must not claim the task is linked.
- If the user asks to "link", "attach", "connect", or "match" a task to a deadline, do NOT fake it by renaming the task.
- When linking is requested, prefer a single \`import:deadline-links\` block and avoid creating a duplicate task unless the user explicitly asked for a new task.
- If the link cannot be created because the app cannot find a unique deadline and task, ask the user for the exact titles instead of pretending it worked.
- Only say a task is linked if the app explicitly created or updated a real \`deadline_tasks\` link.
- Never claim a calendar event was created, updated, or deleted unless you emitted the matching calendar import block.
- For calendar update/delete, do not guess. If you are not sure which event is meant, ask a follow-up instead of emitting the block.

SCHEDULING RULES (CRITICAL — you MUST follow these when creating calendar events):
- The LOADED CALENDAR EVENTS section above shows each day's BUSY times and FREE slots with durations.
- Use FREE slots for flexible scheduling requests such as study blocks, focus blocks, or when the user asks you to find a time that fits around their schedule.
- If the user gives an exact time for a real event they want on the calendar, or clearly asks to place it at that specific time, you may schedule it there even if it overlaps existing events. In that case, briefly warn them about the overlap instead of silently changing the time.
- Only auto-adjust times to avoid conflicts when the request is flexible. Do not move a fixed explicit event to a different time unless the user asks you to find another time.
- For each requested day, keep the day/cadence the user asked for whenever possible and adjust the TIME within that same day before you consider skipping the day.
- For each day, pick a FREE slot that is long enough for the requested duration. Different days will have different free times — use different times per day.
- If no FREE slot on a day is long enough, skip that day and tell the user.
- If the user gives a time floor like "after 4 PM", every start time you emit must be at or after that exact time. Never move earlier than the requested floor, even by 15 minutes.
- When explaining, mention which free slot you used per day (e.g. "Saturday at 2 PM in your free window between EAS 1600 and MATH 3012").
- Import blocks are suggested changes only until the user clicks Apply. Do not say you already created, updated, deleted, removed, or linked something unless the user explicitly confirmed those changes were applied.
- Do not assume earlier suggested changes exist. Only treat the data listed in USER'S DATA as real unless the user explicitly says they already applied a suggestion.
- If the user refers to “the ones you just created/updated/deleted,” use the RECENT APPLIED AI CALENDAR ACTIONS section above as the source of truth for what was actually applied.
- If the user refers to “the ones you just listed/showed/found,” use the RECENT LISTED CALENDAR EVENTS section above as the source of truth for those exact events.
- When deleting or updating recently applied calendar events, include the exact calendar, date, and start time whenever those details are available from RECENT APPLIED AI CALENDAR ACTIONS, RECENT LISTED CALENDAR EVENTS, or LOADED CALENDAR EVENTS.
- If the user asks to delete, reschedule, or move calendar events that you just listed from LOADED CALENDAR EVENTS or RECENT LISTED CALENDAR EVENTS, you MUST reuse those exact event details in the import block. Include one calendar row per real event with the exact title, calendar, date, and start time. Do not emit vague deletes like just a title when you already know the exact matching events.
- If the user says "delete them", "move them", "change them", or "reschedule them" after you just enumerated real calendar events, interpret "them" as those exact listed events and preserve the exact dates/start times in the import block.

STRICT RESPONSE RULES FOR NORMAL CHAT:
- Do not describe title/course similarity as if it created a link; only a real \`import:deadline-links\` block does that.
- TRANSPARENCY: Every import block you emit MUST be explicitly mentioned in your text response. Never silently create, update, or delete something without announcing it. If you are creating a calendar event for MATH 3012, say so in the text before the import block.
- Import blocks are only suggested changes until the user clicks Apply/Approve in the app. Never say you already created, deleted, updated, removed, or scheduled something when you only emitted an import block. Say you prepared or suggested changes instead.
- If the user refers to changes you suggested earlier, do not assume those suggestions were applied. If you are not certain whether the user clicked Apply, say so and avoid claiming the previous changes already exist.

You can also generate CSV files for manual import when asked. For deadlines CSV:
status,course,date,time,title,type,notes

For tasks CSV:
title,status,priority,course,due_date,description,recurrence

When generating CSVs, wrap them in a fenced code block with language "csv".

STYLE RULES:
- Be direct and confident. Answer first, context second.
- Match length to complexity. One-sentence questions get one-sentence answers. Complex requests get structured responses.
- Use markdown naturally: bullet lists when listing things, **bold** for key terms, headers for longer structured responses, code blocks for code. Don't over-format short conversational replies.
- Never open with filler like "Sure!", "Great question!", "Certainly!", "Of course!", or "Absolutely!".
- Don't narrate what you're about to do before an action card — the card already shows it. One short line of context is fine, nothing more.
- When creating, updating, or deleting calendar events, ALWAYS mention the specific time (and date if relevant) in your text response. For example: "I've scheduled your workout for 2:30 PM – 3:30 PM tomorrow." or "Moved your study block to 4:00 PM." Never just say "Done" or "Created the event" without the time.
- Don't end every message with a follow-up question. Only ask a follow-up when you genuinely need a decision to proceed. If the answer stands on its own, let it stand.
- When you don't have data for something, say so in one sentence and move on. Don't over-explain what data you do or don't have access to.
- Tone: warm, honest, a little casual. Like a smart friend who knows your schedule — not a customer service bot.
- Use "I" naturally. "Here's what I've got:" is fine. "I have prepared the following items for your review:" is not.
- When writing math, use LaTeX notation so it renders properly: inline math with $...$ and display/block math with $$...$$. For example: $f(x, y) = x^2y$, $$\frac{1}{\text{Area}(R)} \iint_R f(x,y)\,dA$$. Never write raw math as plain ASCII like "x^2" or "integral" spelled out — use LaTeX.
- When the user sends an image containing a math problem, homework question, or any question — answer it directly. Don't describe what the image shows. Just solve it step by step like you would if the user had typed the question out. Show your work clearly with labeled steps.`;
}

/** Parse import blocks from AI response */
export function parseImportBlocks(content: string): ImportBlock[] {
  const blocks: ImportBlock[] = [];
  const regex = /```import:(tasks|deadlines|delete-tasks|update-tasks|deadline-links|calendar-create|calendar-update|calendar-delete|habits-create|habits-complete|habits-delete|subtasks:([^\n]*))\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const rawType = match[1];
    const isSubtasks = rawType.startsWith('subtasks:');
    const type: ImportBlock['type'] = isSubtasks ? 'subtasks' : rawType as ImportBlock['type'];
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
          case 'priority': row.priority = val.toLowerCase() as 'low' | 'medium' | 'high'; break;
          case 'description':
          case 'desc': row.description = val; break;
          case 'status': row.status = val.toLowerCase(); break;
          case 'recurrence':
          case 'repeat': row.recurrence = val.toLowerCase(); break;
          case 'frequency': row.frequency = val.toLowerCase(); break;
          case 'type': row.type = val.toLowerCase(); break;
          case 'time': row.dueTime = val; break;
          case 'notes': row.notes = val; break;
          case 'task': row.taskTitle = val; break;
          case 'calendar': row.calendar = val; break;
          case 'start':
          case 'start time': row.startTime = val; break;
          case 'end':
          case 'end time': row.endTime = val; break;
          case 'location': row.location = val; break;
          case 'all day':
          case 'all-day': row.allDay = val; break;
          case 'new title': row.newTitle = val; break;
          case 'new date': row.newDate = val; break;
          case 'new start': row.newStartTime = val; break;
          case 'new end': row.newEndTime = val; break;
          case 'new description': row.newDescription = val; break;
          case 'new location': row.newLocation = val; break;
          case 'new calendar': row.newCalendar = val; break;
          case 'new all day':
          case 'new all-day': row.newAllDay = val; break;
        }
      }

      rows.push(row);
    }

    blocks.push({ type, raw, rows, ...(parentTaskTitle !== undefined ? { parentTaskTitle } : {}) });
  }

  return blocks;
}

/* ── Gemini streaming ─────────────────────────────────────────────── */

// Models to try in order — if one returns 503/500, fall back to the next
const GEMINI_MODELS = [GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

async function tryStreamGemini(
  key: string,
  model: string,
  systemPrompt: string,
  contents: Record<string, unknown>[],
  signal: AbortSignal,
): Promise<Response> {
  const url = `${GEMINI_API_URL}/${model}:streamGenerateContent?alt=sse&key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 },
      },
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

    // Transient server errors — throw with status so caller can retry with fallback
    if (res.status === 500 || res.status === 503) {
      const err = new Error(`Gemini ${res.status}`);
      (err as any).status = res.status;
      (err as any).retryable = true;
      throw err;
    }

    throw new Error(`Gemini error ${res.status}: ${body.slice(0, 300)}`);
  }

  return res;
}

async function streamGemini(
  key: string,
  systemPrompt: string,
  history: ChatMessage[],
  onUpdate: (text: string) => void,
  signal: AbortSignal,
) {
  const hasImages = history.some(m => m.images?.some(img => img.base64));
  const contents = history.map(m => {
    const parts: Record<string, unknown>[] = [];
    if (m.images?.length) {
      for (const img of m.images) {
        if (img.base64) {
          parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
        }
      }
    }
    if (m.content) parts.push({ text: m.content });
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });

  // For images, only use vision model (no fallback chain)
  const modelsToTry = hasImages ? [GEMINI_MODEL_VISION] : GEMINI_MODELS;

  let res: Response | null = null;
  for (const model of modelsToTry) {
    try {
      res = await tryStreamGemini(key, model, systemPrompt, contents, signal);
      break; // success
    } catch (err: any) {
      if (err?.retryable && model !== modelsToTry[modelsToTry.length - 1]) {
        // Transient error, try next model
        continue;
      }
      throw err; // no more fallbacks or non-retryable error
    }
  }

  if (!res) throw new Error('All Gemini models failed');

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
        const parts = parsed?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (part.thought) continue;
            if (part.text) {
              accumulated += part.text;
              onUpdate(accumulated);
            }
          }
        }
      } catch { /* skip malformed lines */ }
    }
  }

  if (!accumulated) {
    onUpdate('I wasn\'t able to generate a response. Please try again.');
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
    // Strip base64 (large, only needed for API calls) but keep preview
    // so the image thumbnail still displays when restoring from storage.
    images: message.images.map(img => ({
      base64: '',
      mimeType: img.mimeType,
      preview: img.preview,
    })),
  };
}

function normalizeMessageContent(content: string) {
  return content.trim().replace(/\s+/g, ' ');
}

function messageRoleSortWeight(role: ChatMessage['role']) {
  switch (role) {
    case 'system':
      return 0;
    case 'user':
      return 1;
    case 'assistant':
      return 2;
    default:
      return 3;
  }
}

function sortMessagesChronologically(messages: ChatMessage[]) {
  return [...messages].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    const roleDiff = messageRoleSortWeight(a.role) - messageRoleSortWeight(b.role);
    if (roleDiff !== 0) return roleDiff;
    return a.id.localeCompare(b.id);
  });
}

function dedupeConsecutiveMessages(messages: ChatMessage[]) {
  const deduped: ChatMessage[] = [];

  for (const message of sortMessagesChronologically(messages)) {
    const normalized = stripAttachmentPayload(message);
    const previous = deduped[deduped.length - 1];
    if (!previous) {
      deduped.push(normalized);
      continue;
    }

    const isEquivalent =
      previous.role === normalized.role &&
      normalizeMessageContent(previous.content) === normalizeMessageContent(normalized.content) &&
      (previous.images?.length ?? 0) === (normalized.images?.length ?? 0) &&
      Math.abs(previous.timestamp - normalized.timestamp) <= 120_000;

    if (isEquivalent) {
      const keepCurrent = normalized.timestamp >= previous.timestamp;
      deduped[deduped.length - 1] = keepCurrent ? normalized : previous;
      continue;
    }

    deduped.push(normalized);
  }

  return deduped;
}

function sanitizeThread(thread: ChatThread): ChatThread {
  return {
    ...thread,
    messages: dedupeConsecutiveMessages(thread.messages),
  };
}

function serializeThreads(threads: ChatThread[]) {
  const normalized = threads
    .map(thread => sanitizeThread(thread))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(thread => ({
      ...thread,
      messages: [...thread.messages]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(message => stripAttachmentPayload(message)),
    }));
  return JSON.stringify(normalized);
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

function buildThreadContentSignature(thread: ChatThread) {
  const normalizedTitle = thread.title.trim().toLowerCase();
  const normalizedMessages = thread.messages.map(message => ({
    role: message.role,
    content: message.content.trim().replace(/\s+/g, ' '),
    imageCount: message.images?.length ?? 0,
  }));
  return JSON.stringify({ title: normalizedTitle, messages: normalizedMessages });
}

function dedupeEquivalentThreads(threads: ChatThread[]) {
  const byId = new Map<string, ChatThread>();
  for (const thread of threads) {
    byId.set(thread.id, sanitizeThread(thread));
  }

  const byContent = new Map<string, ChatThread>();
  for (const thread of byId.values()) {
    const signature = buildThreadContentSignature(thread);
    const existing = byContent.get(signature);
    if (!existing) {
      byContent.set(signature, thread);
      continue;
    }

    const shouldReplace =
      thread.updatedAt > existing.updatedAt ||
      (thread.updatedAt === existing.updatedAt && thread.messages.length >= existing.messages.length);

    if (shouldReplace) {
      byContent.set(signature, thread);
    }
  }

  const result = [...byContent.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return result.length > 0 ? result : [makeNewThread()];
}

function loadSavedThreads(userId: string): ChatThread[] {
  try {
    const saved = localStorage.getItem(chatStorage(userId));
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
            return { id, title, createdAt, updatedAt, messages: sortMessagesChronologically(messages) };
          })
          .filter(Boolean) as ChatThread[];
        if (threads.length > 0) return dedupeEquivalentThreads(threads);
      }
    }

    const legacyMessages = loadLegacyMessages();
    if (legacyMessages.length > 0) {
      const now = Date.now();
      return dedupeEquivalentThreads([{
        id: crypto.randomUUID(),
        title: makeChatTitle(legacyMessages),
        createdAt: legacyMessages[0]?.timestamp ?? now,
        updatedAt: legacyMessages[legacyMessages.length - 1]?.timestamp ?? now,
        messages: legacyMessages.map(stripAttachmentPayload),
      }]);
    }
  } catch { /* ignore */ }

  return [makeNewThread()];
}

function saveThreads(userId: string, threads: ChatThread[]) {
  try {
    const toSave = dedupeEquivalentThreads(threads.map(sanitizeThread));
    localStorage.setItem(chatStorage(userId), JSON.stringify(toSave));
  } catch { /* storage full — ignore */ }
}

function getStoredActiveChatId(userId: string, threads: ChatThread[]) {
  try {
    const saved = sessionStorage.getItem(activeChatStorage(userId));
    if (saved && threads.some(thread => thread.id === saved)) {
      return saved;
    }
  } catch { /* ignore */ }
  return null;
}

function getFreshLandingThread(initialThreads: ChatThread[]) {
  const reusable = initialThreads.find(thread => thread.title === 'New chat' && thread.messages.length === 0);
  return reusable ?? makeNewThread();
}

// Fresh page load should land on a new chat once.
// Later remounts in the same tab session (like minimize/reopen) should restore the active thread.
let shouldStartFreshOnNextMount = true;

function buildInitialChatState(userId: string) {
  const initialThreads = loadSavedThreads(userId);
  const savedActiveChatId = getStoredActiveChatId(userId, initialThreads);
  const shouldStartFresh = shouldStartFreshOnNextMount || !savedActiveChatId;

  if (shouldStartFresh) {
    shouldStartFreshOnNextMount = false;
    const freshThread = getFreshLandingThread(initialThreads);
    return {
      threads: initialThreads.some(thread => thread.id === freshThread.id)
        ? initialThreads
        : [freshThread, ...initialThreads],
      activeChatId: freshThread.id,
    };
  }

  return {
    threads: initialThreads,
    activeChatId: savedActiveChatId ?? initialThreads[0]?.id ?? makeNewThread().id,
  };
}

function parseRemoteImages(images: unknown): ImageAttachment[] | undefined {
  if (!Array.isArray(images)) return undefined;
  const parsed = images
    .filter(Boolean)
    .map((img: any) => ({
      base64: typeof img?.base64 === 'string' ? img.base64 : '',
      mimeType: typeof img?.mimeType === 'string' ? img.mimeType : 'image/png',
      preview: typeof img?.preview === 'string' ? img.preview : '',
    }))
    .filter((img: ImageAttachment) => img.base64 || img.preview || img.mimeType);
  return parsed.length > 0 ? parsed : undefined;
}

function parseRemoteThreads(
  threadRows: RemoteChatThreadRow[],
  messageRows: RemoteChatMessageRow[],
): ChatThread[] {
  const messagesByThread = new Map<string, ChatMessage[]>();
  for (const row of messageRows) {
    if (!messagesByThread.has(row.thread_id)) messagesByThread.set(row.thread_id, []);
    messagesByThread.get(row.thread_id)!.push({
      id: row.id,
      role: row.role,
      content: row.content ?? '',
      timestamp: Date.parse(row.created_at) || Date.now(),
      images: parseRemoteImages(row.images),
    });
  }

  return dedupeEquivalentThreads(threadRows
    .map((row): ChatThread => ({
      id: row.id,
      title: row.title || 'New chat',
      createdAt: Date.parse(row.created_at) || Date.now(),
      updatedAt: Date.parse(row.updated_at) || Date.now(),
      messages: sortMessagesChronologically(messagesByThread.get(row.id) ?? []),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt));
}

function mergeThreads(remoteThreads: ChatThread[], localThreads: ChatThread[]) {
  const merged = new Map<string, ChatThread>();

  for (const thread of [...remoteThreads, ...localThreads]) {
    const normalized = sanitizeThread(thread);
    const existing = merged.get(normalized.id);
    if (!existing) {
      merged.set(normalized.id, normalized);
      continue;
    }

    const shouldReplace =
      normalized.updatedAt > existing.updatedAt ||
      (normalized.updatedAt === existing.updatedAt && normalized.messages.length > existing.messages.length);

    if (shouldReplace) merged.set(normalized.id, normalized);
  }

  return dedupeEquivalentThreads([...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt));
}

async function loadRemoteThreads(userId: string): Promise<ChatThread[] | null> {
  try {
    const { supabase } = await import('../lib/supabase');
    if (!supabase) return null;

    const [threadResult, messageResult] = await Promise.all([
      supabase
        .from('ai_chat_threads')
        .select('id,user_id,title,created_at,updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false }),
      supabase
        .from('ai_chat_messages')
        .select('id,thread_id,user_id,role,content,images,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
    ]);

    if (threadResult.error || messageResult.error) {
      console.warn('[AI] Failed to load remote chats', threadResult.error ?? messageResult.error);
      return null;
    }

    return parseRemoteThreads(
      (threadResult.data ?? []) as RemoteChatThreadRow[],
      (messageResult.data ?? []) as RemoteChatMessageRow[],
    );
  } catch (error) {
    console.warn('[AI] Remote chat load failed', error);
    return null;
  }
}

async function saveRemoteThreads(userId: string, threads: ChatThread[]): Promise<boolean> {
  try {
    const { supabase } = await import('../lib/supabase');
    if (!supabase) return false;

    const sanitizedThreads = dedupeEquivalentThreads(threads.map(sanitizeThread));
    const threadRows = sanitizedThreads.map(thread => ({
      id: thread.id,
      user_id: userId,
      title: thread.title,
      created_at: new Date(thread.createdAt).toISOString(),
      updated_at: new Date(thread.updatedAt).toISOString(),
    }));
    const messageRows = dedupeRowsById(sanitizedThreads.flatMap(thread =>
      thread.messages.map(message => ({
        id: message.id,
        thread_id: thread.id,
        user_id: userId,
        role: message.role,
        content: message.content,
        images: (message.images ?? []).map(img => ({
          base64: img.base64,
          mimeType: img.mimeType,
          preview: img.preview,
        })),
        created_at: new Date(message.timestamp).toISOString(),
      })),
    ));

    const existingThreadsResult = await supabase
      .from('ai_chat_threads')
      .select('id')
      .eq('user_id', userId);

    if (existingThreadsResult.error) {
      console.warn('[AI] Failed to read remote thread ids', existingThreadsResult.error);
      return false;
    }

    const existingIds = new Set((existingThreadsResult.data ?? []).map(row => row.id as string));
    const nextIds = new Set(threadRows.map(row => row.id));
    const deletedIds = [...existingIds].filter(id => !nextIds.has(id));

    const existingMessagesResult = await supabase
      .from('ai_chat_messages')
      .select('id')
      .eq('user_id', userId);

    if (existingMessagesResult.error) {
      console.warn('[AI] Failed to read remote message ids', existingMessagesResult.error);
      return false;
    }

    const existingMessageIds = new Set((existingMessagesResult.data ?? []).map(row => row.id as string));
    const nextMessageIds = new Set(messageRows.map(row => row.id));
    const deletedMessageIds = [...existingMessageIds].filter(id => !nextMessageIds.has(id));

    const upsertThreadsResult = await supabase.from('ai_chat_threads').upsert(threadRows);
    if (upsertThreadsResult.error) {
      console.warn('[AI] Failed to save remote threads', upsertThreadsResult.error);
      return false;
    }

    if (deletedIds.length > 0) {
      const deleteThreadsResult = await supabase
        .from('ai_chat_threads')
        .delete()
        .eq('user_id', userId)
        .in('id', deletedIds);
      if (deleteThreadsResult.error) {
        console.warn('[AI] Failed to delete removed remote threads', deleteThreadsResult.error);
        return false;
      }
    }

    if (messageRows.length > 0) {
      const upsertMessagesResult = await supabase
        .from('ai_chat_messages')
        .upsert(messageRows, { onConflict: 'id' });
      if (upsertMessagesResult.error) {
        console.warn('[AI] Failed to save remote messages', upsertMessagesResult.error);
        return false;
      }
    }

    if (deletedMessageIds.length > 0) {
      const deleteMessagesResult = await supabase
        .from('ai_chat_messages')
        .delete()
        .eq('user_id', userId)
        .in('id', deletedMessageIds);
      if (deleteMessagesResult.error) {
        console.warn('[AI] Failed to delete removed remote messages', deleteMessagesResult.error);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.warn('[AI] Remote chat save failed', error);
    return false;
  }
}

export function useAI(userId: string) {
  const initialStateRef = useRef<{ threads: ChatThread[]; activeChatId: string } | null>(null);
  if (!initialStateRef.current) {
    initialStateRef.current = buildInitialChatState(userId);
  }

  const [threads, setThreads] = useState<ChatThread[]>(() => initialStateRef.current?.threads ?? [makeNewThread()]);
  const [activeChatId, setActiveChatId] = useState<string>(() => initialStateRef.current?.activeChatId ?? initialStateRef.current?.threads[0]?.id ?? makeNewThread().id);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasHydratedRemoteChats, setHasHydratedRemoteChats] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const threadsRef = useRef<ChatThread[]>(threads);
  const activeChatIdRef = useRef(activeChatId);
  const remoteSyncSignatureRef = useRef('');
  const remoteSaveRequestedRef = useRef(false);
  const remoteSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const initializedUserIdRef = useRef(userId);

  useEffect(() => {
    if (initializedUserIdRef.current === userId) return;
    initializedUserIdRef.current = userId;

    const nextState = buildInitialChatState(userId);
    initialStateRef.current = nextState;
    threadsRef.current = nextState.threads;
    activeChatIdRef.current = nextState.activeChatId;
    remoteSyncSignatureRef.current = '';
    remoteSaveRequestedRef.current = false;
    setThreads(nextState.threads);
    setActiveChatId(nextState.activeChatId);
    setHasHydratedRemoteChats(false);
    setError(null);
    setIsStreaming(false);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [userId]);

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

  const refreshRemoteChats = useCallback(async () => {
    const remoteThreads = await loadRemoteThreads(userId);
    if (remoteThreads === null) {
      setHasHydratedRemoteChats(true);
      return;
    }

    const localThreads = threadsRef.current;
    let nextThreads = remoteThreads;

    if (remoteThreads.length === 0 && localThreads.length > 0) {
      nextThreads = dedupeEquivalentThreads(localThreads.map(sanitizeThread));
      await saveRemoteThreads(userId, nextThreads);
    } else if (!hasHydratedRemoteChats && localThreads.length > 0) {
      nextThreads = mergeThreads(remoteThreads, localThreads);
      const mergedSignature = serializeThreads(nextThreads);
      const remoteSignature = serializeThreads(remoteThreads);
      if (mergedSignature !== remoteSignature) {
        await saveRemoteThreads(userId, nextThreads);
      }
    } else {
      nextThreads = dedupeEquivalentThreads(remoteThreads);
    }

    remoteSyncSignatureRef.current = serializeThreads(nextThreads);
    setThreads(nextThreads);
    setActiveChatId(prev => nextThreads.some(thread => thread.id === prev) ? prev : nextThreads[0]?.id ?? makeNewThread().id);
    setHasHydratedRemoteChats(true);
  }, [hasHydratedRemoteChats, userId]);

  useEffect(() => {
    void refreshRemoteChats();
  }, [refreshRemoteChats]);

  useEffect(() => {
    const refreshOnVisibility = () => {
      if (!document.hidden && !isStreaming) {
        void refreshRemoteChats();
      }
    };
    const refreshOnFocus = () => {
      if (!isStreaming) {
        void refreshRemoteChats();
      }
    };

    document.addEventListener('visibilitychange', refreshOnVisibility);
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      document.removeEventListener('visibilitychange', refreshOnVisibility);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [isStreaming, refreshRemoteChats]);

  // Persist threads to localStorage whenever they change
  useEffect(() => {
    if (!isStreaming) {
      saveThreads(userId, threads);
      sessionStorage.setItem(activeChatStorage(userId), activeChatId);
      localStorage.removeItem(LEGACY_CHAT_STORAGE);
    }
  }, [threads, activeChatId, isStreaming, userId]);

  useEffect(() => {
    if (!hasHydratedRemoteChats || isStreaming) return;
    const nextSignature = serializeThreads(threads);
    if (nextSignature === remoteSyncSignatureRef.current) return;

    remoteSaveRequestedRef.current = true;
    remoteSaveChainRef.current = remoteSaveChainRef.current
      .catch(() => {})
      .then(async () => {
        while (remoteSaveRequestedRef.current) {
          remoteSaveRequestedRef.current = false;
          const latestThreads = threadsRef.current;
          const latestSignature = serializeThreads(latestThreads);
          if (latestSignature === remoteSyncSignatureRef.current) continue;
          const saved = await saveRemoteThreads(userId, latestThreads);
          if (!saved) break;
          remoteSyncSignatureRef.current = latestSignature;
        }
      });
  }, [hasHydratedRemoteChats, isStreaming, threads, userId]);

  const updateThread = useCallback((threadId: string, updater: (thread: ChatThread) => ChatThread) => {
    setThreads(prev => prev.map(thread => thread.id === threadId ? updater(thread) : thread));
  }, [userId]);

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
    const key = await getAPIKey(userId);
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

    const userTimestamp = Date.now();

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      timestamp: userTimestamp,
      images: images?.length ? images : undefined,
    };

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '*Thinking...*',
      timestamp: userTimestamp + 1,
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
      // Send last 20 messages to keep payload size manageable
      const recentHistory = [...thread.messages, userMsg];
      const trimmedHistory = recentHistory.length > 20
        ? recentHistory.slice(-20)
        : recentHistory;
      await streamGemini(
        key,
        systemPrompt,
        trimmedHistory,
        updateContent,
        abortRef.current.signal,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const errMsg = err instanceof Error ? err.message : 'Something went wrong';
      setError(errMsg);
      // Keep the assistant message with whatever was streamed; only remove if still empty/thinking
      setThreads(prev => prev.map(item => {
        if (item.id !== threadId) return item;
        const assistantContent = item.messages.find(m => m.id === assistantMsg.id)?.content ?? '';
        const hasRealContent = assistantContent && assistantContent !== '*Thinking...*';
        if (hasRealContent) {
          // Keep partial response, append error notice
          return {
            ...item,
            messages: item.messages.map(m =>
              m.id === assistantMsg.id
                ? { ...m, content: assistantContent + '\n\n*(Response interrupted — try again)*' }
                : m
            ),
          };
        }
        // No content was streamed — remove the empty message
        return {
          ...item,
          messages: item.messages.filter(m => m.id !== assistantMsg.id),
        };
      }));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [userId]);

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
