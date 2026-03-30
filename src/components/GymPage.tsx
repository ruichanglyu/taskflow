import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import {
  Dumbbell, Plus, Play, Square, ChevronRight, ChevronDown,
  Trash2, Edit3, Check, X, Timer, RotateCcw, History,
  Trophy, TrendingUp, GripVertical, Camera, CalendarDays,
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable, type DropResult, type DraggableProvidedDragHandleProps } from '@hello-pangea/dnd';
import type {
  WorkoutPlan, WorkoutDayTemplate, Exercise,
  WorkoutDayExercise, WorkoutSession, WorkoutExerciseLog, WorkoutSetLog,
} from '../types';
import { cn } from '../utils/cn';

type GymTab = 'plan' | 'workout' | 'history' | 'library';

interface ParsedWorkoutPlan {
  name: string;
  description: string;
  daysPerWeek: number;
  days: {
    name: string;
    notes: string;
    exercises: {
      name: string;
      targetSets: number;
      targetReps: string;
      restSeconds: number;
    }[];
  }[];
}

function normalizeWorkoutName(raw: string) {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function parseRestSeconds(text: string): number {
  const minuteRange = text.match(/(\d+)\s*[–-]\s*(\d+)\s*min/i);
  if (minuteRange) return Math.round(((Number(minuteRange[1]) + Number(minuteRange[2])) / 2) * 60);

  const minuteSingle = text.match(/(\d+)\s*min/i);
  if (minuteSingle) return Number(minuteSingle[1]) * 60;

  const secondRange = text.match(/(\d+)\s*[–-]\s*(\d+)\s*sec/i);
  if (secondRange) return Math.round((Number(secondRange[1]) + Number(secondRange[2])) / 2);

  const secondSingle = text.match(/(\d+)\s*sec/i);
  if (secondSingle) return Number(secondSingle[1]);

  return 90;
}

function parseExerciseLine(line: string) {
  const trimmed = line.replace(/^[•-]\s*/, '').trim();
  const match = trimmed.match(/^(.*?)\s+[—-]\s+(.+)$/);
  if (!match) return null;

  const name = normalizeWorkoutName(match[1]);
  const prescription = match[2].trim();

  const setRepMatch = prescription.match(/(\d+)\s*x\s*([\d,\s–-]+(?:AMRAP)?|AMRAP)/i);
  if (setRepMatch) {
    return {
      name,
      targetSets: Number(setRepMatch[1]),
      targetReps: setRepMatch[2].replace(/\s+/g, ' ').trim(),
      restSeconds: 90,
    };
  }

  const setsOnly = prescription.match(/(\d+)(?:\s*[–-]\s*(\d+))?\s+sets?/i);
  if (setsOnly) {
    const lower = Number(setsOnly[1]);
    const upper = setsOnly[2] ? Number(setsOnly[2]) : lower;
    return {
      name,
      targetSets: upper,
      targetReps: 'AMRAP',
      restSeconds: 90,
    };
  }

  return {
    name,
    targetSets: 3,
    targetReps: prescription,
    restSeconds: 90,
  };
}

function parseWorkoutPlanText(raw: string): ParsedWorkoutPlan {
  const normalized = raw.replace(/\r/g, '').trim();
  if (!normalized) {
    throw new Error('Paste a workout plan first.');
  }

  const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
  const name = lines[0];
  const splitIndex = lines.findIndex(line => line.toUpperCase().startsWith('WEEKLY SPLIT'));
  if (splitIndex === -1) {
    throw new Error('Could not find a WEEKLY SPLIT section.');
  }

  const dayHeaderIndexes = lines
    .map((line, index) => (/^DAY\s+\d+/i.test(line) ? index : -1))
    .filter(index => index >= 0);

  if (dayHeaderIndexes.length === 0) {
    throw new Error('Could not find any day sections.');
  }

  const descriptionParts = lines.slice(1, splitIndex).filter(line => !/^GOAL:?$/i.test(line) && !/^[-–—]+$/.test(line));
  const weeklySplitStart = splitIndex + 1;
  const weeklySplitEnd = dayHeaderIndexes[0];
  const weeklySplitLines = lines.slice(weeklySplitStart, weeklySplitEnd).filter(line => /^Day\s+\d+/i.test(line));

  const parsedDays = dayHeaderIndexes.map((startIndex, idx) => {
    const endIndex = dayHeaderIndexes[idx + 1] ?? lines.length;
    const header = lines[startIndex];
    const titleMatch = header.match(/^DAY\s+\d+\s+[—-]\s+(.+)$/i);
    const dayName = titleMatch ? titleMatch[1].trim() : header;
    const sectionLines = lines.slice(startIndex + 1, endIndex).filter(line => !/^[-–—]+$/.test(line));

    let defaultRest = 90;
    let inRestBlock = false;
    const notes: string[] = [];
    const exercises: ParsedWorkoutPlan['days'][number]['exercises'] = [];

    for (const line of sectionLines) {
      if (/^REST:?$/i.test(line)) {
        inRestBlock = true;
        continue;
      }

      if (/^(NOTE|CARDIO|KEY RULES?|PROGRESSION RULE|RESULT TIMELINE|FINAL GOAL):?/i.test(line)) {
        inRestBlock = false;
        notes.push(line.replace(/:$/, ''));
        continue;
      }

      if (/^[•-]\s*/.test(line)) {
        if (inRestBlock) {
          defaultRest = parseRestSeconds(line);
          notes.push(`Rest guidance: ${line.replace(/^[•-]\s*/, '')}`);
          continue;
        }

        const parsedExercise = parseExerciseLine(line);
        if (parsedExercise) {
          exercises.push({ ...parsedExercise, restSeconds: defaultRest });
        } else {
          notes.push(line.replace(/^[•-]\s*/, ''));
        }
        continue;
      }

      if (/^OR$/i.test(line)) {
        notes.push('OR');
        continue;
      }

      notes.push(line);
    }

    return {
      name: dayName,
      notes: notes.join('\n').trim(),
      exercises,
    };
  });

  return {
    name,
    description: [descriptionParts.join('\n'), weeklySplitLines.length > 0 ? `Weekly split:\n${weeklySplitLines.join('\n')}` : ''].filter(Boolean).join('\n\n'),
    daysPerWeek: weeklySplitLines.length || parsedDays.filter(day => day.exercises.length > 0).length || parsedDays.length,
    days: parsedDays,
  };
}

interface GymPageProps {
  plans: WorkoutPlan[];
  dayTemplates: WorkoutDayTemplate[];
  exercises: Exercise[];
  dayExercises: WorkoutDayExercise[];
  sessions: WorkoutSession[];
  exerciseLogs: WorkoutExerciseLog[];
  setLogs: WorkoutSetLog[];
  activePlan: WorkoutPlan | null;
  activeSession: WorkoutSession | null;
  onAddPlan: (name: string, description: string, daysPerWeek: number) => Promise<string | null>;
  onUpdatePlan: (id: string, updates: Partial<Pick<WorkoutPlan, 'name' | 'description' | 'daysPerWeek' | 'isActive'>>) => Promise<boolean>;
  onDeletePlan: (id: string) => void;
  onAddDayTemplate: (planId: string, name: string) => Promise<string | null>;
  onUpdateDayTemplate: (id: string, updates: Partial<Pick<WorkoutDayTemplate, 'name' | 'notes' | 'position'>>) => Promise<boolean>;
  onDeleteDayTemplate: (id: string) => void;
  onAddExercise: (name: string, muscleGroup: string, notes: string, referenceImageUrl?: string) => Promise<string | null>;
  onUpdateExercise: (id: string, updates: Partial<Pick<Exercise, 'name' | 'muscleGroup' | 'notes' | 'referenceImageUrl'>>) => Promise<boolean>;
  onDeleteExercise: (id: string) => void;
  onAddDayExercise: (dayTemplateId: string, exerciseId: string, targetSets: number, targetReps: string, restSeconds: number) => Promise<string | null>;
  onUpdateDayExercise: (id: string, updates: Partial<Pick<WorkoutDayExercise, 'targetSets' | 'targetReps' | 'restSeconds' | 'notes' | 'position'>>) => Promise<boolean>;
  onDeleteDayExercise: (id: string) => void;
  onStartSession: (planId: string, dayTemplateId: string) => Promise<string | null>;
  onCompleteSession: (id: string, status?: 'completed' | 'abandoned') => void;
  onDeleteSession: (id: string) => void;
  onUpdateSetLog: (id: string, updates: Partial<Pick<WorkoutSetLog, 'weight' | 'reps' | 'completed'>>) => Promise<boolean>;
  getLastPerformance: (exerciseId: string, currentSessionId?: string) => WorkoutSetLog[];
  onUploadExercisePhoto: (exerciseLogId: string, file: File) => Promise<string | null>;
  onUploadExerciseImage: (exerciseId: string, file: File) => Promise<string | null>;
}

export function GymPage(props: GymPageProps) {
  const { activeSession } = props;
  const planCount = props.plans.length;
  const workoutDayCount = props.dayTemplates.length;
  const exerciseCount = props.exercises.length;

  const [tab, setTab] = useState<GymTab>(activeSession ? 'workout' : 'plan');

  // Auto-switch to workout tab when session starts
  useEffect(() => {
    if (activeSession) setTab('workout');
  }, [activeSession?.id]);

  const tabs: { key: GymTab; label: string; icon: ReactNode }[] = [
    { key: 'plan', label: 'Plan', icon: <Dumbbell size={16} /> },
    { key: 'workout', label: 'Workout', icon: <Play size={16} /> },
    { key: 'history', label: 'History', icon: <History size={16} /> },
    { key: 'library', label: 'Exercise Library', icon: <Camera size={16} /> },
  ];

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">Gym</h1>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:min-w-[280px]">
            <StatPill label="Plans" value={planCount.toString()} />
            <StatPill label="Days" value={workoutDayCount.toString()} />
            <StatPill label="Exercises" value={exerciseCount.toString()} />
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-1.5">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all',
              tab === t.key
                ? 'bg-[var(--surface-elevated)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            )}
          >
            {t.icon}
            {t.label}
            {t.key === 'workout' && activeSession && (
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {tab === 'plan' && <PlanTab {...props} />}
      {tab === 'workout' && <WorkoutTab {...props} />}
      {tab === 'history' && <HistoryTab {...props} />}
      {tab === 'library' && <ExerciseLibraryTab {...props} />}
    </div>
  );
}

// ============================================================
// PLAN TAB
// ============================================================

function PlanTab(props: GymPageProps) {
  const { plans, activePlan, dayTemplates, exercises, dayExercises } = props;
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(activePlan?.id ?? plans[0]?.id ?? null);
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [showImportPlan, setShowImportPlan] = useState(false);
  const [pendingDeletePlan, setPendingDeletePlan] = useState<WorkoutPlan | null>(null);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanDays, setNewPlanDays] = useState(5);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [newDayName, setNewDayName] = useState('');
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [pendingDeleteDay, setPendingDeleteDay] = useState<WorkoutDayTemplate | null>(null);

  // Wizard modal state
  const [wizardStep, setWizardStep] = useState<'days' | 'exercises' | null>(null);
  const [wizardDayIndex, setWizardDayIndex] = useState(0);
  // Exercise form state for wizard
  const [wizExName, setWizExName] = useState('');
  const [wizExId, setWizExId] = useState('');
  const [wizExImageFile, setWizExImageFile] = useState<File | null>(null);
  const [wizExImagePreview, setWizExImagePreview] = useState<string | null>(null);
  const [wizSets, setWizSets] = useState(3);
  const [wizReps, setWizReps] = useState('10');
  const [wizRest, setWizRest] = useState(45);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);

  useEffect(() => {
    if (plans.length === 0) {
      setSelectedPlanId(null);
      return;
    }

    const stillExists = selectedPlanId ? plans.some(plan => plan.id === selectedPlanId) : false;
    if (!stillExists) {
      setSelectedPlanId(activePlan?.id ?? plans[0]?.id ?? null);
    }
  }, [activePlan?.id, plans, selectedPlanId]);

  useEffect(() => {
    setExpandedDay(null);
  }, [selectedPlanId]);

  useEffect(() => {
    return () => {
      if (wizExImagePreview) URL.revokeObjectURL(wizExImagePreview);
    };
  }, [wizExImagePreview]);

  const selectedPlan = selectedPlanId
    ? plans.find(plan => plan.id === selectedPlanId) ?? null
    : activePlan ?? plans[0] ?? null;

  const selectedPlanDays = selectedPlan
    ? dayTemplates.filter(d => d.planId === selectedPlan.id).sort((a, b) => a.position - b.position)
    : [];

  const selectedPlanExerciseCount = selectedPlan
    ? dayExercises.filter(de =>
      selectedPlanDays.some(day => day.id === de.workoutDayTemplateId)
    ).length
    : 0;

  const planCards = plans.map(plan => {
    const planDays = dayTemplates.filter(d => d.planId === plan.id);
    const exerciseCount = dayExercises.filter(de =>
      planDays.some(day => day.id === de.workoutDayTemplateId)
    ).length;

    return {
      plan,
      dayCount: planDays.length,
      exerciseCount,
    };
  });

  const handleCreatePlan = async () => {
    if (!newPlanName.trim()) return;
    const planId = await props.onAddPlan(newPlanName.trim(), '', newPlanDays);
    if (planId) {
      setSelectedPlanId(planId);
      // Auto-open wizard to add days
      setWizardStep('days');
      setWizardDayIndex(0);
      setNewDayName('');
    }
    setNewPlanName('');
    setShowNewPlan(false);
  };

  const resetWizardExerciseForm = () => {
    setWizExName('');
    setWizExId('');
    setWizExImageFile(null);
    if (wizExImagePreview) {
      URL.revokeObjectURL(wizExImagePreview);
      setWizExImagePreview(null);
    }
  };

  const handleAddDay = async () => {
    if (!selectedPlan || !newDayName.trim()) return;
    await props.onAddDayTemplate(selectedPlan.id, newDayName.trim());
    setNewDayName('');
  };

  const handleImportPlan = async () => {
    setImportError(null);
    setIsImporting(true);

    try {
      const parsed = parseWorkoutPlanText(importText);
      const planId = await props.onAddPlan(parsed.name, parsed.description, parsed.daysPerWeek);

      if (!planId) {
        throw new Error('Could not create the workout plan.');
      }

      const exerciseIdsByName = new Map(
        exercises.map(exercise => [exercise.name.trim().toLowerCase(), exercise.id] as const)
      );

      for (const day of parsed.days) {
        const dayId = await props.onAddDayTemplate(planId, day.name);
        if (!dayId) continue;

        if (day.notes) {
          await props.onUpdateDayTemplate(dayId, { notes: day.notes });
        }

        for (const exercise of day.exercises) {
          const key = exercise.name.trim().toLowerCase();
          let exerciseId = exerciseIdsByName.get(key) ?? null;

          if (!exerciseId) {
            exerciseId = await props.onAddExercise(exercise.name, '', '', undefined);
            if (exerciseId) {
              exerciseIdsByName.set(key, exerciseId);
            }
          }

          if (!exerciseId) continue;
          await props.onAddDayExercise(dayId, exerciseId, exercise.targetSets, exercise.targetReps, exercise.restSeconds);
        }
      }

      setSelectedPlanId(planId);
      setImportText('');
      setShowImportPlan(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not import that workout plan.');
    } finally {
      setIsImporting(false);
    }
  };

  // Wizard: add exercise (create new or pick from library)
  const handleWizardAddExercise = async () => {
    const currentDay = selectedPlanDays[wizardDayIndex];
    if (!currentDay) return;

    if (wizExId) {
      // Pick from library
      await props.onAddDayExercise(currentDay.id, wizExId, wizSets, wizReps, wizRest);
    } else if (wizExName.trim()) {
      // Create new exercise + add
      const exId = await props.onAddExercise(wizExName.trim(), '', '', undefined);
      if (exId) {
        if (wizExImageFile) {
          await props.onUploadExerciseImage(exId, wizExImageFile);
        }
        await props.onAddDayExercise(currentDay.id, exId, wizSets, wizReps, wizRest);
      }
    }
    // Reset form but keep modal open for adding more
    resetWizardExerciseForm();
    setWizSets(3);
    setWizReps('10');
    setWizRest(45);
  };

  const openDayWizard = () => {
    setWizardStep('days');
    setNewDayName('');
  };

  const openExerciseWizardForDay = (dayId: string) => {
    const dayIndex = selectedPlanDays.findIndex(day => day.id === dayId);
    if (dayIndex < 0) return;
    setWizardDayIndex(dayIndex);
    setWizardStep('exercises');
    resetWizardExerciseForm();
    setWizSets(3);
    setWizReps('10');
    setWizRest(45);
  };

  const handleWizardImageFile = (file: File | null | undefined) => {
    if (!file) return;
    if (wizExImagePreview) URL.revokeObjectURL(wizExImagePreview);
    const preview = URL.createObjectURL(file);
    setWizExImageFile(file);
    setWizExImagePreview(preview);
  };

  const clearWizardImageFile = () => {
    if (wizExImagePreview) URL.revokeObjectURL(wizExImagePreview);
    setWizExImageFile(null);
    setWizExImagePreview(null);
  };

  const wizardCurrentDay = wizardStep === 'exercises' ? selectedPlanDays[wizardDayIndex] : null;
  const wizardCurrentDayExercises = wizardCurrentDay
    ? dayExercises.filter(de => de.workoutDayTemplateId === wizardCurrentDay.id).sort((a, b) => a.position - b.position)
    : [];

  const handleDayDragEnd = async (result: DropResult) => {
    if (!result.destination || result.source.index === result.destination.index) return;
    const reordered = [...selectedPlanDays];
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    // Update positions for all affected days
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].position !== i) {
        await props.onUpdateDayTemplate(reordered[i].id, { position: i });
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section className="space-y-4">
          {!selectedPlan ? (
            <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-8 text-center shadow-sm">
              <Dumbbell size={44} className="mx-auto mb-4 text-[var(--accent)]" />
              <p className="mb-2 text-lg font-semibold text-[var(--text-primary)]">No workout plan yet</p>
              <p className="mb-4 text-sm text-[var(--text-muted)]">Create a plan or import one, then open it to organize the days inside.</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  onClick={() => setShowNewPlan(true)}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-[var(--accent-contrast)]"
                  style={{ backgroundColor: 'var(--accent-strong)' }}
                >
                  <Plus size={16} />
                  New Plan
                </button>
                <button
                  onClick={() => setShowImportPlan(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-soft)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--accent)]"
                >
                  Import Plan
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]">Selected plan</div>
                    <h2 className="mt-1 truncate text-xl font-bold text-[var(--text-primary)]">{selectedPlan.name}</h2>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      {selectedPlan.daysPerWeek} days/week · {selectedPlanDays.length} workout days · {selectedPlanExerciseCount} exercises
                    </p>
                    {selectedPlan.description && (
                      <p className="mt-3 max-w-3xl whitespace-pre-line text-sm text-[var(--text-muted)]">{selectedPlan.description}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!selectedPlan.isActive && (
                      <button
                        onClick={() => void props.onUpdatePlan(selectedPlan.id, { isActive: true })}
                        className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        Set Active
                      </button>
                    )}
                    <button
                      onClick={() => setShowImportPlan(true)}
                      className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      Import plan
                    </button>
                    <button
                      onClick={() => setPendingDeletePlan(selectedPlan)}
                      className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--text-faint)] transition hover:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Workout Days</h3>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{selectedPlanDays.length > 0 ? 'Click a day to see and edit exercises.' : 'Add days to structure your weekly routine.'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={openDayWizard}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-soft)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      <Plus size={14} />
                      Add Day
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  {selectedPlanDays.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[var(--border-soft)] px-4 py-10 text-center">
                      <CalendarDays size={32} className="mx-auto mb-3 text-[var(--text-faint)]" />
                      <p className="mb-1 text-sm font-medium text-[var(--text-primary)]">No workout days yet</p>
                      <p className="mb-4 text-xs text-[var(--text-muted)]">Each day represents a workout session in your routine (e.g. Push, Pull, Legs).</p>
                      <button
                        onClick={openDayWizard}
                        className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-[var(--accent-contrast)]"
                        style={{ backgroundColor: 'var(--accent-strong)' }}
                      >
                        <Plus size={16} />
                        Add Your First Day
                      </button>
                    </div>
                  ) : (
                    <DragDropContext onDragEnd={handleDayDragEnd}>
                      <Droppable droppableId="workout-days">
                        {(provided) => (
                          <div className="space-y-2" ref={provided.innerRef} {...provided.droppableProps}>
                            {selectedPlanDays.map((day, idx) => (
                              <Draggable key={day.id} draggableId={day.id} index={idx}>
                                {(dragProvided, dragSnapshot) => (
                                  <div
                                    ref={dragProvided.innerRef}
                                    {...dragProvided.draggableProps}
                                    style={dragProvided.draggableProps.style}
                                  >
                                    <WorkoutDayCard
                                      day={day}
                                      dayNumber={idx + 1}
                                      isExpanded={expandedDay === day.id}
                                      onToggle={() => setExpandedDay(expandedDay === day.id ? null : day.id)}
                                      exercises={exercises}
                                      dayExercises={dayExercises.filter(de => de.workoutDayTemplateId === day.id).sort((a, b) => a.position - b.position)}
                                      onUpdateDay={props.onUpdateDayTemplate}
                                      onRequestDeleteDay={() => setPendingDeleteDay(day)}
                                      onUpdateDayExercise={props.onUpdateDayExercise}
                                      onDeleteDayExercise={props.onDeleteDayExercise}
                                      onOpenExerciseWizard={() => openExerciseWizardForDay(day.id)}
                                      dragHandleProps={dragProvided.dragHandleProps}
                                      isDragging={dragSnapshot.isDragging}
                                    />
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </DragDropContext>
                  )}
                </div>
              </div>

            </>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]">Workout plans</div>
                <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{plans.length} total</div>
              </div>
              <button
                onClick={() => setShowNewPlan(true)}
                className="rounded-xl border border-[var(--border-soft)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
              >
                Add
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {planCards.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--border-soft)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                  No plans yet. Create one or import a routine.
                </div>
              ) : (
                planCards.map(({ plan, dayCount, exerciseCount }) => {
                  const isSelected = selectedPlan?.id === plan.id;
                  const isActive = plan.isActive;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={cn(
                        'w-full rounded-lg border px-4 py-3 text-left transition',
                        isSelected
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)]/40 shadow-md'
                          : 'border-[var(--border-soft)] bg-[var(--surface-elevated)] hover:border-[var(--border-strong)]'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{plan.name}</div>
                          <div className="mt-1 text-[11px] text-[var(--text-faint)]">
                            {plan.daysPerWeek} days/week · {dayCount} days · {exerciseCount} exercises
                          </div>
                        </div>
                        {isActive && (
                          <span className="shrink-0 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                            Active
                          </span>
                        )}
                      </div>
                      {plan.description && (
                        <p className="mt-2 line-clamp-2 text-xs text-[var(--text-muted)]">{plan.description}</p>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

        </aside>
      </div>

      {/* Create Plan Modal */}
      {showNewPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setShowNewPlan(false)}>
          <div className="w-full max-w-sm rounded-3xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-6 shadow-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Create Workout Plan</h3>
              <button onClick={() => setShowNewPlan(false)} className="rounded-xl p-1.5 text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]">
                <X size={16} />
              </button>
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Give your plan a name and pick how many days per week.</p>
            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-faint)]">Plan Name</label>
                <input
                  value={newPlanName}
                  onChange={e => setNewPlanName(e.target.value)}
                  placeholder="e.g. Push Pull Legs, Upper Lower, Full Body"
                  className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                  onKeyDown={e => { if (e.key === 'Enter' && newPlanName.trim()) handleCreatePlan(); }}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium text-[var(--text-faint)]">Days per week</label>
                <div className="flex gap-2">
                  {[3, 4, 5, 6, 7].map(n => (
                    <button
                      key={n}
                      onClick={() => setNewPlanDays(n)}
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold transition',
                        newPlanDays === n
                          ? 'bg-[var(--accent)] text-[var(--accent-contrast)] shadow-md'
                          : 'border border-[var(--border-soft)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleCreatePlan} disabled={!newPlanName.trim()} className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)' }}>Create Plan</button>
                <button onClick={() => setShowNewPlan(false)} className="rounded-xl border border-[var(--border-soft)] px-4 py-2.5 text-sm text-[var(--text-muted)] transition hover:border-[var(--border-strong)]">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showImportPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setShowImportPlan(false)}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border-soft)] px-4 py-4 sm:px-5">
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Import Workout Plan</h3>
                <p className="mt-1 text-sm text-[var(--text-muted)]">Paste a structured workout plan and TaskFlow will build the plan, days, and exercises for you.</p>
              </div>
              <button onClick={() => setShowImportPlan(false)} className="text-[var(--text-faint)] hover:text-[var(--text-primary)]">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto p-4 sm:p-5">
              <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 text-xs text-[var(--text-muted)]">
                Expected format: plan title, optional GOAL block, WEEKLY SPLIT, then sections like `DAY 1 — Shoulders`, with bullet exercises such as `- Barbell bench press — 4x6–10`.
              </div>

              <textarea
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder="Paste your workout plan here..."
                rows={18}
                className="w-full resize-none rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
              />

              {importError && (
                <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  {importError}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--border-soft)] px-4 py-4 sm:flex-row sm:px-5">
              <button
                type="button"
                onClick={() => setShowImportPlan(false)}
                className="flex-1 rounded-lg border border-[var(--border-soft)] py-2.5 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportPlan}
                disabled={!importText.trim() || isImporting}
                className="flex-1 rounded-lg py-2.5 text-sm font-medium text-[var(--accent-contrast)] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: 'var(--accent-strong)' }}
              >
                {isImporting ? 'Importing...' : 'Import Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDeletePlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setPendingDeletePlan(null)}>
          <div
            className="w-full max-w-md rounded-lg border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-5 shadow-sm"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Delete workout plan?</h3>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  This will permanently remove <span className="font-medium text-[var(--text-primary)]">{pendingDeletePlan.name}</span> and its days.
                </p>
              </div>
              <button
                onClick={() => setPendingDeletePlan(null)}
                className="text-[var(--text-faint)] transition hover:text-[var(--text-primary)]"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setPendingDeletePlan(null)}
                className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  props.onDeletePlan(pendingDeletePlan.id);
                  setPendingDeletePlan(null);
                }}
                className="rounded-xl border border-rose-500/30 bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-600 hover:border-rose-500"
              >
                Delete Plan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== WIZARD: Add Days Modal ===== */}
      {wizardStep === 'days' && selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setWizardStep(null)}>
          <div className="w-full max-w-md rounded-3xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-6 shadow-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Add Workout Days</h3>
              <button onClick={() => setWizardStep(null)} className="rounded-xl p-1.5 text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]">
                <X size={16} />
              </button>
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Add each day of your <span className="font-medium text-[var(--text-primary)]">{selectedPlan.name}</span> routine.
            </p>

            {/* Already added days */}
            {selectedPlanDays.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {selectedPlanDays.map((day, i) => (
                  <div key={day.id} className="flex items-center gap-2 rounded-xl bg-[var(--surface-muted)] px-3 py-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--accent)]">{i + 1}</span>
                    <span className="text-sm font-medium text-[var(--text-primary)]">{day.name}</span>
                    <Check size={14} className="ml-auto text-emerald-400" />
                  </div>
                ))}
              </div>
            )}

            {/* Add new day input */}
            <div className="mt-4 flex gap-2">
              <input
                value={newDayName}
                onChange={e => setNewDayName(e.target.value)}
                placeholder={selectedPlanDays.length === 0 ? 'e.g. Push, Upper Body, Chest + Triceps' : 'Next day name...'}
                className="flex-1 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                onKeyDown={e => { if (e.key === 'Enter' && newDayName.trim()) handleAddDay(); }}
                autoFocus
              />
              <button
                onClick={handleAddDay}
                disabled={!newDayName.trim()}
                className="rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-40"
                style={{ backgroundColor: 'var(--accent-strong)' }}
              >
                Add
              </button>
            </div>

            {/* Footer actions */}
            <div className="mt-5 flex gap-2">
              {selectedPlanDays.length > 0 && (
                <button
                  onClick={() => {
                    setWizardStep('exercises');
                    setWizardDayIndex(0);
                    resetWizardExerciseForm();
                    setWizSets(3);
                    setWizReps('10');
                    setWizRest(45);
                  }}
                  className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)]"
                  style={{ backgroundColor: 'var(--accent-strong)' }}
                >
                  Next: Add Exercises →
                </button>
              )}
              <button
                onClick={() => setWizardStep(null)}
                className="rounded-xl border border-[var(--border-soft)] px-4 py-2.5 text-sm text-[var(--text-muted)] transition hover:border-[var(--border-strong)]"
              >
                {selectedPlanDays.length > 0 ? 'Done' : 'Skip'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== WIZARD: Add Exercises Modal ===== */}
      {wizardStep === 'exercises' && wizardCurrentDay && selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setWizardStep(null)}>
          <div className="w-full max-w-lg rounded-3xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-6 shadow-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]">Day {wizardDayIndex + 1} of {selectedPlanDays.length}</div>
                <h3 className="mt-0.5 text-lg font-semibold text-[var(--text-primary)]">{wizardCurrentDay.name}</h3>
              </div>
              <button onClick={() => setWizardStep(null)} className="rounded-xl p-1.5 text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]">
                <X size={16} />
              </button>
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Add exercises for this day. You can always edit later.</p>

            {/* Already added exercises for this day */}
            {wizardCurrentDayExercises.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {wizardCurrentDayExercises.map((de, i) => {
                  const ex = exercises.find(e => e.id === de.exerciseId);
                  return (
                    <div key={de.id} className="flex items-center gap-2 rounded-xl bg-[var(--surface-muted)] px-3 py-2">
                      <span className="text-xs font-medium text-[var(--text-faint)]">{i + 1}.</span>
                      <span className="text-sm font-medium text-[var(--text-primary)]">{ex?.name ?? 'Unknown'}</span>
                      <span className="ml-auto text-xs text-[var(--text-faint)]">{de.targetSets} × {de.targetReps} · {de.restSeconds}s</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 space-y-3 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3">
              <div className="space-y-3 rounded-lg border border-[var(--accent)]/20 bg-[var(--accent-soft)]/30 p-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-faint)]">Exercise name</label>
                  <input
                    value={wizExName}
                    onChange={e => {
                      setWizExName(e.target.value);
                      if (e.target.value.trim()) setWizExId('');
                    }}
                    placeholder="Exercise name (e.g. Bench Press)"
                    className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                    onKeyDown={e => { if (e.key === 'Enter' && wizExName.trim()) void handleWizardAddExercise(); }}
                    autoFocus
                  />
                </div>

                <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">
                  <span className="h-px flex-1 bg-[var(--border-soft)]" />
                  <span>or</span>
                  <span className="h-px flex-1 bg-[var(--border-soft)]" />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-faint)]">Choose from exercise library</label>
                  <select
                    value={wizExId}
                    onChange={e => {
                      setWizExId(e.target.value);
                      if (e.target.value) setWizExName('');
                    }}
                    className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                  >
                    <option value="">Select an exercise...</option>
                    {exercises.map(ex => (
                      <option key={ex.id} value={ex.id}>{ex.name}{ex.muscleGroup ? ` (${ex.muscleGroup})` : ''}</option>
                    ))}
                  </select>
                </div>

                <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)]">
                      {wizExImagePreview ? (
                        <img src={wizExImagePreview} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Camera size={16} className="text-[var(--text-faint)]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--text-primary)]">Photo</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]">
                          <Camera size={14} />
                          Choose image
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={e => handleWizardImageFile(e.target.files?.[0])}
                          />
                        </label>
                        {wizExImagePreview && (
                          <button
                            type="button"
                            onClick={clearWizardImageFile}
                            className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs font-medium text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
                <label className="flex items-center gap-1.5">Sets: <input type="number" value={wizSets} onChange={e => setWizSets(Number(e.target.value))} min={1} max={20} className="w-12 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-1.5 py-1.5 text-center text-sm text-[var(--text-primary)] focus:outline-none" /></label>
                <label className="flex items-center gap-1.5">Reps: <input value={wizReps} onChange={e => setWizReps(e.target.value)} className="w-20 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-1.5 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none" placeholder="e.g. 12,10,8" /></label>
                <label className="flex items-center gap-1.5">Rest: <input type="number" value={wizRest} onChange={e => setWizRest(Number(e.target.value))} min={0} step={15} className="w-14 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-1.5 py-1.5 text-center text-sm text-[var(--text-primary)] focus:outline-none" /><span>s</span></label>
              </div>

              <button
                onClick={() => void handleWizardAddExercise()}
                disabled={!wizExName.trim() && !wizExId}
                className="w-full rounded-lg px-3 py-2 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-40"
                style={{ backgroundColor: 'var(--accent-strong)' }}
              >
                Add to Day
              </button>
            </div>

            {/* Footer navigation */}
            <div className="mt-5 flex items-center justify-between">
              <button
                onClick={() => {
                  if (wizardDayIndex > 0) setWizardDayIndex(wizardDayIndex - 1);
                  else { setWizardStep('days'); }
                }}
                className="rounded-xl border border-[var(--border-soft)] px-4 py-2 text-sm text-[var(--text-muted)] transition hover:border-[var(--border-strong)]"
              >
                ← {wizardDayIndex > 0 ? 'Previous Day' : 'Back to Days'}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setWizardStep(null)}
                  className="rounded-xl border border-[var(--border-soft)] px-4 py-2 text-sm text-[var(--text-muted)] transition hover:border-[var(--border-strong)]"
                >
                  Done
                </button>
                {wizardDayIndex < selectedPlanDays.length - 1 && (
                  <button
                    onClick={() => setWizardDayIndex(wizardDayIndex + 1)}
                    className="rounded-xl px-4 py-2 text-sm font-medium text-[var(--accent-contrast)]"
                    style={{ backgroundColor: 'var(--accent-strong)' }}
                  >
                    Next Day →
                  </button>
                )}
                {wizardDayIndex === selectedPlanDays.length - 1 && (
                  <button
                    onClick={() => setWizardStep(null)}
                    className="rounded-xl px-4 py-2 text-sm font-medium text-[var(--accent-contrast)]"
                    style={{ backgroundColor: 'var(--accent-strong)' }}
                  >
                    Finish ✓
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {editingExercise && (
        <ExerciseEditorModal
          exercise={editingExercise}
          onClose={() => setEditingExercise(null)}
          onSave={props.onUpdateExercise}
          onUploadImage={props.onUploadExerciseImage}
        />
      )}

      {pendingDeleteDay && (
        <ConfirmModal
          title="Delete workout day?"
          message={<>This will permanently remove <span className="font-medium text-[var(--text-primary)]">{pendingDeleteDay.name}</span> and its exercises.</>}
          confirmLabel="Delete Day"
          confirmTone="danger"
          onCancel={() => setPendingDeleteDay(null)}
          onConfirm={() => {
            props.onDeleteDayTemplate(pendingDeleteDay.id);
            setPendingDeleteDay(null);
          }}
        />
      )}
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 text-center shadow-sm">
      <div className="text-[9px] uppercase tracking-[0.16em] text-[var(--text-faint)]">{label}</div>
      <div className="mt-1 text-base font-bold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function ExerciseLibraryTab(props: GymPageProps) {
  const { exercises } = props;
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);

  const muscleGroups = new Set(exercises.map(ex => ex.muscleGroup).filter(Boolean));
  const exercisesWithImages = exercises.filter(ex => ex.referenceImageUrl).length;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]">Exercise Library</div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-[var(--text-primary)]">Store every movement in one place</h2>
            <p className="mt-2 max-w-2xl text-sm text-[var(--text-muted)]">
              Save exercises with optional images so they stay easy to recognize when you build plans or start a workout. You can edit names, notes, and photos anytime.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-[260px] sm:grid-cols-3">
            <StatPill label="Exercises" value={exercises.length.toString()} />
            <StatPill label="With images" value={exercisesWithImages.toString()} />
            <StatPill label="Groups" value={muscleGroups.size.toString()} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-sm">
          <ExerciseLibrary
            exercises={exercises}
            onAdd={props.onAddExercise}
            onEdit={setEditingExercise}
            onDelete={props.onDeleteExercise}
            onUploadImage={props.onUploadExerciseImage}
          />
        </div>

        <div className="space-y-4">
          <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]">How images work</div>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Add a photo from your device or camera when you create an exercise. That image shows up in your workout flow and in history, so you can identify the movement fast.
            </p>
          </div>
          <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]">Workout reminder</div>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Exercises with images will display them inside the active workout card too, so the reference stays visible when you are actually training.
            </p>
          </div>
        </div>
      </div>

      {editingExercise && (
        <ExerciseEditorModal
          exercise={editingExercise}
          onClose={() => setEditingExercise(null)}
          onSave={props.onUpdateExercise}
          onUploadImage={props.onUploadExerciseImage}
        />
      )}
    </div>
  );
}

