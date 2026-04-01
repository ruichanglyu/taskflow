import { useMemo, useState } from 'react';
import { CalendarDays, Check, Pencil, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { cn } from '../utils/cn';
import type { Deadline } from '../types';
import type { AcademicPlanProposal, AcademicPlanProposalBlock } from '../lib/academicPlanning';
import { formatMinutesLabel, minutesToTimeValue } from '../lib/academicPlanning';

interface AcademicPlanningModalProps {
  open: boolean;
  selectedDeadlines: Deadline[];
  proposal: AcademicPlanProposal | null;
  isGenerating: boolean;
  isApplying: boolean;
  applyingBlockIds?: Set<string>;
  onClose: () => void;
  onRegenerate: () => void;
  onAcceptAll: () => void;
  onAcceptOne: (blockId: string) => void;
  onRejectAll: () => void;
  onRemoveBlock: (blockId: string) => void;
  onUpdateBlock: (blockId: string, updates: Partial<Pick<AcademicPlanProposalBlock, 'title' | 'dateKey' | 'startMinutes' | 'endMinutes' | 'notes' | 'explanation'>>) => void;
}

interface BlockEditorState {
  title: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  notes: string;
  explanation: string;
}

function buildEditorState(block: AcademicPlanProposalBlock): BlockEditorState {
  return {
    title: block.title,
    dateKey: block.dateKey,
    startTime: minutesToTimeValue(block.startMinutes),
    endTime: minutesToTimeValue(block.endMinutes),
    notes: block.notes,
    explanation: block.explanation,
  };
}

export function AcademicPlanningModal({
  open,
  selectedDeadlines,
  proposal,
  isGenerating,
  isApplying,
  applyingBlockIds = new Set<string>(),
  onClose,
  onRegenerate,
  onAcceptAll,
  onAcceptOne,
  onRejectAll,
  onRemoveBlock,
  onUpdateBlock,
}: AcademicPlanningModalProps) {
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<BlockEditorState | null>(null);

  const deadlineSummary = useMemo(() => {
    if (selectedDeadlines.length === 0) return 'No deadlines selected yet.';
    if (selectedDeadlines.length === 1) {
      return `${selectedDeadlines[0].title} due ${selectedDeadlines[0].dueDate}`;
    }
    return `${selectedDeadlines.length} deadlines selected`;
  }, [selectedDeadlines]);

  if (!open) return null;

  const startEditing = (block: AcademicPlanProposalBlock) => {
    setEditingBlockId(block.id);
    setEditorState(buildEditorState(block));
  };

  const stopEditing = () => {
    setEditingBlockId(null);
    setEditorState(null);
  };

  const saveEditing = () => {
    if (!editingBlockId || !editorState) return;
    const [startHour, startMinute] = editorState.startTime.split(':').map(Number);
    const [endHour, endMinute] = editorState.endTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) {
      return;
    }
    onUpdateBlock(editingBlockId, {
      title: editorState.title.trim(),
      dateKey: editorState.dateKey,
      startMinutes,
      endMinutes,
      notes: editorState.notes.trim(),
      explanation: editorState.explanation.trim(),
    });
    stopEditing();
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-[0_30px_80px_rgba(15,23,42,0.18)]"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-soft)] px-6 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <Sparkles size={18} />
              </span>
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">Study plan proposal</h2>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{deadlineSummary}</p>
              </div>
            </div>
            {proposal?.rationaleSummary && (
              <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
                {proposal.rationaleSummary}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--border-soft)] p-2 text-[var(--text-faint)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {isGenerating ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--accent)] shadow-sm">
                <RefreshCw size={22} className="animate-spin" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Building a realistic study plan</h3>
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  We’re looking at your deadlines, current calendar load, and behavior-learning signal before we suggest any study blocks.
                </p>
              </div>
            </div>
          ) : !proposal || proposal.blocks.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text-faint)] shadow-sm">
                <CalendarDays size={22} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">No study blocks ready yet</h3>
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  {proposal?.rationaleSummary
                    ?? 'We couldn’t find a realistic proposal in the currently loaded calendar window. Try regenerating after loading more calendar range or choosing a different deadline.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {proposal.blocks.map((block, index) => {
                const isEditing = editingBlockId === block.id;
                return (
                  <article key={block.id} className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
                            Block {index + 1}
                          </span>
                          <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
                            {block.deadlineType}
                          </span>
                          {block.edited && (
                            <span className="rounded-full bg-amber-500/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-300">
                              Edited
                            </span>
                          )}
                        </div>

                        {!isEditing ? (
                          <>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <h3 className="text-base font-semibold text-[var(--text-primary)]">{block.title}</h3>
                              <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                                AI suggested
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-[var(--text-secondary)]">
                              {block.dateKey} · {formatMinutesLabel(block.startMinutes)} – {formatMinutesLabel(block.endMinutes)}
                              {block.courseName ? ` · ${block.courseName}` : ''}
                            </p>
                            <p className="mt-1 text-[11px] font-medium text-[var(--accent)]">
                              Linked to {block.deadlineTitle}
                            </p>
                            <p className="mt-3 line-clamp-3 text-sm leading-6 text-[var(--text-secondary)]">{block.explanation}</p>
                            {block.notes && (
                              <p className="mt-2 text-xs leading-5 text-[var(--text-faint)]">{block.notes}</p>
                            )}
                          </>
                        ) : (
                          <div className="mt-3 grid gap-3">
                            <input
                              type="text"
                              value={editorState?.title ?? ''}
                              onChange={event => setEditorState(current => current ? { ...current, title: event.target.value } : current)}
                              className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                            />
                            <div className="grid gap-3 sm:grid-cols-3">
                              <input
                                type="date"
                                value={editorState?.dateKey ?? ''}
                                onChange={event => setEditorState(current => current ? { ...current, dateKey: event.target.value } : current)}
                                className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                              />
                              <input
                                type="time"
                                value={editorState?.startTime ?? ''}
                                onChange={event => setEditorState(current => current ? { ...current, startTime: event.target.value } : current)}
                                className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                              />
                              <input
                                type="time"
                                value={editorState?.endTime ?? ''}
                                onChange={event => setEditorState(current => current ? { ...current, endTime: event.target.value } : current)}
                                className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                              />
                            </div>
                            <textarea
                              rows={2}
                              value={editorState?.explanation ?? ''}
                              onChange={event => setEditorState(current => current ? { ...current, explanation: event.target.value } : current)}
                              className="w-full resize-none rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                            />
                            <textarea
                              rows={2}
                              value={editorState?.notes ?? ''}
                              onChange={event => setEditorState(current => current ? { ...current, notes: event.target.value } : current)}
                              className="w-full resize-none rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                              placeholder="Notes for the study block"
                            />
                          </div>
                        )}

                        {block.candidates.length > 0 && !isEditing && (
                          <div className="mt-4">
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                              Other good windows
                            </p>
                            <div className="flex flex-wrap gap-2">
                            {block.candidates.slice(0, 3).map(candidate => (
                              <span
                                key={`${block.id}-${candidate.startMinutes}`}
                                className={cn(
                                  'rounded-full border px-2.5 py-1 text-[10px] font-medium',
                                  candidate.selected
                                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                                    : 'border-[var(--border-soft)] text-[var(--text-faint)]'
                                )}
                              >
                                {formatMinutesLabel(candidate.startMinutes)} – {formatMinutesLabel(candidate.endMinutes)}
                              </span>
                            ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2 lg:w-[180px] lg:flex-col">
                        {!isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => onAcceptOne(block.id)}
                              disabled={isApplying}
                              className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-[var(--accent-contrast)] transition disabled:opacity-50"
                              style={{ backgroundColor: 'var(--accent-strong)' }}
                            >
                              <Check size={14} />
                              {applyingBlockIds.has(block.id) ? 'Scheduling...' : 'Accept'}
                            </button>
                            <button
                              type="button"
                              onClick={() => startEditing(block)}
                              className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border-soft)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                            >
                              <Pencil size={14} />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemoveBlock(block.id)}
                              className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border-soft)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:border-red-500/30 hover:text-red-400"
                            >
                              <Trash2 size={14} />
                              Remove
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={saveEditing}
                              className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-[var(--accent-contrast)] transition"
                              style={{ backgroundColor: 'var(--accent-strong)' }}
                            >
                              <Check size={14} />
                              Save edit
                            </button>
                            <button
                              type="button"
                              onClick={stopEditing}
                              className="rounded-xl border border-[var(--border-soft)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-[var(--border-soft)] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-[var(--text-muted)]">
            Nothing is written to Google Calendar until you accept a study block.
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRejectAll}
              className="rounded-xl border border-[var(--border-soft)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={onRegenerate}
              disabled={isGenerating || isApplying}
              className="flex items-center gap-2 rounded-xl border border-[var(--border-soft)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              <RefreshCw size={14} />
              Regenerate
            </button>
            <button
              type="button"
              onClick={onAcceptAll}
              disabled={!proposal || proposal.blocks.length === 0 || isGenerating || isApplying}
              className="rounded-xl px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] transition disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent-strong)' }}
            >
              {isApplying ? 'Scheduling...' : 'Accept all'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
