import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dumbbell, Plus, Play, Square, ChevronRight, ChevronDown,
  Trash2, Edit3, Check, X, Timer, RotateCcw, History,
  Trophy, TrendingUp,
} from 'lucide-react';
import type {
  WorkoutPlan, WorkoutDayTemplate, Exercise,
  WorkoutDayExercise, WorkoutSession, WorkoutExerciseLog, WorkoutSetLog,
} from '../types';
import { cn } from '../utils/cn';

type GymTab = 'plan' | 'workout' | 'history';

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
  onUpdateSetLog: (id: string, updates: Partial<Pick<WorkoutSetLog, 'weight' | 'reps' | 'completed'>>) => Promise<boolean>;
  getLastPerformance: (exerciseId: string, currentSessionId?: string) => WorkoutSetLog[];
}

export function GymPage(props: GymPageProps) {
  const { activeSession } = props;

  const [tab, setTab] = useState<GymTab>(activeSession ? 'workout' : 'plan');

  // Auto-switch to workout tab when session starts
  useEffect(() => {
    if (activeSession) setTab('workout');
  }, [activeSession?.id]);

  const tabs: { key: GymTab; label: string; icon: React.ReactNode }[] = [
    { key: 'plan', label: 'Plan', icon: <Dumbbell size={16} /> },
    { key: 'workout', label: 'Workout', icon: <Play size={16} /> },
    { key: 'history', label: 'History', icon: <History size={16} /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Gym</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
              tab === t.key
                ? 'bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-sm'
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
    </div>
  );
}

// ============================================================
// PLAN TAB
// ============================================================

function PlanTab(props: GymPageProps) {
  const { activePlan, dayTemplates, exercises, dayExercises } = props;
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanDays, setNewPlanDays] = useState(5);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [showAddDay, setShowAddDay] = useState(false);
  const [newDayName, setNewDayName] = useState('');
  const [showExerciseLib, setShowExerciseLib] = useState(false);

  const handleCreatePlan = async () => {
    if (!newPlanName.trim()) return;
    await props.onAddPlan(newPlanName.trim(), '', newPlanDays);
    setNewPlanName('');
    setShowNewPlan(false);
  };

  const planDays = activePlan
    ? dayTemplates.filter(d => d.planId === activePlan.id).sort((a, b) => a.position - b.position)
    : [];

  const handleAddDay = async () => {
    if (!activePlan || !newDayName.trim()) return;
    await props.onAddDayTemplate(activePlan.id, newDayName.trim());
    setNewDayName('');
    setShowAddDay(false);
  };

  return (
    <div className="space-y-6">
      {/* Active plan or create */}
      {!activePlan ? (
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-6">
          {showNewPlan ? (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Create Workout Plan</h3>
              <input
                value={newPlanName}
                onChange={e => setNewPlanName(e.target.value)}
                placeholder="Plan name (e.g. Push Pull Legs)"
                className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                onKeyDown={e => { if (e.key === 'Enter') handleCreatePlan(); }}
                autoFocus
              />
              <div className="flex items-center gap-3">
                <label className="text-sm text-[var(--text-muted)]">Days per week:</label>
                <div className="flex gap-1">
                  {[3, 4, 5, 6, 7].map(n => (
                    <button
                      key={n}
                      onClick={() => setNewPlanDays(n)}
                      className={cn(
                        'h-8 w-8 rounded-lg text-sm font-medium transition',
                        newPlanDays === n
                          ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                          : 'border border-[var(--border-soft)] text-[var(--text-muted)] hover:bg-[var(--surface-muted)]'
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleCreatePlan} disabled={!newPlanName.trim()} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)' }}>Create</button>
                <button onClick={() => setShowNewPlan(false)} className="rounded-lg border border-[var(--border-soft)] px-4 py-2 text-sm text-[var(--text-muted)]">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <Dumbbell size={40} className="mx-auto mb-3 text-[var(--text-faint)]" />
              <p className="text-sm text-[var(--text-muted)] mb-4">No workout plan yet. Create one to get started.</p>
              <button
                onClick={() => setShowNewPlan(true)}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-[var(--accent-contrast)]"
                style={{ backgroundColor: 'var(--accent-strong)' }}
              >
                <Plus size={16} />
                New Plan
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Plan header */}
          <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">{activePlan.name}</h2>
                <p className="text-sm text-[var(--text-muted)]">{activePlan.daysPerWeek} days/week · {planDays.length} workout days</p>
              </div>
              <button
                onClick={() => { if (confirm('Delete this plan?')) props.onDeletePlan(activePlan.id); }}
                className="text-[var(--text-faint)] hover:text-red-400 transition"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          {/* Workout days */}
          <div className="space-y-3">
            {planDays.map((day, idx) => (
              <WorkoutDayCard
                key={day.id}
                day={day}
                dayNumber={idx + 1}
                isExpanded={expandedDay === day.id}
                onToggle={() => setExpandedDay(expandedDay === day.id ? null : day.id)}
                exercises={exercises}
                dayExercises={dayExercises.filter(de => de.workoutDayTemplateId === day.id).sort((a, b) => a.position - b.position)}
                onUpdateDay={props.onUpdateDayTemplate}
                onDeleteDay={props.onDeleteDayTemplate}
                onAddDayExercise={props.onAddDayExercise}
                onUpdateDayExercise={props.onUpdateDayExercise}
                onDeleteDayExercise={props.onDeleteDayExercise}
                onAddExercise={props.onAddExercise}
              />
            ))}

            {/* Add day button */}
            {showAddDay ? (
              <div className="flex gap-2 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-3">
                <input
                  value={newDayName}
                  onChange={e => setNewDayName(e.target.value)}
                  placeholder="Day name (e.g. Push, Pull, Legs)"
                  className="flex-1 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                  onKeyDown={e => { if (e.key === 'Enter') handleAddDay(); if (e.key === 'Escape') setShowAddDay(false); }}
                  autoFocus
                />
                <button onClick={handleAddDay} disabled={!newDayName.trim()} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)' }}>Add</button>
                <button onClick={() => setShowAddDay(false)} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-muted)]"><X size={16} /></button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddDay(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-soft)] py-3 text-sm font-medium text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Plus size={16} />
                Add Workout Day
              </button>
            )}
          </div>

          {/* Exercise Library */}
          <div>
            <button
              onClick={() => setShowExerciseLib(!showExerciseLib)}
              className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
            >
              {showExerciseLib ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              Exercise Library ({exercises.length})
            </button>
            {showExerciseLib && <ExerciseLibrary exercises={exercises} onAdd={props.onAddExercise} onDelete={props.onDeleteExercise} />}
          </div>
        </>
      )}
    </div>
  );
}

// --- Workout Day Card ---
function WorkoutDayCard({
  day, dayNumber, isExpanded, onToggle, exercises, dayExercises,
  onUpdateDay, onDeleteDay, onAddDayExercise, onUpdateDayExercise, onDeleteDayExercise, onAddExercise,
}: {
  day: WorkoutDayTemplate;
  dayNumber: number;
  isExpanded: boolean;
  onToggle: () => void;
  exercises: Exercise[];
  dayExercises: WorkoutDayExercise[];
  onUpdateDay: GymPageProps['onUpdateDayTemplate'];
  onDeleteDay: GymPageProps['onDeleteDayTemplate'];
  onAddDayExercise: GymPageProps['onAddDayExercise'];
  onUpdateDayExercise: GymPageProps['onUpdateDayExercise'];
  onDeleteDayExercise: GymPageProps['onDeleteDayExercise'];
  onAddExercise: GymPageProps['onAddExercise'];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(day.name);
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [addExerciseId, setAddExerciseId] = useState('');
  const [addSets, setAddSets] = useState(3);
  const [addReps, setAddReps] = useState('10');
  const [addRest, setAddRest] = useState(90);
  const [showNewExercise, setShowNewExercise] = useState(false);
  const [newExName, setNewExName] = useState('');
  const [newExMuscle, setNewExMuscle] = useState('');

  const handleRename = async () => {
    if (editName.trim() && editName.trim() !== day.name) {
      await onUpdateDay(day.id, { name: editName.trim() });
    }
    setIsEditing(false);
  };

  const handleAddExerciseToPlan = async () => {
    if (!addExerciseId) return;
    await onAddDayExercise(day.id, addExerciseId, addSets, addReps, addRest);
    setShowAddExercise(false);
    setAddExerciseId('');
    setAddSets(3);
    setAddReps('10');
    setAddRest(90);
  };

  const handleCreateAndAdd = async () => {
    if (!newExName.trim()) return;
    const exId = await onAddExercise(newExName.trim(), newExMuscle.trim(), '');
    if (exId) {
      setAddExerciseId(exId);
      setShowNewExercise(false);
      setNewExName('');
      setNewExMuscle('');
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] overflow-hidden">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent)]">
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
          <span className="ml-2 text-xs text-[var(--text-faint)]">{dayExercises.length} exercises</span>
        </div>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button onClick={() => { setEditName(day.name); setIsEditing(true); }} className="p-1.5 text-[var(--text-faint)] hover:text-[var(--text-primary)] transition"><Edit3 size={14} /></button>
          <button onClick={() => { if (confirm('Delete this day?')) onDeleteDay(day.id); }} className="p-1.5 text-[var(--text-faint)] hover:text-red-400 transition"><Trash2 size={14} /></button>
        </div>
        {isExpanded ? <ChevronDown size={16} className="text-[var(--text-faint)]" /> : <ChevronRight size={16} className="text-[var(--text-faint)]" />}
      </button>

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

          {/* Add exercise */}
          {showAddExercise ? (
            <div className="space-y-3 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3">
              <div className="flex gap-2">
                <select
                  value={addExerciseId}
                  onChange={e => setAddExerciseId(e.target.value)}
                  className="flex-1 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none"
                >
                  <option value="">Select exercise...</option>
                  {exercises.map(ex => (
                    <option key={ex.id} value={ex.id}>{ex.name}{ex.muscleGroup ? ` (${ex.muscleGroup})` : ''}</option>
                  ))}
                </select>
                <button onClick={() => setShowNewExercise(true)} className="rounded-lg border border-[var(--border-soft)] px-2 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] transition">New</button>
              </div>

              {showNewExercise && (
                <div className="flex gap-2">
                  <input value={newExName} onChange={e => setNewExName(e.target.value)} placeholder="Exercise name" className="flex-1 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-2 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none" />
                  <input value={newExMuscle} onChange={e => setNewExMuscle(e.target.value)} placeholder="Muscle group" className="w-28 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-2 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none" />
                  <button onClick={handleCreateAndAdd} disabled={!newExName.trim()} className="rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--accent-contrast)] disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)' }}>Create</button>
                </div>
              )}

              <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                <label className="flex items-center gap-1">Sets: <input type="number" value={addSets} onChange={e => setAddSets(Number(e.target.value))} min={1} max={20} className="w-12 rounded border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-1.5 py-1 text-center text-sm text-[var(--text-primary)] focus:outline-none" /></label>
                <label className="flex items-center gap-1">Reps: <input value={addReps} onChange={e => setAddReps(e.target.value)} className="w-20 rounded border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-1.5 py-1 text-sm text-[var(--text-primary)] focus:outline-none" placeholder="e.g. 12,10,8" /></label>
                <label className="flex items-center gap-1">Rest: <input type="number" value={addRest} onChange={e => setAddRest(Number(e.target.value))} min={0} step={15} className="w-14 rounded border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-1.5 py-1 text-center text-sm text-[var(--text-primary)] focus:outline-none" />s</label>
              </div>

              <div className="flex gap-2">
                <button onClick={handleAddExerciseToPlan} disabled={!addExerciseId} className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--accent-contrast)] disabled:opacity-40" style={{ backgroundColor: 'var(--accent-strong)' }}>Add to Day</button>
                <button onClick={() => setShowAddExercise(false)} className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs text-[var(--text-muted)]">Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddExercise(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border-soft)] py-2 text-xs text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <Plus size={14} />
              Add Exercise
            </button>
          )}
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
    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-muted)] transition group">
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
          <button onClick={() => setIsEditing(true)} className="p-1 text-[var(--text-faint)] opacity-0 group-hover:opacity-100 transition"><Edit3 size={12} /></button>
          <button onClick={() => onDelete(dayExercise.id)} className="p-1 text-[var(--text-faint)] opacity-0 group-hover:opacity-100 hover:text-red-400 transition"><Trash2 size={12} /></button>
        </div>
      )}
    </div>
  );
}

