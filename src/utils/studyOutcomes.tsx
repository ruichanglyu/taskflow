/**
 * Shared study-block outcome constants and components.
 */
import type { StudyBlockOutcomeStatus, StudyBlockReflection } from '../types';
import { cn } from './cn';

export const STUDY_OUTCOME_OPTIONS: { status: StudyBlockOutcomeStatus; label: string }[] = [
  { status: 'completed', label: 'Done' },
  { status: 'partial', label: 'Partial' },
  { status: 'skipped', label: 'Skipped' },
  { status: 'rescheduled', label: 'Rescheduled' },
];

export const STUDY_REFLECTION_OPTIONS: { value: StudyBlockReflection; label: string }[] = [
  { value: 'too_short', label: 'Too short' },
  { value: 'just_right', label: 'Good length' },
  { value: 'too_long', label: 'Too long' },
];

export function getOutcomeTone(status: StudyBlockOutcomeStatus) {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500/12 text-emerald-300 border-emerald-500/20';
    case 'partial':
      return 'bg-amber-500/12 text-amber-300 border-amber-500/20';
    case 'skipped':
      return 'bg-rose-500/12 text-rose-300 border-rose-500/20';
    case 'rescheduled':
      return 'bg-sky-500/12 text-sky-300 border-sky-500/20';
  }
}

export function getOutcomeLabel(status: StudyBlockOutcomeStatus) {
  return STUDY_OUTCOME_OPTIONS.find(option => option.status === status)?.label ?? status;
}

export function getReflectionLabel(reflection: StudyBlockReflection) {
  return STUDY_REFLECTION_OPTIONS.find(option => option.value === reflection)?.label ?? reflection;
}

export function parseStudyOutcomeReflection(notes?: string | null): StudyBlockReflection | null {
  if (!notes) return null;
  const match = notes.match(/(?:^|\n)reflection:\s*(too_short|just_right|too_long)(?:\n|$)/i);
  if (!match) return null;
  const value = match[1].toLowerCase();
  return value === 'too_short' || value === 'just_right' || value === 'too_long' ? value : null;
}

export function stripStudyOutcomeMetadata(notes?: string | null) {
  if (!notes) return '';
  return notes
    .split('\n')
    .filter(line => !/^reflection:\s*/i.test(line.trim()))
    .join('\n')
    .trim();
}

export function buildStudyOutcomeNotes(params: {
  reflection?: StudyBlockReflection | null;
  freeform?: string | null;
}) {
  const lines = [
    params.reflection ? `reflection: ${params.reflection}` : null,
    params.freeform?.trim() || null,
  ].filter(Boolean);
  return lines.join('\n').trim();
}

export function OutcomeBadge({ status }: { status: StudyBlockOutcomeStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]', getOutcomeTone(status))}>
      {getOutcomeLabel(status)}
    </span>
  );
}

export function ReflectionBadge({ reflection }: { reflection: StudyBlockReflection }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
      {getReflectionLabel(reflection)}
    </span>
  );
}
