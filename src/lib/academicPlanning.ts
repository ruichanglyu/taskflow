import type { Deadline, DeadlineType, Project, Task } from '../types';
import type { GoogleCalendarEvent, NewGoogleCalendarEvent } from './googleCalendar';
import { getAPIKey } from '../hooks/useAI';
import { addDays, formatDateKey } from '../utils/dateHelpers';

export interface DeadlineEmailImportRow {
  title: string;
  course: string;
  dueDate: string;
  dueTime: string | null;
  type: DeadlineType;
  notes: string;
  prepTaskTitle?: string | null;
  sourceType: 'email_import';
  sourceId: string;
}

export interface DeadlineEmailImportResult {
  rows: DeadlineEmailImportRow[];
  skippedRows: string[];
}

export interface AcademicPlanCandidate {
  startMinutes: number;
  endMinutes: number;
  score: number;
  distance: number;
  selected: boolean;
}

export interface AcademicPlanProposalBlock {
  id: string;
  deadlineId: string;
  deadlineTitle: string;
  deadlineDate: string;
  deadlineType: DeadlineType;
  projectId: string | null;
  courseName: string | null;
  linkedTaskIds: string[];
  title: string;
  dateKey: string;
  startMinutes: number;
  endMinutes: number;
  calendarId: string | null;
  notes: string;
  explanation: string;
  candidates: AcademicPlanCandidate[];
  edited: boolean;
}

export interface AcademicPlanProposal {
  id: string;
  createdAt: string;
  source: 'dashboard' | 'deadline' | 'ai';
  deadlineIds: string[];
  rationaleSummary: string;
  blocks: AcademicPlanProposalBlock[];
}

export type AcademicPlanOrigin = 'planner' | 'ai-assisted' | 'manual';

export interface AcademicPlanMetadata {
  deadlineId: string;
  deadlineTitle: string;
  deadlineDate: string;
  deadlineType: DeadlineType;
  courseName?: string | null;
  explanation?: string | null;
  notes?: string | null;
  origin?: AcademicPlanOrigin;
}

interface DeadlinePlanningContext {
  deadline: Deadline;
  project: Project | null;
  linkedTasks: Task[];
}

interface SlotSearchResult {
  startMinutes: number;
  endMinutes: number;
  candidates: Array<{ startMinutes: number; endMinutes: number; score: number; distance: number }>;
}

const GEMINI_TEXT_MODEL = 'gemini-3.1-flash-lite-preview';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DAY_START = 8 * 60;
const DAY_END = 23 * 60 + 45;
const FIFTEEN_MINUTES = 15;
const DEFAULT_CALENDAR_LABEL = 'Study Blocks';

function parseDateKey(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`);
}

export function formatMinutesLabel(totalMinutes: number) {
  const safeMinutes = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  const meridiem = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${meridiem}`;
}

export function minutesToTimeValue(totalMinutes: number) {
  const safeMinutes = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function buildLocalDateTimeString(dateKey: string, timeValue: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hours, minutes] = timeValue.split(':').map(Number);
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
  const offsetMins = String(absoluteOffset % 60).padStart(2, '0');

  return `${dateKey}T${timeValue}:00${sign}${offsetHours}:${offsetMins}`;
}