// --- Exercise Library ---
function ExerciseLibrary({
  exercises, onAdd, onDelete,
}: {
  exercises: Exercise[];
  onAdd: GymPageProps['onAddExercise'];
  onDelete: GymPageProps['onDeleteExercise'];
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [muscle, setMuscle] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const handleAdd = async () => {
    if (!name.trim()) return;
    await onAdd(name.trim(), muscle.trim(), '', imageUrl.trim() || undefined);
    setName('');
    setMuscle('');
    setImageUrl('');
    setShowAdd(false);
  };

  const muscleGroups = [...new Set(exercises.map(e => e.muscleGroup).filter(Boolean))];

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-4">
      {exercises.length === 0 && <p className="text-xs text-[var(--text-faint)] text-center py-2">No exercises in your library</p>}

      {muscleGroups.length > 0 && muscleGroups.map(group => (
        <div key={group}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1">{group}</p>
          {exercises.filter(e => e.muscleGroup === group).map(ex => (
            <div key={ex.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-[var(--surface-muted)] group">
              {ex.referenceImageUrl ? (
                <img src={ex.referenceImageUrl} alt="" className="h-6 w-6 rounded object-cover" />
              ) : (
                <Dumbbell size={12} className="text-[var(--text-faint)]" />
              )}
              <span className="flex-1 text-sm text-[var(--text-primary)]">{ex.name}</span>
              <button onClick={() => onDelete(ex.id)} className="p-1 text-[var(--text-faint)] opacity-0 group-hover:opacity-100 hover:text-red-400 transition"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      ))}

      {/* Ungrouped */}
      {exercises.filter(e => !e.muscleGroup).length > 0 && (
        <div>
          {muscleGroups.length > 0 && <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1">Other</p>}
          {exercises.filter(e => !e.muscleGroup).map(ex => (
            <div key={ex.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-[var(--surface-muted)] group">
              <Dumbbell size={12} className="text-[var(--text-faint)]" />
              <span className="flex-1 text-sm text-[var(--text-primary)]">{ex.name}</span>
              <button onClick={() => onDelete(ex.id)} className="p-1 text-[var(--text-faint)] opacity-0 group-hover:opacity-100 hover:text-red-400 transition"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {showAdd ? (
        <div className="space-y-2 border-t border-[var(--border-soft)] pt-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Exercise name" className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none" autoFocus onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} />
          <div className="flex gap-2">
            <input value={muscle} onChange={e => setMuscle(e.target.value)} placeholder="Muscle group" className="flex-1 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none" />
            <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="Image URL (optional)" className="flex-1 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none" />
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

// ============================================================
// WORKOUT TAB (Active Session)
// ============================================================

function WorkoutTab(props: GymPageProps) {
  const {
    activeSession, activePlan, dayTemplates, exercises, dayExercises,
    exerciseLogs, setLogs, sessions,
  } = props;

  const [currentExIdx, setCurrentExIdx] = useState(0);

  if (!activePlan) {
    return (
      <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-8 text-center">
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
    if (confirm('Abandon this workout? Progress will still be saved.')) {
      props.onCompleteSession(activeSession.id, 'abandoned');
    }
  };

  return (
    <div className="space-y-4">
      {/* Session header */}
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{dayName}</h2>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Started {new Date(activeSession.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {completedExercises}/{totalExercises} exercises done
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAbandon} className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-red-400 transition">
              <Square size={14} />
            </button>
            <button onClick={handleFinish} className="rounded-lg px-4 py-1.5 text-xs font-medium text-[var(--accent-contrast)]" style={{ backgroundColor: 'var(--accent-strong)' }}>
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
          dayExercise={currentDayExercise}
          sets={currentSets}
          lastPerformance={lastPerformance}
          onUpdateSet={props.onUpdateSetLog}
          onNext={() => setCurrentExIdx(Math.min(currentExIdx + 1, sessionLogs.length - 1))}
          isLast={currentExIdx === sessionLogs.length - 1}
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
      <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-6 text-center">
        <Play size={32} className="mx-auto mb-3 text-[var(--accent)]" />
        <h3 className="text-lg font-bold text-[var(--text-primary)]">Start a Workout</h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Choose which day to train</p>
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
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border-soft)] bg-[var(--surface-elevated)] hover:border-[var(--border-strong)]'
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

// --- Active Exercise Card ---
function ActiveExerciseCard({
  exercise, dayExercise, sets, lastPerformance, onUpdateSet, onNext, isLast,
}: {
  exercise: Exercise;
  dayExercise: WorkoutDayExercise | null;
  sets: WorkoutSetLog[];
  lastPerformance: WorkoutSetLog[];
  onUpdateSet: GymPageProps['onUpdateSetLog'];
  onNext: () => void;
  isLast: boolean;
}) {
  const [restActive, setRestActive] = useState(false);
  const [restTime, setRestTime] = useState(0);
  const restInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const restTotal = dayExercise?.restSeconds ?? 90;

  const startRest = useCallback(() => {
    setRestTime(restTotal);
    setRestActive(true);
  }, [restTotal]);

  useEffect(() => {
    if (!restActive) return;
    restInterval.current = setInterval(() => {
      setRestTime(prev => {
        if (prev <= 1) {
          setRestActive(false);
          // Play a brief sound via Web Audio
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

  const handleToggleSet = async (set: WorkoutSetLog) => {
    await onUpdateSet(set.id, { completed: !set.completed });
    if (!set.completed) startRest();
  };

  const allDone = sets.length > 0 && sets.every(s => s.completed);

  // Format last performance
  const lastText = lastPerformance.length > 0
    ? lastPerformance.filter(s => s.completed).map(s => `${s.weight ?? '—'}×${s.reps ?? '—'}`).join(', ')
    : null;

  return (
    <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] overflow-hidden">
      {/* Exercise header */}
      <div className="flex items-center gap-4 border-b border-[var(--border-soft)] px-5 py-4">
        {exercise.referenceImageUrl ? (
          <img src={exercise.referenceImageUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--surface-muted)]">
            <Dumbbell size={24} className="text-[var(--text-faint)]" />
          </div>
        )}
        <div className="flex-1">
          <h3 className="text-lg font-bold text-[var(--text-primary)]">{exercise.name}</h3>
          <p className="text-xs text-[var(--text-muted)]">
            {exercise.muscleGroup && <span>{exercise.muscleGroup} · </span>}
            {dayExercise ? `${dayExercise.targetSets} sets × ${dayExercise.targetReps} reps` : `${sets.length} sets`}
          </p>
        </div>
        {allDone && <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/15"><Check size={18} className="text-emerald-400" /></div>}
      </div>

      {/* Last performance */}
      {lastText && (
        <div className="flex items-center gap-2 border-b border-[var(--border-soft)] bg-[var(--surface-muted)] px-5 py-2">
          <RotateCcw size={12} className="text-[var(--text-faint)]" />
          <span className="text-xs text-[var(--text-muted)]">Last time: {lastText}</span>
        </div>
      )}

      {/* Sets */}
      <div className="px-5 py-4 space-y-2">
        <div className="grid grid-cols-[2rem_1fr_1fr_3rem] gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] px-1">
          <span>Set</span>
          <span>Weight</span>
          <span>Reps</span>
          <span />
        </div>

        {sets.map(set => (
          <SetRow
            key={set.id}
            set={set}
            lastSet={lastPerformance.find(lp => lp.setNumber === set.setNumber)}
            onUpdate={onUpdateSet}
            onToggle={() => handleToggleSet(set)}
          />
        ))}
      </div>

      {/* Rest timer */}
      {restActive && (
        <div className="border-t border-[var(--border-soft)] bg-[var(--accent-soft)] px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Timer size={18} className="text-[var(--accent)]" />
              <span className="text-2xl font-bold tabular-nums text-[var(--accent)]">
                {Math.floor(restTime / 60)}:{String(restTime % 60).padStart(2, '0')}
              </span>
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

      {/* Actions */}
      <div className="flex gap-2 border-t border-[var(--border-soft)] px-5 py-3">
        {!restActive && (
          <button onClick={startRest} className="flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-muted)] transition">
            <Timer size={14} />
            Rest ({restTotal}s)
          </button>
        )}
        <div className="flex-1" />
        {!isLast && (
          <button onClick={onNext} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-[var(--accent-contrast)]" style={{ backgroundColor: 'var(--accent-strong)' }}>
            Next Exercise
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// --- Set Row ---
function SetRow({
  set, lastSet, onUpdate, onToggle,
}: {
  set: WorkoutSetLog;
  lastSet?: WorkoutSetLog;
  onUpdate: GymPageProps['onUpdateSetLog'];
  onToggle: () => void;
}) {
  const [weight, setWeight] = useState(set.weight?.toString() ?? lastSet?.weight?.toString() ?? '');
  const [reps, setReps] = useState(set.reps?.toString() ?? lastSet?.reps?.toString() ?? '');

  const handleBlur = () => {
    const w = weight ? Number(weight) : null;
    const r = reps ? Number(reps) : null;
    if (w !== set.weight || r !== set.reps) {
      onUpdate(set.id, { weight: w, reps: r });
    }
  };

  return (
    <div className={cn(
      'grid grid-cols-[2rem_1fr_1fr_3rem] gap-2 items-center rounded-lg px-1 py-1.5 transition',
      set.completed ? 'bg-emerald-400/5' : 'hover:bg-[var(--surface-muted)]'
    )}>
      <span className={cn('text-center text-sm font-bold', set.completed ? 'text-emerald-400' : 'text-[var(--text-faint)]')}>
        {set.setNumber}
      </span>
      <input
        type="number"
        value={weight}
        onChange={e => setWeight(e.target.value)}
        onBlur={handleBlur}
        placeholder={lastSet?.weight?.toString() ?? '—'}
        className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2 py-1.5 text-center text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
      />
      <input
        type="number"
        value={reps}
        onChange={e => setReps(e.target.value)}
        onBlur={handleBlur}
        placeholder={lastSet?.reps?.toString() ?? '—'}
        className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2 py-1.5 text-center text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
      />
      <button
        onClick={() => {
          // Auto-save weight/reps before toggling
          const w = weight ? Number(weight) : null;
          const r = reps ? Number(reps) : null;
          if (w !== set.weight || r !== set.reps) {
            onUpdate(set.id, { weight: w, reps: r });
          }
          onToggle();
        }}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg transition',
          set.completed
            ? 'bg-emerald-400 text-white'
            : 'border border-[var(--border-soft)] text-[var(--text-faint)] hover:border-emerald-400 hover:text-emerald-400'
        )}
      >
        <Check size={16} />
      </button>
    </div>
  );
}

// ============================================================
// HISTORY TAB
// ============================================================

function HistoryTab(props: GymPageProps) {
  const { sessions, dayTemplates, exerciseLogs, setLogs, exercises } = props;
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const completedSessions = sessions
    .filter(s => s.status === 'completed' || s.status === 'abandoned')
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  if (completedSessions.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-8 text-center">
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
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-4 text-center">
          <Trophy size={20} className="mx-auto mb-1 text-amber-400" />
          <p className="text-2xl font-bold text-[var(--text-primary)]">{completedSessions.length}</p>
          <p className="text-[10px] text-[var(--text-faint)]">Total sessions</p>
        </div>
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-4 text-center">
          <TrendingUp size={20} className="mx-auto mb-1 text-emerald-400" />
          <p className="text-2xl font-bold text-[var(--text-primary)]">{thisWeek.length}</p>
          <p className="text-[10px] text-[var(--text-faint)]">This week</p>
        </div>
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-4 text-center">
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
            <div key={session.id} className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] overflow-hidden">
              <button onClick={() => setExpandedSession(isExpanded ? null : session.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
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

              {isExpanded && (
                <div className="border-t border-[var(--border-soft)] px-4 py-3 space-y-3">
                  {logs.map(log => {
                    const ex = exercises.find(e => e.id === log.exerciseId);
                    const logSets = setLogs.filter(sl => sl.workoutExerciseLogId === log.id).sort((a, b) => a.setNumber - b.setNumber);
                    const completedSets = logSets.filter(s => s.completed);

                    return (
                      <div key={log.id} className="flex items-start gap-3">
                        {ex?.referenceImageUrl ? (
                          <img src={ex.referenceImageUrl} alt="" className="h-8 w-8 rounded object-cover mt-0.5" />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded bg-[var(--surface-muted)] mt-0.5"><Dumbbell size={14} className="text-[var(--text-faint)]" /></div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--text-primary)]">{ex?.name ?? 'Unknown'}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {completedSets.map(s => (
                              <span key={s.id} className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">
                                {s.weight ?? '—'} × {s.reps ?? '—'}
                              </span>
                            ))}
                            {completedSets.length === 0 && <span className="text-xs text-[var(--text-faint)]">No sets logged</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
