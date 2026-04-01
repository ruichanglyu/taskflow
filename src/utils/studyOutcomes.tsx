/**
 * Shared study-block outcome constants and components.
 */
import type { StudyBlockOutcomeStatus } from '../types';
import { cn } from './cn';

export const STUDY_OUTCOME_OPTIONS: { status: StudyBlockOutcomeStatus; label: string }[] = [
  { status: 'completed', label: 'Done' },
  { status: 'partial', label: 'Partial' },
  { status: 'skipped', label: 'Skipped' },
  { status: 'rescheduled', label: 'Rescheduled' },
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

export function OutcomeBadge({ status }: { status: StudyBlockOutcomeStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]', getOutcomeTone(status))}>
      {getOutcomeLabel(status)}
    </span>
  );
}