// --- Workout Day Card ---
function WorkoutDayCard({
  day, dayNumber, isExpanded, onToggle, exercises, dayExercises,
  onUpdateDay, onRequestDeleteDay, onUpdateDayExercise, onDeleteDayExercise, onOpenExerciseWizard,
  dragHandleProps, isDragging,
}: {
  day: WorkoutDayTemplate;
  dayNumber: number;
  isExpanded: boolean;
  onToggle: () => void;
  exercises: Exercise[];
  dayExercises: WorkoutDayExercise[];
  onUpdateDay: GymPageProps['onUpdateDayTemplate'];
  onRequestDeleteDay: () => void;
  onUpdateDayExercise: GymPageProps['onUpdateDayExercise'];
  onDeleteDayExercise: GymPageProps['onDeleteDayExercise'];
  onOpenExerciseWizard: () => void;
  dragHandleProps?: DraggableProvidedDragHandleProps | null;
  isDragging?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(day.name);

  const handleRename = async () => {
    if (editName.trim() && editName.trim() !== day.name) {
      await onUpdateDay(day.id, { name: editName.trim() });
    }
    setIsEditing(false);
  };

  return (
    <div className={cn(
      'rounded-xl border bg-[var(--surface-elevated)] overflow-hidden transition-shadow',
      isDragging ? 'border-[var(--accent)] shadow-sm' : 'border-[var(--border-soft)]'
    )}>
      <div className="flex items-center">
        {/* Drag handle */}
        <div
          {...dragHandleProps}
          className="flex items-center justify-center pl-2 pr-1 py-3 cursor-grab active:cursor-grabbing text-[var(--text-faint)] hover:text-[var(--text-muted)] transition"
        >
          <GripVertical size={16} />
        </div>
        <button onClick={onToggle} className="flex flex-1 items-center gap-3 pr-4 py-3 text-left">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent)]">
            {dayNumber}
          </div>
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setIsEditing(false); }}
                className="w-full bg-transparent text-sm font-semibold text-[var(--text-primary)] focus:outline-none"
                onClick={e => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span className="text-sm font-semibold text-[var(--text-primary)]">{day.name}</span>
            )}
            <p className="text-xs text-[var(--text-faint)]">{dayExercises.length} exercises</p>
            {!isExpanded && dayExercises.length > 0 && (
              <p className="text-[11px] text-[var(--text-faint)] truncate mt-0.5">
                {dayExercises.map(de => exercises.find(e => e.id === de.exerciseId)?.name).filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <button onClick={() => { setEditName(day.name); setIsEditing(true); }} className="p-1.5 text-[var(--text-faint)] hover:text-[var(--text-primary)] transition"><Edit3 size={14} /></button>
            <button onClick={onRequestDeleteDay} className="p-1.5 text-[var(--text-faint)] hover:text-red-400 transition"><Trash2 size={14} /></button>
          </div>
          {isExpanded ? <ChevronDown size={16} className="text-[var(--text-faint)]" /> : <ChevronRight size={16} className="text-[var(--text-faint)]" />}
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-[var(--border-soft)] px-4 py-3 space-y-2">
          {dayExercises.map((de, idx) => {
            const ex = exercises.find(e => e.id === de.exerciseId);
            return (
              <DayExerciseRow
                key={de.id}
                dayExercise={de}
                exercise={ex}
                index={idx}
                onUpdate={onUpdateDayExercise}
                onDelete={onDeleteDayExercise}
              />
            );
          })}

          {dayExercises.length === 0 && (
            <p className="py-2 text-center text-xs text-[var(--text-faint)]">No exercises yet</p>
          )}

          <button
            onClick={onOpenExerciseWizard}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border-soft)] py-2.5 text-xs font-medium text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <Plus size={14} />
            Add Exercise
          </button>
        </div>
      )}
    </div>
  );
}