function daysBetween(from: string, to: string) {
  const fromDate = parseDateKey(from);
  const toDate = parseDateKey(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 0;
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function buildSourceId(prefix: string, value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return `${prefix}:${Math.abs(hash)}`;
}

function normalizeDeadlineType(raw: string | null | undefined): DeadlineType {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'assignment') return 'assignment';
  if (value === 'exam') return 'exam';
  if (value === 'quiz') return 'quiz';
  if (value === 'lab') return 'lab';
  if (value === 'project') return 'project';
  return 'other';
}

function normalizeDueDate(raw: string | null | undefined) {
  const value = (raw ?? '').trim();
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDateKey(parsed);
}

function normalizeDueTime(raw: string | null | undefined) {
  const value = (raw ?? '').trim();
  if (!value) return null;

  if (/^\d{2}:\d{2}$/.test(value)) return value;

  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/(\d)(AM|PM)$/i, '$1 $2')
    .trim()
    .toUpperCase();
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3];
  if (hours === 12) {
    hours = period === 'AM' ? 0 : 12;
  } else if (period === 'PM') {
    hours += 12;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function buildEmailFallbackRows(emailText: string) {
  const rows: DeadlineEmailImportRow[] = [];
  const skippedRows: string[] = [];
  const lines = emailText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const datePattern = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i;
  const timePattern = /\b(\d{1,2}:\d{2}\s?(?:AM|PM))\b/i;

  lines.forEach((line, index) => {
    const dateMatch = line.match(datePattern);
    if (!dateMatch) return;

    const dueDate = normalizeDueDate(dateMatch[1]);
    if (!dueDate) {
      skippedRows.push(`Line ${index + 1}: could not understand the date.`);
      return;
    }

    const beforeDate = line.slice(0, dateMatch.index).replace(/^[-*•\d.\s]+/, '').trim();
    const afterDate = line.slice((dateMatch.index ?? 0) + dateMatch[0].length).trim();
    const dueTime = normalizeDueTime(afterDate.match(timePattern)?.[1] ?? null);
    const title = beforeDate || `Imported deadline ${rows.length + 1}`;
    const type = normalizeDeadlineType(/exam|midterm|final/i.test(line) ? 'exam' : /quiz/i.test(line) ? 'quiz' : /lab/i.test(line) ? 'lab' : /project/i.test(line) ? 'project' : 'assignment');
    rows.push({
      title,
      course: '',
      dueDate,
      dueTime,
      type,
      notes: line,
      prepTaskTitle: `Prepare for ${title}`,
      sourceType: 'email_import',
      sourceId: buildSourceId('email', `${index}:${line}`),
    });
  });

  return { rows, skippedRows };
}

async function parseEmailImportWithGemini(userId: string, emailText: string): Promise<DeadlineEmailImportResult | null> {
  const apiKey = await getAPIKey(userId);
  if (!apiKey) return null;

  const prompt = `You are extracting academic deadlines from email text for a student planning app.

Return ONLY valid JSON in this shape:
{
  "rows": [
    {
      "title": "string",
      "course": "string",
      "dueDate": "YYYY-MM-DD",
      "dueTime": "HH:MM" | null,
      "type": "assignment" | "exam" | "quiz" | "lab" | "project" | "other",
      "notes": "string",
      "prepTaskTitle": "string" | null
    }
  ],
  "skippedRows": ["string"]
}

Rules:
- Extract only concrete academic work items with a date.
- Use 24-hour HH:MM for dueTime when a time is explicitly present.
- Keep course empty if unknown.
- Keep notes concise but useful.
- Generate one prepTaskTitle for each deadline when reasonable, such as "Prepare for Exam 2".
- Ignore greetings, signatures, and general announcements without a real due date.

EMAIL:
${emailText}`;

  const response = await fetch(`${GEMINI_API_URL}/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json().catch(() => null) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null;
  const text = payload?.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('').trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as { rows?: Array<Record<string, unknown>>; skippedRows?: unknown[] };
    const rows = (parsed.rows ?? []).map((row, index): DeadlineEmailImportRow | null => {
      const title = String(row.title ?? '').trim();
      const dueDate = normalizeDueDate(String(row.dueDate ?? ''));
      if (!title || !dueDate) return null;
      return {
        title,
        course: String(row.course ?? '').trim(),
        dueDate,
        dueTime: normalizeDueTime(row.dueTime ? String(row.dueTime) : null),
        type: normalizeDeadlineType(String(row.type ?? 'assignment')),
        notes: String(row.notes ?? '').trim(),
        prepTaskTitle: row.prepTaskTitle ? String(row.prepTaskTitle).trim() : null,
        sourceType: 'email_import',
        sourceId: buildSourceId('email', `${index}:${title}:${dueDate}`),
      };
    }).filter(Boolean) as DeadlineEmailImportRow[];

    return {
      rows,
      skippedRows: Array.isArray(parsed.skippedRows)
        ? parsed.skippedRows.filter((value): value is string => typeof value === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

export async function parseEmailIntoDeadlineImport(userId: string, emailText: string): Promise<DeadlineEmailImportResult> {
  const trimmed = emailText.trim();
  if (!trimmed) {
    throw new Error('Paste the email text first.');
  }

  const geminiResult = await parseEmailImportWithGemini(userId, trimmed);
  if (geminiResult && geminiResult.rows.length > 0) {
    return geminiResult;
  }

  const fallback = buildEmailFallbackRows(trimmed);
  if (fallback.rows.length === 0) {
    throw new Error('I could not find any deadlines in that email. Try pasting more of the email body.');
  }
  return fallback;
}

function getTimedEventDetails(event: GoogleCalendarEvent) {
  if (!event.start?.dateTime || !event.end?.dateTime) return null;

  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  if (endMinutes <= startMinutes) return null;

  return {
    dateKey: formatDateKey(start),
    startMinutes,
    endMinutes,
  };
}

function findFreeSlotForDuration(
  events: GoogleCalendarEvent[],
  dateKey: string,
  durationMinutes: number,
  preferredStartMinutes: number,
  minStartMinutes: number,
  scoreStudySlot?: (dateKey: string, startMinutes: number, durationMinutes: number) => number,
): SlotSearchResult | null {
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

  const candidates: Array<{ startMinutes: number; endMinutes: number; score: number; distance: number }> = [];

  for (const gap of gaps) {
    if (gap.end - gap.start < durationMinutes) continue;

    const gapStart = Math.max(gap.start, DAY_START, minStartMinutes);
    const gapEnd = Math.min(gap.end, DAY_END);
    let start = gapStart;
    while (start + durationMinutes <= gapEnd) {
      const preferenceScore = scoreStudySlot?.(dateKey, start, durationMinutes) ?? 0;
      const distance = Math.abs(start - preferredStartMinutes);
      const proximityBonus = Math.max(0, 1 - distance / 300);
      candidates.push({
        startMinutes: start,
        endMinutes: start + durationMinutes,
        score: preferenceScore + proximityBonus,
        distance,
      });
      start += FIFTEEN_MINUTES;
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.startMinutes - b.startMinutes;
  });

  return {
    startMinutes: candidates[0].startMinutes,
    endMinutes: candidates[0].endMinutes,
    candidates: candidates.slice(0, 6),
  };
}

function makeVirtualStudyEvent(block: Pick<AcademicPlanProposalBlock, 'title' | 'dateKey' | 'startMinutes' | 'endMinutes' | 'calendarId' | 'courseName'>): GoogleCalendarEvent {
  return {
    id: `virtual-${block.dateKey}-${block.startMinutes}-${block.title}`,
    summary: block.title,
    calendarId: block.calendarId ?? DEFAULT_CALENDAR_LABEL,
    calendarSummary: block.courseName ?? DEFAULT_CALENDAR_LABEL,
    start: { dateTime: buildLocalDateTimeString(block.dateKey, minutesToTimeValue(block.startMinutes)) },
    end: { dateTime: buildLocalDateTimeString(block.dateKey, minutesToTimeValue(block.endMinutes)) },
  };
}

function blockDurationsForDeadline(
  deadline: Deadline,
  linkedTasks: Task[],
  completionRate: number | null | undefined,
) {
  const baseMinutesByType: Record<DeadlineType, number> = {
    assignment: 75,
    exam: 195,
    quiz: 75,
    lab: 70,
    project: 180,
    other: 90,
  };
  const linkedTaskBonusByType: Record<DeadlineType, number> = {
    assignment: 15,
    exam: 25,
    quiz: 15,
    lab: 10,
    project: 25,
    other: 15,
  };
  const baseMinutes = baseMinutesByType[deadline.type] ?? 90;
  const linkedTaskBonus = Math.min(linkedTasks.length * (linkedTaskBonusByType[deadline.type] ?? 15), deadline.type === 'project' ? 90 : 45);
  let totalMinutes = baseMinutes + linkedTaskBonus;

  if (completionRate !== null && completionRate !== undefined && completionRate < 55) {
    totalMinutes = Math.round(totalMinutes * 1.25);
  } else if (completionRate !== null && completionRate !== undefined && completionRate < 70) {
    totalMinutes = Math.round(totalMinutes * 1.1);
  }

  totalMinutes = Math.max(deadline.type === 'exam' || deadline.type === 'project' ? 75 : 45, totalMinutes);

  let sessionCount = 1;
  if (deadline.type === 'exam' || deadline.type === 'project') {
    sessionCount = totalMinutes >= 210 ? 3 : totalMinutes >= 120 ? 2 : 1;
  } else {
    sessionCount = totalMinutes >= 120 ? 2 : 1;
  }

  let rawSessionMinutes = Math.max(45, Math.round((totalMinutes / sessionCount) / 15) * 15);
  const maxSessionMinutes = completionRate !== null && completionRate < 60 ? 75 : 105;
  rawSessionMinutes = Math.min(rawSessionMinutes, maxSessionMinutes);

  if ((deadline.type === 'assignment' || deadline.type === 'lab' || deadline.type === 'quiz') && sessionCount > 1 && rawSessionMinutes <= 45) {
    sessionCount = 1;
  }

  return Array.from({ length: sessionCount }, () => rawSessionMinutes);
}

function buildPlanningDays(deadline: Deadline) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = parseDateKey(deadline.dueDate);
  const days: string[] = [];

  const lastDate = new Date(dueDate);
  if (deadline.dueTime && deadline.dueTime >= '18:00') {
    // Late-night deadlines can still fit a same-day study block earlier in the day.
    lastDate.setHours(0, 0, 0, 0);
  } else {
    lastDate.setDate(lastDate.getDate() - 1);
  }

  if (lastDate < today) {
    // Deadline is already past — no realistic planning days remain
    return [];
  }

  for (let cursor = new Date(today); cursor <= lastDate; cursor = addDays(cursor, 1)) {
    days.push(formatDateKey(cursor));
  }

  return days.slice(0, 14);
}

function buildBlockExplanation(params: {
  deadline: Deadline;
  dateKey: string;
  startMinutes: number;
  candidates: Array<{ score: number; startMinutes: number; distance: number }>;
  daysBeforeDue: number;
  sessionIndex: number;
  totalSessions: number;
}) {
  const windowLabel = params.startMinutes < 12 * 60 ? 'morning' : params.startMinutes < 17 * 60 ? 'afternoon' : 'evening';
  const hasStrongFit = (params.candidates[0]?.score ?? 0) >= 1.1;
  const hasNearbyAlternatives = params.candidates.length > 1;
  const bufferText = params.daysBeforeDue > 1
    ? `It lands ${params.daysBeforeDue} days before the deadline so you have buffer.`
    : params.daysBeforeDue === 1
      ? 'It stays a day ahead of the deadline so you are not cramming at the end.'
      : 'The deadline is tight, so this is the earliest conflict-free slot I could keep realistic.';
  const learningText = hasStrongFit
    ? `This is one of your stronger ${windowLabel} study windows and it stays clear of existing calendar conflicts.`
    : `This slot still keeps you conflict-free, even though the learning signal is lighter here.`;
  const comparisonText = hasNearbyAlternatives
    ? 'I checked nearby open alternatives and kept the strongest fit.'
    : 'This was the clearest open window available in the current schedule.';
  const pacingText = params.totalSessions > 1
    ? `This is session ${params.sessionIndex + 1} of ${params.totalSessions} for ${params.deadline.title}.`
    : `This keeps ${params.deadline.title} contained in one focused block.`;

  return `${learningText} ${comparisonText} ${bufferText} ${pacingText}`;
}

function buildProposalSummary(deadlineContexts: DeadlinePlanningContext[], blocks: AcademicPlanProposalBlock[]) {
  if (blocks.length === 0) {
    return 'I could not find a realistic set of study blocks in the currently loaded calendar window.';
  }

  const uniqueDeadlines = new Set(blocks.map(block => block.deadlineId)).size;
  const earliestBlock = [...blocks].sort((a, b) => a.dateKey.localeCompare(b.dateKey))[0];
  const earliestLabel = earliestBlock ? `${earliestBlock.dateKey} at ${formatMinutesLabel(earliestBlock.startMinutes)}` : 'soon';
  const targetNames = deadlineContexts.map(context => context.deadline.title).slice(0, 3).join(', ');

  return `I built ${blocks.length} proposed study block${blocks.length === 1 ? '' : 's'} across ${uniqueDeadlines} deadline${uniqueDeadlines === 1 ? '' : 's'}, starting ${earliestLabel}. The plan leans toward your higher-scoring study windows and keeps work ahead of the due dates when it can. ${targetNames ? `Focus targets: ${targetNames}.` : ''}`;
}

function countExistingScheduledStudyBlocks(calendarEvents: GoogleCalendarEvent[], deadlineId: string) {
  return calendarEvents.filter(event => {
    if (event.status === 'cancelled') return false;
    const metadata = parseAcademicPlanMetadata(event.description);
    return metadata?.deadlineId === deadlineId;
  }).length;
}

export function buildAcademicPlanProposal(params: {
  deadlines: Deadline[];
  tasks: Task[];
  projects: Project[];
  calendarEvents: GoogleCalendarEvent[];
  selectedCalendarId?: string | null;
  source: 'dashboard' | 'deadline' | 'ai';
  scoreStudySlot?: (dateKey: string, startMinutes: number, durationMinutes: number) => number;
  completionRate?: number | null;
}) {
  const sortedContexts: DeadlinePlanningContext[] = params.deadlines
    .filter(deadline => deadline.status !== 'done' && deadline.status !== 'missed')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map(deadline => ({
      deadline,
      project: params.projects.find(project => project.id === deadline.projectId) ?? null,
      linkedTasks: params.tasks.filter(task => deadline.linkedTaskIds.includes(task.id)),
    }));

  const blocks: AcademicPlanProposalBlock[] = [];
  const fullyCoveredDeadlineTitles: string[] = [];

  sortedContexts.forEach(context => {
    const planningDays = buildPlanningDays(context.deadline);
    const durations = blockDurationsForDeadline(context.deadline, context.linkedTasks, params.completionRate);
    const existingScheduledCount = countExistingScheduledStudyBlocks(params.calendarEvents, context.deadline.id);
    const remainingDurations = durations.slice(existingScheduledCount);

    if (remainingDurations.length === 0) {
      fullyCoveredDeadlineTitles.push(context.deadline.title);
      return;
    }

    remainingDurations.forEach((durationMinutes, sessionIndex) => {
      let bestChoice: {
        dateKey: string;
        startMinutes: number;
        endMinutes: number;
        score: number;
        candidates: Array<{ startMinutes: number; endMinutes: number; score: number; distance: number }>;
      } | null = null;

      planningDays.forEach(dateKey => {
        const busyEvents = [
          ...params.calendarEvents,
          ...blocks.map(makeVirtualStudyEvent),
        ];
        // Use behavior learning to pick the preferred start: test a few windows
        // and pick whichever the scorer rates highest. Falls back to afternoon (14:00).
        const preferredStartMinutes = params.scoreStudySlot
          ? [9 * 60, 12 * 60, 15 * 60, 18 * 60, 20 * 60].reduce((best, candidate) => {
              const bestScore = params.scoreStudySlot!(dateKey, best, durationMinutes);
              const candidateScore = params.scoreStudySlot!(dateKey, candidate, durationMinutes);
              return candidateScore > bestScore ? candidate : best;
            })
          : 14 * 60;
        const slot = findFreeSlotForDuration(
          busyEvents,
          dateKey,
          durationMinutes,
          preferredStartMinutes,
          DAY_START,
          params.scoreStudySlot,
        );
        if (!slot) return;

        const daysBeforeDue = Math.max(daysBetween(dateKey, context.deadline.dueDate), 0);
        const spacingTarget = Math.max(0, planningDays.length - Math.round(((sessionIndex + 1) / (durations.length + 1)) * planningDays.length));
        const spacingPenalty = Math.abs(daysBeforeDue - spacingTarget) * 0.04;
        const sameDayPenalty = blocks.filter(block => block.dateKey === dateKey).length * 0.35;
        const adjustedScore = slot.candidates[0]?.score ?? 0;
        const combinedScore = adjustedScore - spacingPenalty - sameDayPenalty;

        if (!bestChoice || combinedScore > bestChoice.score) {
          bestChoice = {
            dateKey,
            startMinutes: slot.startMinutes,
            endMinutes: slot.endMinutes,
            score: combinedScore,
            candidates: slot.candidates,
          };
        }
      });

      if (!bestChoice) return;

      const blockTitleBase = context.project?.name
        ? `${context.project.name} ${context.deadline.title}`
        : context.deadline.title;

      const explanation = buildBlockExplanation({
        deadline: context.deadline,
        dateKey: bestChoice.dateKey,
        startMinutes: bestChoice.startMinutes,
        candidates: bestChoice.candidates,
        daysBeforeDue: Math.max(daysBetween(bestChoice.dateKey, context.deadline.dueDate), 0),
        sessionIndex: existingScheduledCount + sessionIndex,
        totalSessions: durations.length,
      });

      blocks.push({
        id: crypto.randomUUID(),
        deadlineId: context.deadline.id,
        deadlineTitle: context.deadline.title,
        deadlineDate: context.deadline.dueDate,
        deadlineType: context.deadline.type,
        projectId: context.deadline.projectId,
        courseName: context.project?.name ?? null,
        linkedTaskIds: context.deadline.linkedTaskIds,
        title: blockTitleBase,
        dateKey: bestChoice.dateKey,
        startMinutes: bestChoice.startMinutes,
        endMinutes: bestChoice.endMinutes,
        calendarId: params.selectedCalendarId ?? null,
        notes: context.linkedTasks.length > 0
          ? `Linked tasks: ${context.linkedTasks.map(task => task.title).join(', ')}`
          : '',
        explanation,
        candidates: bestChoice.candidates.map(candidate => ({
          startMinutes: candidate.startMinutes,
          endMinutes: candidate.endMinutes,
          score: candidate.score,
          distance: candidate.distance,
          selected: candidate.startMinutes === bestChoice?.startMinutes && candidate.endMinutes === bestChoice?.endMinutes,
        })),
        edited: false,
      });
    });
  });

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: params.source,
    deadlineIds: sortedContexts.map(context => context.deadline.id),
    rationaleSummary: blocks.length > 0
      ? buildProposalSummary(sortedContexts, blocks)
      : fullyCoveredDeadlineTitles.length > 0
        ? `These deadlines already have study blocks scheduled: ${fullyCoveredDeadlineTitles.slice(0, 3).join(', ')}. Regenerate only if you want to replace that plan.`
        : buildProposalSummary(sortedContexts, blocks),
    blocks: blocks.sort((a, b) => {
      const dateCompare = a.dateKey.localeCompare(b.dateKey);
      if (dateCompare !== 0) return dateCompare;
      return a.startMinutes - b.startMinutes;
    }),
  } as AcademicPlanProposal;
}

export function updateAcademicPlanBlock(
  proposal: AcademicPlanProposal,
  blockId: string,
  updates: Partial<Pick<AcademicPlanProposalBlock, 'title' | 'dateKey' | 'startMinutes' | 'endMinutes' | 'notes' | 'explanation' | 'calendarId'>>,
) {
  return {
    ...proposal,
    blocks: proposal.blocks.map(block => (
      block.id === blockId
        ? {
            ...block,
            ...updates,
            edited: true,
          }
        : block
    )),
  };
}

export function removeAcademicPlanBlock(proposal: AcademicPlanProposal, blockId: string) {
  return {
    ...proposal,
    blocks: proposal.blocks.filter(block => block.id !== blockId),
  };
}

export function buildAcademicPlanEvent(block: AcademicPlanProposalBlock): NewGoogleCalendarEvent {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    summary: block.title,
    description: buildAcademicPlanDescription(block),
    start: {
      dateTime: buildLocalDateTimeString(block.dateKey, minutesToTimeValue(block.startMinutes)),
      timeZone,
    },
    end: {
      dateTime: buildLocalDateTimeString(block.dateKey, minutesToTimeValue(block.endMinutes)),
      timeZone,
    },
  };
}

export function buildAcademicPlanMetadataDescription(metadata: AcademicPlanMetadata) {
  const details = [
    'TaskFlow Study Plan',
    `deadline-id: ${metadata.deadlineId}`,
    `deadline-title: ${metadata.deadlineTitle}`,
    `deadline-date: ${metadata.deadlineDate}`,
    `deadline-type: ${metadata.deadlineType}`,
    `origin: ${metadata.origin ?? 'planner'}`,
    metadata.courseName ? `course: ${metadata.courseName}` : null,
    metadata.explanation ? `why: ${metadata.explanation}` : null,
    metadata.notes ? `notes: ${metadata.notes}` : null,
  ].filter(Boolean);

  return details.join('\n');
}

export function buildAcademicPlanDescription(block: AcademicPlanProposalBlock) {
  return buildAcademicPlanMetadataDescription({
    deadlineId: block.deadlineId,
    deadlineTitle: block.deadlineTitle,
    deadlineDate: block.deadlineDate,
    deadlineType: block.deadlineType,
    courseName: block.courseName,
    explanation: block.explanation,
    notes: block.notes,
    origin: 'planner',
  });
}

export function parseAcademicPlanMetadata(description?: string | null) {
  if (!description || !description.includes('TaskFlow Study Plan')) return null;

  const lines = description.split('\n').map(line => line.trim());
  const getValue = (prefix: string) => {
    const line = lines.find(item => item.toLowerCase().startsWith(`${prefix.toLowerCase()}:`));
    return line ? line.slice(prefix.length + 1).trim() : null;
  };

  return {
    deadlineId: getValue('deadline-id'),
    deadlineTitle: getValue('deadline-title'),
    deadlineDate: getValue('deadline-date'),
    deadlineType: normalizeDeadlineType(getValue('deadline-type')),
    courseName: getValue('course'),
    explanation: getValue('why'),
    notes: getValue('notes'),
    origin: (() => {
      const value = getValue('origin');
      if (value === 'ai-suggested') return 'ai-assisted';
      if (value === 'ai-assisted') return 'ai-assisted';
      if (value === 'manual') return 'manual';
      return 'planner';
    })(),
  };
}

export function summarizeAcademicPlanningMetrics(params: {
  appBehaviorEvents: Array<{ entity: string; action: string; detail: string | null }>;
  calendarEvents: GoogleCalendarEvent[];
  getStudyBlockOutcomeStatus?: (event: GoogleCalendarEvent) => 'completed' | 'partial' | 'skipped' | 'rescheduled' | undefined;
}) {
  const generated = params.appBehaviorEvents.filter(event => event.entity === 'study-block' && event.action === 'plan-generated').length;
  const accepted = params.appBehaviorEvents.filter(event => event.entity === 'study-block' && event.action === 'plan-accepted').length;
  const edited = params.appBehaviorEvents.filter(event => event.entity === 'study-block' && event.action === 'plan-edited').length;
  const rejected = params.appBehaviorEvents.filter(event => event.entity === 'study-block' && event.action === 'plan-rejected').length;

  const acceptedEvents = params.calendarEvents.filter(event => parseAcademicPlanMetadata(event.description));
  const reviewedAcceptedEvents = acceptedEvents.filter(event => params.getStudyBlockOutcomeStatus?.(event));
  const completedAcceptedEvents = reviewedAcceptedEvents.filter(event => {
    const status = params.getStudyBlockOutcomeStatus?.(event);
    return status === 'completed' || status === 'partial';
  });

  return {
    generated,
    accepted,
    edited,
    rejected,
    acceptanceRate: generated > 0 ? Math.round((accepted / generated) * 100) : null,
    completionRate: reviewedAcceptedEvents.length > 0
      ? Math.round((completedAcceptedEvents.length / reviewedAcceptedEvents.length) * 100)
      : null,
  };
}