// --- Day Exercise Row ---
function DayExerciseRow({
  dayExercise, exercise, index, onUpdate, onDelete,
}: {
  dayExercise: WorkoutDayExercise;
  exercise: Exercise | undefined;
  index: number;
  onUpdate: GymPageProps['onUpdateDayExercise'];
  onDelete: GymPageProps['onDeleteDayExercise'];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [sets, setSets] = useState(dayExercise.targetSets);
  const [reps, setReps] = useState(dayExercise.targetReps);
  const [rest, setRest] = useState(dayExercise.restSeconds);

  const handleSave = async () => {
    await onUpdate(dayExercise.id, { targetSets: sets, targetReps: reps, restSeconds: rest });
    setIsEditing(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-[var(--surface-muted)] group sm:flex-nowrap">
      <span className="w-5 text-center text-xs font-medium text-[var(--text-faint)]">{index + 1}</span>
      {exercise?.referenceImageUrl ? (
        <img src={exercise.referenceImageUrl} alt="" className="h-8 w-8 rounded object-cover" />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded bg-[var(--surface-muted)] text-[var(--text-faint)]">
          <Dumbbell size={14} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{exercise?.name ?? 'Unknown'}</p>
        {exercise?.muscleGroup && <p className="text-[10px] text-[var(--text-faint)]">{exercise.muscleGroup}</p>}
      </div>

      {isEditing ? (
        <div className="flex items-center gap-2 text-xs">
          <input type="number" value={sets} onChange={e => setSets(Number(e.target.value))} className="w-10 rounded border border-[var(--border-soft)] bg-[var(--surface-muted)] px-1 py-0.5 text-center text-[var(--text-primary)] focus:outline-none" />
          <span className="text-[var(--text-faint)]">x</span>
          <input value={reps} onChange={e => setReps(e.target.value)} className="w-16 rounded border border-[var(--border-soft)] bg-[var(--surface-muted)] px-1 py-0.5 text-center text-[var(--text-primary)] focus:outline-none" />
          <input type="number" value={rest} onChange={e => setRest(Number(e.target.value))} step={15} className="w-12 rounded border border-[var(--border-soft)] bg-[var(--surface-muted)] px-1 py-0.5 text-center text-[var(--text-primary)] focus:outline-none" />
          <span className="text-[var(--text-faint)]">s</span>
          <button onClick={handleSave} className="text-emerald-400"><Check size={14} /></button>
          <button onClick={() => setIsEditing(false)} className="text-[var(--text-faint)]"><X size={14} /></button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">{dayExercise.targetSets} x {dayExercise.targetReps}</span>
          <span className="text-[10px] text-[var(--text-faint)]">{dayExercise.restSeconds}s rest</span>
          <button onClick={() => setIsEditing(true)} className="p-1 text-[var(--text-faint)] opacity-100 transition md:opacity-0 md:group-hover:opacity-100"><Edit3 size={12} /></button>
          <button onClick={() => onDelete(dayExercise.id)} className="p-1 text-[var(--text-faint)] opacity-100 transition hover:text-red-400 md:opacity-0 md:group-hover:opacity-100"><Trash2 size={12} /></button>
        </div>
      )}
    </div>
  );
}

// --- Exercise Library ---
function ExerciseLibrary({
  exercises, onAdd, onEdit, onDelete, onUploadImage,
}: {
  exercises: Exercise[];
  onAdd: GymPageProps['onAddExercise'];
  onEdit: (exercise: Exercise) => void;
  onDelete: GymPageProps['onDeleteExercise'];
  onUploadImage: GymPageProps['onUploadExerciseImage'];
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [muscle, setMuscle] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const handleAdd = async () => {
    if (!name.trim()) return;
    const exId = await onAdd(name.trim(), muscle.trim(), '', undefined);
    if (exId && imageFile) {
      await onUploadImage(exId, imageFile);
    }
    setName('');
    setMuscle('');
    setImageFile(null);
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
    }
    setShowAdd(false);
  };

  const handlePickImage = (file: File | null | undefined) => {
    if (!file) return;
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    const preview = URL.createObjectURL(file);
    setImageFile(file);
    setImagePreview(preview);
  };

  const clearPickedImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
  };

  const muscleGroups = [...new Set(exercises.map(e => e.muscleGroup).filter(Boolean))];

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-4">
      {exercises.length === 0 && <p className="text-xs text-[var(--text-faint)] text-center py-2">No exercises in your library</p>}

      {muscleGroups.length > 0 && muscleGroups.map(group => (
        <div key={group}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1">{group}</p>
          {exercises.filter(e => e.muscleGroup === group).map(ex => (
            <ExerciseLibraryItem
              key={ex.id}
              exercise={ex}
              onEdit={onEdit}
              onDelete={onDelete}
              onUploadImage={onUploadImage}
            />
          ))}
        </div>
      ))}

      {/* Ungrouped */}
      {exercises.filter(e => !e.muscleGroup).length > 0 && (
        <div>
          {muscleGroups.length > 0 && <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1">Other</p>}
          {exercises.filter(e => !e.muscleGroup).map(ex => (
            <ExerciseLibraryItem
              key={ex.id}
              exercise={ex}
              onEdit={onEdit}
              onDelete={onDelete}
              onUploadImage={onUploadImage}
            />
          ))}
        </div>
      )}

      {showAdd ? (
        <div className="space-y-3 border-t border-[var(--border-soft)] pt-3">
          <div className="space-y-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Exercise name" className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none" autoFocus onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} />
            <input value={muscle} onChange={e => setMuscle(e.target.value)} placeholder="Muscle group" className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none" />
          </div>

          <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface)]">
                {imagePreview ? <img src={imagePreview} alt="" className="h-full w-full object-cover" /> : <Camera size={16} className="text-[var(--text-faint)]" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">Exercise photo</p>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">Choose a photo from your device or take one with your camera.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]">
                    <Camera size={14} />
                    {imagePreview ? 'Change image' : 'Choose image'}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={e => handlePickImage(e.target.files?.[0])}
                    />
                  </label>
                  {imagePreview && (
                    <button type="button" onClick={clearPickedImage} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs font-medium text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={!name.trim()} className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--accent-contrast)] disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)' }}>Add</button>
            <button onClick={() => setShowAdd(false)} className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs text-[var(--text-muted)]">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border-soft)] py-2 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition">
          <Plus size={14} />
          Add Exercise
        </button>
      )}
    </div>
  );
}

function ExerciseLibraryItem({
  exercise, onEdit, onDelete, onUploadImage,
}: {
  exercise: Exercise;
  onEdit: (exercise: Exercise) => void;
  onDelete: GymPageProps['onDeleteExercise'];
  onUploadImage: GymPageProps['onUploadExerciseImage'];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handlePick = async (file?: File | null) => {
    if (!file) return;
    setIsUploading(true);
    await onUploadImage(exercise.id, file);
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-[var(--surface-muted)]">
      {exercise.referenceImageUrl ? (
        <img src={exercise.referenceImageUrl} alt="" className="h-7 w-7 rounded object-cover" />
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded bg-[var(--surface-muted)] text-[var(--text-faint)]">
          <Dumbbell size={12} />
        </div>
      )}
      <span className="flex-1 text-sm text-[var(--text-primary)]">{exercise.name}</span>
      <button
        type="button"
        onClick={() => onEdit(exercise)}
        className="rounded-md border border-[var(--border-soft)] px-2 py-1 text-[10px] font-medium text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        Edit
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => void handlePick(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="rounded-md border border-[var(--border-soft)] px-2 py-1 text-[10px] font-medium text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        {isUploading ? 'Uploading…' : exercise.referenceImageUrl ? 'Change image' : 'Add image'}
      </button>
      <button onClick={() => onDelete(exercise.id)} className="p-1 text-[var(--text-faint)] opacity-100 transition hover:text-red-400 md:opacity-0 md:group-hover:opacity-100">
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function ExerciseEditorModal({
  exercise,
  onClose,
  onSave,
  onUploadImage,
}: {
  exercise: Exercise;
  onClose: () => void;
  onSave: GymPageProps['onUpdateExercise'];
  onUploadImage: GymPageProps['onUploadExerciseImage'];
}) {
  const [name, setName] = useState(exercise.name);
  const [muscleGroup, setMuscleGroup] = useState(exercise.muscleGroup);
  const [notes, setNotes] = useState(exercise.notes);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(exercise.referenceImageUrl);
  const [imageCleared, setImageCleared] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const imageObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setName(exercise.name);
    setMuscleGroup(exercise.muscleGroup);
    setNotes(exercise.notes);
    setImageFile(null);
    setImageCleared(false);
    if (imageObjectUrlRef.current) {
      URL.revokeObjectURL(imageObjectUrlRef.current);
      imageObjectUrlRef.current = null;
    }
    setImagePreview(exercise.referenceImageUrl);
  }, [exercise]);

  useEffect(() => {
    return () => {
      if (imageObjectUrlRef.current) {
        URL.revokeObjectURL(imageObjectUrlRef.current);
      }
    };
  }, []);

  const handlePickImage = (file?: File | null) => {
    if (!file) return;
    if (imageObjectUrlRef.current) {
      URL.revokeObjectURL(imageObjectUrlRef.current);
    }
    const preview = URL.createObjectURL(file);
    imageObjectUrlRef.current = preview;
    setImageFile(file);
    setImagePreview(preview);
    setImageCleared(false);
  };

  const handleRemoveImage = () => {
    if (imageObjectUrlRef.current) {
      URL.revokeObjectURL(imageObjectUrlRef.current);
      imageObjectUrlRef.current = null;
    }
    setImageFile(null);
    setImagePreview(null);
    setImageCleared(true);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      await onSave(exercise.id, {
        name: name.trim(),
        muscleGroup: muscleGroup.trim(),
        notes: notes.trim(),
      });

      if (imageFile) {
        await onUploadImage(exercise.id, imageFile);
      } else if (imageCleared && exercise.referenceImageUrl) {
        await onSave(exercise.id, { referenceImageUrl: null });
      }

      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-6 shadow-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Edit exercise</h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Rename it, update the notes, or swap the image.</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-1.5 text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Exercise name"
              className="flex-1 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
              autoFocus
            />
            <input
              value={muscleGroup}
              onChange={e => setMuscleGroup(e.target.value)}
              placeholder="Muscle group"
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none sm:w-48"
            />
          </div>

          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notes"
            rows={3}
            className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />

          <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3">
            <div className="flex items-start gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface)]">
                {imagePreview ? (
                  <img src={imagePreview} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Camera size={18} className="text-[var(--text-faint)]" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">Exercise photo</p>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">Choose a photo from your device or take one with your camera.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]">
                    <Camera size={14} />
                    {imagePreview ? 'Change image' : 'Choose image'}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={e => handlePickImage(e.target.files?.[0])}
                    />
                  </label>
                  {imagePreview && (
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs font-medium text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border-soft)] px-4 py-2 text-sm text-[var(--text-muted)] transition hover:border-[var(--border-strong)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!name.trim() || isSaving}
            className="rounded-xl px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-40"
            style={{ backgroundColor: 'var(--accent-strong)' }}
          >
            {isSaving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  confirmTone = 'danger',
  onCancel,
  onConfirm,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  confirmTone?: 'danger' | 'primary';
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-3xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-6 shadow-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{message}</p>
          </div>
          <button onClick={onCancel} className="rounded-xl p-1.5 text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'rounded-xl px-4 py-2 text-sm font-medium transition',
              confirmTone === 'danger'
                ? 'border border-rose-500/30 bg-rose-500 text-white hover:bg-rose-600'
                : 'text-[var(--accent-contrast)]'
            )}
            style={confirmTone === 'primary' ? { backgroundColor: 'var(--accent-strong)' } : undefined}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// WORKOUT TAB (Active Session)
// ============================================================

function WorkoutTab(props: GymPageProps) {
  const {
    activeSession, activePlan, dayTemplates, exercises, dayExercises,
    exerciseLogs, setLogs, sessions,
  } = props;

  const [currentExIdx, setCurrentExIdx] = useState(0);
  const [pendingAbandonWorkout, setPendingAbandonWorkout] = useState(false);

  if (!activePlan) {
    return (
      <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-8 text-center shadow-sm">
        <Dumbbell size={40} className="mx-auto mb-3 text-[var(--text-faint)]" />
        <p className="text-sm text-[var(--text-muted)]">Create a workout plan first to start a session.</p>
      </div>
    );
  }

  const planDays = dayTemplates.filter(d => d.planId === activePlan.id).sort((a, b) => a.position - b.position);

  if (!activeSession) {
    return <StartWorkoutPicker planDays={planDays} activePlan={activePlan} sessions={sessions} onStart={props.onStartSession} />;
  }

  // Active session
  const sessionLogs = exerciseLogs
    .filter(el => el.workoutSessionId === activeSession.id)
    .sort((a, b) => a.position - b.position);

  const dayName = dayTemplates.find(d => d.id === activeSession.workoutDayTemplateId)?.name ?? 'Workout';
  const currentLog = sessionLogs[currentExIdx];
  const currentExercise = currentLog ? exercises.find(e => e.id === currentLog.exerciseId) : null;
  const currentDayExercise = currentLog?.workoutDayExerciseId
    ? dayExercises.find(de => de.id === currentLog.workoutDayExerciseId) ?? null : null;
  const currentSets = currentLog ? setLogs.filter(sl => sl.workoutExerciseLogId === currentLog.id).sort((a, b) => a.setNumber - b.setNumber) : [];
  const lastPerformance = currentLog ? props.getLastPerformance(currentLog.exerciseId, activeSession.id) : [];

  const totalExercises = sessionLogs.length;
  const completedExercises = sessionLogs.filter(el => {
    const sets = setLogs.filter(sl => sl.workoutExerciseLogId === el.id);
    return sets.length > 0 && sets.every(s => s.completed);
  }).length;

  const handleFinish = () => {
    props.onCompleteSession(activeSession.id, 'completed');
  };

  const handleAbandon = () => {
    setPendingAbandonWorkout(true);
  };

  return (
    <div className="space-y-4">
      {/* Session header */}
      <div className="overflow-hidden rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{dayName}</h2>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Started {new Date(activeSession.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {completedExercises}/{totalExercises} exercises done
            </p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <button onClick={handleAbandon} className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-red-400 transition">
              <Square size={14} />
            </button>
            <button onClick={handleFinish} className="flex-1 rounded-lg px-4 py-1.5 text-xs font-medium text-[var(--accent-contrast)] sm:flex-none" style={{ backgroundColor: 'var(--accent-strong)' }}>
              Finish Workout
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 rounded-full bg-[var(--surface-muted)]">
          <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${totalExercises > 0 ? (completedExercises / totalExercises * 100) : 0}%` }} />
        </div>
      </div>

      {/* Exercise navigator */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {sessionLogs.map((el, idx) => {
          const ex = exercises.find(e => e.id === el.exerciseId);
          const sets = setLogs.filter(sl => sl.workoutExerciseLogId === el.id);
          const allDone = sets.length > 0 && sets.every(s => s.completed);
          return (
            <button
              key={el.id}
              onClick={() => setCurrentExIdx(idx)}
              className={cn(
                'shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition',
                idx === currentExIdx
                  ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                  : allDone
                    ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20'
                    : 'border border-[var(--border-soft)] text-[var(--text-muted)] hover:bg-[var(--surface-muted)]'
              )}
            >
              {ex?.name ?? `Exercise ${idx + 1}`}
              {allDone && <Check size={12} className="ml-1 inline" />}
            </button>
          );
        })}
      </div>

      {/* Current exercise */}
      {currentLog && currentExercise && (
        <ActiveExerciseCard
          exercise={currentExercise}
          exerciseLog={currentLog}
          dayExercise={currentDayExercise}
          sets={currentSets}
          lastPerformance={lastPerformance}
          onUpdateSet={props.onUpdateSetLog}
          onUploadPhoto={props.onUploadExercisePhoto}
          onNext={() => setCurrentExIdx(Math.min(currentExIdx + 1, sessionLogs.length - 1))}
          isLast={currentExIdx === sessionLogs.length - 1}
        />
      )}

      {pendingAbandonWorkout && (
        <ConfirmModal
          title="Abandon workout?"
          message="Progress will still be saved, but the session will be marked as abandoned."
          confirmLabel="Abandon"
          confirmTone="danger"
          onCancel={() => setPendingAbandonWorkout(false)}
          onConfirm={() => {
            props.onCompleteSession(activeSession.id, 'abandoned');
            setPendingAbandonWorkout(false);
          }}
        />
      )}
    </div>
  );
}

// --- Start Workout Picker ---
function StartWorkoutPicker({
  planDays, activePlan, sessions, onStart,
}: {
  planDays: WorkoutDayTemplate[];
  activePlan: WorkoutPlan;
  sessions: WorkoutSession[];
  onStart: GymPageProps['onStartSession'];
}) {
  // Suggest next day based on last completed session
  const lastCompleted = sessions.find(s => s.status === 'completed');
  const lastDayIdx = lastCompleted ? planDays.findIndex(d => d.id === lastCompleted.workoutDayTemplateId) : -1;
  const suggestedIdx = lastDayIdx >= 0 ? (lastDayIdx + 1) % planDays.length : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-6 text-center shadow-sm">
        <Play size={32} className="mx-auto mb-3 text-[var(--accent)]" />
        <h3 className="text-lg font-bold text-[var(--text-primary)]">Start a Workout</h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Choose a day and the app will guide you through the whole session.</p>
      </div>

      <div className="space-y-2">
        {planDays.map((day, idx) => {
          const lastSession = sessions.find(s => s.workoutDayTemplateId === day.id && s.status === 'completed');
          const isSuggested = idx === suggestedIdx;
          return (
            <button
              key={day.id}
              onClick={() => onStart(activePlan.id, day.id)}
              className={cn(
                'flex w-full items-center gap-4 rounded-xl border p-4 text-left transition',
                isSuggested
                  ? 'border-[var(--accent)] bg-[var(--surface)] shadow-lg'
                  : 'border-[var(--border-soft)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:shadow-md'
              )}
            >
              <div className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold',
                isSuggested ? 'bg-[var(--accent)] text-[var(--accent-contrast)]' : 'bg-[var(--surface-muted)] text-[var(--text-muted)]'
              )}>
                {idx + 1}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {day.name}
                  {isSuggested && <span className="ml-2 text-xs font-normal text-[var(--accent)]">Suggested</span>}
                </p>
                {lastSession && (
                  <p className="text-xs text-[var(--text-faint)]">
                    Last: {new Date(lastSession.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                )}
              </div>
              <Play size={16} className="text-[var(--text-faint)]" />
            </button>
          );
        })}
      </div>

      {planDays.length === 0 && (
        <p className="text-center text-sm text-[var(--text-muted)]">Add workout days to your plan first.</p>
      )}
    </div>
  );
}

// --- Active Exercise Card (guided flow) ---
// Flow per set: idle → tap "Go" → in-progress → tap "Done" → enter reps → saved
// Weight is set once at the top and applies to all sets.

type SetState = 'idle' | 'active' | 'logging' | 'done';

function ActiveExerciseCard({
  exercise, exerciseLog, dayExercise, sets, lastPerformance, onUpdateSet, onUploadPhoto, onNext, isLast,
}: {
  exercise: Exercise;
  exerciseLog: WorkoutExerciseLog;
  dayExercise: WorkoutDayExercise | null;
  sets: WorkoutSetLog[];
  lastPerformance: WorkoutSetLog[];
  onUpdateSet: GymPageProps['onUpdateSetLog'];
  onUploadPhoto: GymPageProps['onUploadExercisePhoto'];
  onNext: () => void;
  isLast: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(exerciseLog.photoUrl);
  const [isUploading, setIsUploading] = useState(false);

  // Sync preview with exerciseLog changes (switching exercises)
  useEffect(() => {
    setPhotoPreview(exerciseLog.photoUrl);
  }, [exerciseLog.id, exerciseLog.photoUrl]);

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Show instant preview
    const previewUrl = URL.createObjectURL(file);
    setPhotoPreview(previewUrl);
    setIsUploading(true);
    await onUploadPhoto(exerciseLog.id, file);
    setIsUploading(false);
    URL.revokeObjectURL(previewUrl);
  };
  // Weight shared across all sets — pre-fill from last performance
  const lastWeight = lastPerformance.find(s => s.completed)?.weight;
  const firstSavedWeight = sets.find(s => s.weight !== null)?.weight;
  const [weight, setWeight] = useState<string>(firstSavedWeight?.toString() ?? lastWeight?.toString() ?? '');

  // Per-set UI state (not persisted — derived from DB on mount)
  const [setStates, setSetStates] = useState<Map<string, SetState>>(() => {
    const m = new Map<string, SetState>();
    sets.forEach(s => m.set(s.id, s.completed ? 'done' : 'idle'));
    return m;
  });

  // Reps input for the set currently being logged
  const [loggingReps, setLoggingReps] = useState('');

  // Rest timer
  const [restActive, setRestActive] = useState(false);
  const [restTime, setRestTime] = useState(0);
  const restInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const restTotal = dayExercise?.restSeconds ?? 90;

  useEffect(() => {
    if (!restActive) return;
    restInterval.current = setInterval(() => {
      setRestTime(prev => {
        if (prev <= 1) {
          setRestActive(false);
          try {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.value = 0.3;
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
          } catch { /* ignore */ }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (restInterval.current) clearInterval(restInterval.current); };
  }, [restActive]);

  const startRest = useCallback(() => {
    setRestTime(restTotal);
    setRestActive(true);
  }, [restTotal]);

  // Parse target reps (e.g. "15, 12, 10" or just "10")
  const targetRepsList = (dayExercise?.targetReps ?? '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  const getTargetReps = (setNumber: number): string => {
    if (targetRepsList.length === 0) return '';
    return targetRepsList[Math.min(setNumber - 1, targetRepsList.length - 1)];
  };

  // Handle "Go" — mark set as active
  const handleGo = (setId: string) => {
    // Stop rest timer if running
    setRestActive(false);
    setRestTime(0);
    setSetStates(prev => new Map(prev).set(setId, 'active'));
  };

  // Handle "Done" — transition to logging
  const handleDone = (set: WorkoutSetLog) => {
    const target = getTargetReps(set.setNumber);
    // Pre-fill with target reps or last performance reps
    const lastReps = lastPerformance.find(lp => lp.setNumber === set.setNumber)?.reps;
    setLoggingReps(target || lastReps?.toString() || '');
    setSetStates(prev => new Map(prev).set(set.id, 'logging'));
  };

  // Handle save reps after logging
  const handleSaveReps = async (set: WorkoutSetLog) => {
    const w = weight ? Number(weight) : null;
    const r = loggingReps ? Number(loggingReps) : null;
    await onUpdateSet(set.id, { weight: w, reps: r, completed: true });
    setSetStates(prev => new Map(prev).set(set.id, 'done'));
    setLoggingReps('');
    // Auto-start rest timer
    startRest();
  };

  const allDone = sets.length > 0 && sets.every(s => s.completed || setStates.get(s.id) === 'done');

  // Format last performance summary
  const lastCompletedSets = lastPerformance.filter(s => s.completed);
  const lastText = lastCompletedSets.length > 0
    ? `${lastCompletedSets[0]?.weight ?? '—'} lbs — ${lastCompletedSets.map(s => s.reps ?? '—').join(', ')} reps`
    : null;

  return (
    <div className="overflow-hidden rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm">
      {/* Exercise header */}
      <div className="flex items-start gap-3 border-b border-[var(--border-soft)] px-4 py-4 sm:items-center sm:gap-4 sm:px-5">
        {exercise.referenceImageUrl ? (
          <img src={exercise.referenceImageUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--surface-muted)]">
            <Dumbbell size={24} className="text-[var(--text-faint)]" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold text-[var(--text-primary)]">{exercise.name}</h3>
          <p className="text-xs text-[var(--text-muted)]">
            {exercise.muscleGroup && <span>{exercise.muscleGroup} · </span>}
            {dayExercise ? `${dayExercise.targetSets} sets × ${dayExercise.targetReps} reps` : `${sets.length} sets`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Camera button */}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoCapture} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full transition',
              photoPreview
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'bg-[var(--surface-muted)] text-[var(--text-faint)] hover:text-[var(--text-muted)]'
            )}
            title={photoPreview ? 'Replace photo' : 'Take a photo'}
          >
            {isUploading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" /> : <Camera size={16} />}
          </button>
          {allDone && <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/15"><Check size={18} className="text-emerald-400" /></div>}
        </div>
      </div>

      {/* Photo preview */}
      {photoPreview && (
        <div className="border-b border-[var(--border-soft)] px-4 py-3 sm:px-5">
          <img src={photoPreview} alt="Workout photo" className="h-32 w-auto rounded-lg object-cover" />
        </div>
      )}

      {/* Last performance */}
      {lastText && (
        <div className="flex items-center gap-2 border-b border-[var(--border-soft)] bg-[var(--surface-muted)] px-5 py-2.5">
          <RotateCcw size={12} className="text-[var(--text-faint)]" />
          <span className="text-xs text-[var(--text-muted)]">Last time: {lastText}</span>
        </div>
      )}

      {/* Weight input (once for whole exercise) */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-soft)] px-4 py-3 sm:px-5">
        <label className="text-xs font-medium text-[var(--text-muted)]">Weight</label>
        <input
          type="number"
          value={weight}
          onChange={e => setWeight(e.target.value)}
          placeholder={lastWeight?.toString() ?? '0'}
          className="w-24 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-center text-sm font-semibold text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
        />
        <span className="text-xs text-[var(--text-faint)]">lbs</span>
      </div>

      {/* Sets */}
      <div className="space-y-2 px-4 py-4 sm:px-5">
        {sets.map(set => {
          const state = setStates.get(set.id) ?? (set.completed ? 'done' : 'idle');
          const target = getTargetReps(set.setNumber);

          return (
            <div key={set.id} className={cn(
              'flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 transition sm:flex-nowrap',
              state === 'done' ? 'bg-emerald-400/5 border border-emerald-400/15' :
              state === 'active' ? 'bg-[var(--accent-soft)] border border-[var(--accent)]/30' :
              state === 'logging' ? 'bg-amber-400/5 border border-amber-400/20' :
              'border border-[var(--border-soft)] bg-[var(--surface-muted)]'
            )}>
              {/* Set number */}
              <div className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
                state === 'done' ? 'bg-emerald-400/15 text-emerald-400' :
                state === 'active' ? 'bg-[var(--accent)] text-[var(--accent-contrast)]' :
                'bg-[var(--surface-elevated)] text-[var(--text-faint)]'
              )}>
                {set.setNumber}
              </div>

              {/* Content area */}
              <div className="flex-1 min-w-0">
                {state === 'idle' && (
                  <p className="text-sm text-[var(--text-muted)]">
                    {target ? `Target: ${target} reps` : 'Ready'}
                  </p>
                )}
                {state === 'active' && (
                  <p className="text-sm font-medium text-[var(--accent)]">
                    Go! {target ? `Aim for ${target} reps` : ''}
                  </p>
                )}
                {state === 'logging' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-muted)]">Reps done:</span>
                    <input
                      type="number"
                      value={loggingReps}
                      onChange={e => setLoggingReps(e.target.value)}
                      className="w-16 rounded-lg border border-amber-400/30 bg-[var(--surface-elevated)] px-2 py-1 text-center text-sm font-semibold text-[var(--text-primary)] focus:outline-none"
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveReps(set); }}
                    />
                  </div>
                )}
                {state === 'done' && (
                  <p className="text-sm text-emerald-400">
                    {set.weight ?? weight ?? '—'} lbs × {set.reps ?? '—'} reps
                  </p>
                )}
              </div>

              {/* Action button */}
              {state === 'idle' && (
                <button
                  onClick={() => handleGo(set.id)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] transition sm:w-auto"
                  style={{ backgroundColor: 'var(--accent-strong)' }}
                >
                  <Play size={14} />
                  Go
                </button>
              )}
              {state === 'active' && (
                <button
                  onClick={() => handleDone(set)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-400 sm:w-auto"
                >
                  <Check size={14} />
                  Done
                </button>
              )}
              {state === 'logging' && (
                <button
                  onClick={() => handleSaveReps(set)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-amber-400 sm:w-auto"
                >
                  <Check size={14} />
                  Save
                </button>
              )}
              {state === 'done' && (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/15">
                  <Check size={16} className="text-emerald-400" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Rest timer */}
      {restActive && (
        <div className="border-t border-[var(--border-soft)] bg-[var(--accent-soft)] px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Timer size={18} className="text-[var(--accent)]" />
              <span className="text-2xl font-bold tabular-nums text-[var(--accent)]">
                {Math.floor(restTime / 60)}:{String(restTime % 60).padStart(2, '0')}
              </span>
              <span className="text-xs text-[var(--text-faint)]">rest</span>
            </div>
            <button
              onClick={() => { setRestActive(false); setRestTime(0); }}
              className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs text-[var(--text-muted)]"
            >
              Skip
            </button>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-[var(--surface-muted)]">
            <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${(restTime / restTotal) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Next exercise */}
      {!isLast && (
        <div className="flex border-t border-[var(--border-soft)] px-4 py-3 sm:justify-end sm:px-5">
          <button onClick={onNext} className="flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-[var(--accent-contrast)] sm:w-auto" style={{ backgroundColor: 'var(--accent-strong)' }}>
            Next Exercise
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// --- History Exercise Row (with photo upload) ---
function HistoryExerciseRow({
  log, exercise, completedSets, onUploadPhoto,
}: {
  log: WorkoutExerciseLog;
  exercise: Exercise | undefined;
  completedSets: WorkoutSetLog[];
  onUploadPhoto: GymPageProps['onUploadExercisePhoto'];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(log.photoUrl);
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setPhotoPreview(previewUrl);
    setIsUploading(true);
    await onUploadPhoto(log.id, file);
    setIsUploading(false);
    URL.revokeObjectURL(previewUrl);
  };

  return (
    <div className="flex items-start gap-3">
      {exercise?.referenceImageUrl ? (
        <img src={exercise.referenceImageUrl} alt="" className="h-8 w-8 rounded object-cover mt-0.5" />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded bg-[var(--surface-muted)] mt-0.5"><Dumbbell size={14} className="text-[var(--text-faint)]" /></div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-[var(--text-primary)]">{exercise?.name ?? 'Unknown'}</p>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'flex items-center justify-center h-6 w-6 rounded-full transition',
              photoPreview ? 'text-[var(--accent)]' : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'
            )}
            title={photoPreview ? 'Replace photo' : 'Add photo'}
          >
            {isUploading ? <div className="h-3 w-3 animate-spin rounded-full border border-[var(--accent)] border-t-transparent" /> : <Camera size={13} />}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {completedSets.map(s => (
            <span key={s.id} className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">
              {s.weight ?? '—'} × {s.reps ?? '—'}
            </span>
          ))}
          {completedSets.length === 0 && <span className="text-xs text-[var(--text-faint)]">No sets logged</span>}
        </div>
        {photoPreview && (
          <img src={photoPreview} alt="Workout photo" className="mt-2 h-24 w-auto rounded-lg object-cover cursor-pointer hover:opacity-80 transition" onClick={() => window.open(photoPreview, '_blank')} />
        )}
      </div>
    </div>
  );
}

// ============================================================
// HISTORY TAB
// ============================================================

function HistoryTab(props: GymPageProps) {
  const { sessions, dayTemplates, exerciseLogs, setLogs, exercises } = props;
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [pendingDeleteSession, setPendingDeleteSession] = useState<WorkoutSession | null>(null);

  const completedSessions = sessions
    .filter(s => s.status === 'completed' || s.status === 'abandoned')
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  if (completedSessions.length === 0) {
    return (
      <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] p-8 text-center shadow-sm">
        <History size={40} className="mx-auto mb-3 text-[var(--text-faint)]" />
        <p className="text-sm text-[var(--text-muted)]">No workout history yet. Complete a session to see it here.</p>
      </div>
    );
  }

  // Stats
  const thisWeek = completedSessions.filter(s => {
    const d = new Date(s.startedAt);
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    return d >= weekStart;
  });

  const totalSets = completedSessions.reduce((acc, s) => {
    const logs = exerciseLogs.filter(el => el.workoutSessionId === s.id);
    return acc + logs.reduce((a, el) => a + setLogs.filter(sl => sl.workoutExerciseLogId === el.id && sl.completed).length, 0);
  }, 0);

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-4 text-center shadow-sm">
          <Trophy size={20} className="mx-auto mb-1 text-amber-400" />
          <p className="text-2xl font-bold text-[var(--text-primary)]">{completedSessions.length}</p>
          <p className="text-[10px] text-[var(--text-faint)]">Total sessions</p>
        </div>
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-4 text-center shadow-sm">
          <TrendingUp size={20} className="mx-auto mb-1 text-emerald-400" />
          <p className="text-2xl font-bold text-[var(--text-primary)]">{thisWeek.length}</p>
          <p className="text-[10px] text-[var(--text-faint)]">This week</p>
        </div>
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-4 text-center shadow-sm">
          <Dumbbell size={20} className="mx-auto mb-1 text-[var(--accent)]" />
          <p className="text-2xl font-bold text-[var(--text-primary)]">{totalSets}</p>
          <p className="text-[10px] text-[var(--text-faint)]">Total sets</p>
        </div>
      </div>

      {/* Session list */}
      <div className="space-y-2">
        {completedSessions.map(session => {
          const dayName = dayTemplates.find(d => d.id === session.workoutDayTemplateId)?.name ?? 'Workout';
          const logs = exerciseLogs.filter(el => el.workoutSessionId === session.id).sort((a, b) => a.position - b.position);
          const isExpanded = expandedSession === session.id;
          const duration = session.completedAt
            ? Math.round((new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()) / 60000)
            : null;

          return (
            <div key={session.id} className="overflow-hidden rounded-[24px] border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm">
              <div className="flex items-center">
                <button onClick={() => setExpandedSession(isExpanded ? null : session.id)} className="flex flex-1 items-center gap-3 px-4 py-3 text-left">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{dayName}</p>
                      {session.status === 'abandoned' && <span className="rounded bg-red-400/10 px-1.5 py-0.5 text-[9px] text-red-400">Abandoned</span>}
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      {new Date(session.startedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {duration !== null && <span> · {duration} min</span>}
                      <span> · {logs.length} exercises</span>
                    </p>
                  </div>
                  {isExpanded ? <ChevronDown size={16} className="text-[var(--text-faint)]" /> : <ChevronRight size={16} className="text-[var(--text-faint)]" />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setPendingDeleteSession(session); }}
                  className="mr-3 p-1.5 text-[var(--text-faint)] hover:text-red-400 transition rounded-lg hover:bg-red-400/10"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {isExpanded && (
                <div className="border-t border-[var(--border-soft)] px-4 py-3 space-y-3">
                  {logs.map(log => {
                    const ex = exercises.find(e => e.id === log.exerciseId);
                    const logSets = setLogs.filter(sl => sl.workoutExerciseLogId === log.id).sort((a, b) => a.setNumber - b.setNumber);
                    const completedSets = logSets.filter(s => s.completed);
                    return (
                      <HistoryExerciseRow
                        key={log.id}
                        log={log}
                        exercise={ex}
                        completedSets={completedSets}
                        onUploadPhoto={props.onUploadExercisePhoto}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pendingDeleteSession && (
        <ConfirmModal
          title="Delete workout session?"
          message="This will permanently remove the session and its saved logs."
          confirmLabel="Delete Session"
          confirmTone="danger"
          onCancel={() => setPendingDeleteSession(null)}
          onConfirm={() => {
            props.onDeleteSession(pendingDeleteSession.id);
            setPendingDeleteSession(null);
          }}
        />
      )}
    </div>
  );
}
