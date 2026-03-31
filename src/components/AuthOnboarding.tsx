import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, LoaderCircle, Moon, Sparkles, Sunrise, Sunset, X } from 'lucide-react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useBehaviorLearning, type BehaviorLearningSeedPreset } from '../hooks/useBehaviorLearning';
import { cn } from '../utils/cn';

interface AuthOnboardingProps {
  user: User;
  onComplete: () => Promise<void> | void;
  mode?: 'first-run' | 'preferences';
  onCancel?: () => void;
}

type FocusWindow = 'morning' | 'afternoon' | 'evening' | 'late-night';
type AiStructure = 'light' | 'balanced' | 'proactive';
type ScheduleIntensity = 'light' | 'balanced' | 'ambitious';
type WorkStyle = 'early' | 'mixed' | 'procrastinator';

type StepId = 'focus-window' | 'ai-structure' | 'session-length' | 'schedule-intensity' | 'work-style';

interface ChoiceOption<T extends string> {
  id: T;
  title: string;
  subtitle: string;
}

const focusOptions: ChoiceOption<FocusWindow>[] = [
  { id: 'morning', title: 'Morning', subtitle: 'You usually focus best earlier in the day.' },
  { id: 'afternoon', title: 'Afternoon', subtitle: 'Your best work tends to happen mid-day.' },
  { id: 'evening', title: 'Evening', subtitle: 'You like getting into a flow after classes or work.' },
  { id: 'late-night', title: 'Late night', subtitle: 'You often hit your best focus window later on.' },
];

const structureOptions: ChoiceOption<AiStructure>[] = [
  { id: 'light', title: 'A little', subtitle: 'Keep AI mostly suggestive and lightweight.' },
  { id: 'balanced', title: 'Balanced', subtitle: 'Let AI guide you without taking over the whole plan.' },
  { id: 'proactive', title: 'Proactive', subtitle: 'Have AI step in more often with study blocks and nudges.' },
];

const scheduleOptions: ChoiceOption<ScheduleIntensity>[] = [
  { id: 'light', title: 'Light and realistic', subtitle: 'Protect breathing room and avoid overload.' },
  { id: 'balanced', title: 'Balanced', subtitle: 'Aim for steady momentum without overstuffing the week.' },
  { id: 'ambitious', title: 'Ambitious', subtitle: 'Push the plan harder when there is room to do more.' },
];

const workStyleOptions: ChoiceOption<WorkStyle>[] = [
  { id: 'early', title: 'I get work done early', subtitle: 'You like being ahead of deadlines when possible.' },
  { id: 'mixed', title: 'It depends', subtitle: 'Some weeks you are early, other weeks you react later.' },
  { id: 'procrastinator', title: 'I procrastinate a lot', subtitle: 'You usually need stronger nudges to start sooner.' },
];

const sessionStops = [
  { label: '<30 min', minutes: 25 },
  { label: '45 min', minutes: 45 },
  { label: '1 hour', minutes: 60 },
  { label: '90 min', minutes: 90 },
  { label: '2h+', minutes: 135 },
];

const steps: { id: StepId; title: string; subtitle: string }[] = [
  {
    id: 'focus-window',
    title: 'When do you usually focus best?',
    subtitle: 'We’ll use this to anchor the first set of AI scheduling decisions.',
  },
  {
    id: 'ai-structure',
    title: 'How much structure do you want from AI?',
    subtitle: 'This helps decide whether the app should suggest lightly or plan more proactively.',
  },
  {
    id: 'session-length',
    title: 'How long do you usually like your study sessions?',
    subtitle: 'Pick the general session length you naturally stick with best.',
  },
  {
    id: 'schedule-intensity',
    title: 'How packed should your schedule feel?',
    subtitle: 'This helps AI stay realistic when it creates study plans around deadlines.',
  },
  {
    id: 'work-style',
    title: 'What kind of planner are you?',
    subtitle: 'We’ll use this to decide how early AI should try to start you on things.',
  },
];

function presetFromFocusWindow(focusWindow: FocusWindow): BehaviorLearningSeedPreset {
  if (focusWindow === 'morning') return 'early-bird';
  if (focusWindow === 'late-night') return 'night-owl';
  return 'normal-grinder';
}

function iconForFocusWindow(focusWindow: FocusWindow) {
  if (focusWindow === 'morning') return Sunrise;
  if (focusWindow === 'late-night') return Moon;
  return Sunset;
}

export function AuthOnboarding({ user, onComplete, mode = 'first-run', onCancel }: AuthOnboardingProps) {
  const learning = useBehaviorLearning(user.id);
  const metadata = user.user_metadata ?? {};
  const initialFocusWindow = (metadata.onboarding_focus_window as FocusWindow | undefined) ?? null;
  const initialAiStructure = (metadata.onboarding_ai_structure as AiStructure | undefined) ?? null;
  const initialScheduleIntensity = (metadata.onboarding_schedule_intensity as ScheduleIntensity | undefined) ?? null;
  const initialWorkStyle = (metadata.onboarding_work_style as WorkStyle | undefined) ?? null;
  const initialSessionMinutes = Number(metadata.onboarding_session_minutes);
  const initialSessionStopIndex = Number.isFinite(initialSessionMinutes)
    ? Math.min(
        Math.max(
          sessionStops.findIndex(stop => stop.minutes >= initialSessionMinutes),
          0,
        ),
        sessionStops.length - 1,
      )
    : 2;
  const [stepIndex, setStepIndex] = useState(0);
  const [focusWindow, setFocusWindow] = useState<FocusWindow | null>(initialFocusWindow);
  const [aiStructure, setAiStructure] = useState<AiStructure | null>(initialAiStructure);
  const [sessionStopIndex, setSessionStopIndex] = useState(initialSessionStopIndex);
  const [scheduleIntensity, setScheduleIntensity] = useState<ScheduleIntensity | null>(initialScheduleIntensity);
  const [workStyle, setWorkStyle] = useState<WorkStyle | null>(initialWorkStyle);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');

  const currentStep = steps[stepIndex];
  const progress = ((stepIndex + 1) / steps.length) * 100;
  const displayName = useMemo(
    () => user.user_metadata?.full_name || user.email?.split('@')[0] || 'there',
    [user.email, user.user_metadata],
  );

  const selectedSession = sessionStops[sessionStopIndex];
  const heading = currentStep.title;
  const subheading = currentStep.subtitle;
  const canGoNext = (() => {
    switch (currentStep.id) {
      case 'focus-window':
        return Boolean(focusWindow);
      case 'ai-structure':
        return Boolean(aiStructure);
      case 'session-length':
        return true;
      case 'schedule-intensity':
        return Boolean(scheduleIntensity);
      case 'work-style':
        return Boolean(workStyle);
      default:
        return false;
    }
  })();

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (mode === 'preferences') {
        onCancel?.();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [mode, onCancel]);

  const finishOnboarding = async () => {
    if (!supabase || !focusWindow || !aiStructure || !scheduleIntensity || !workStyle) return;

    setIsSubmitting(true);
    setError(null);

    const learningPreset = presetFromFocusWindow(focusWindow);

    try {
      learning.seedLearningProfile(learningPreset);

      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString(),
          onboarding_learning_preset: learningPreset,
          onboarding_focus_window: focusWindow,
          onboarding_ai_structure: aiStructure,
          onboarding_session_minutes: selectedSession.minutes,
          onboarding_schedule_intensity: scheduleIntensity,
          onboarding_work_style: workStyle,
        },
      });

      if (updateError) throw updateError;

      await onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your setup choices.');
      setIsSubmitting(false);
    }
  };

  const goNext = async () => {
    if (!canGoNext || isSubmitting) return;

    if (stepIndex === steps.length - 1) {
      await finishOnboarding();
      return;
    }

    setDirection('forward');
    setStepIndex(current => current + 1);
  };

  const handleBack = () => {
    if (stepIndex === 0 || isSubmitting) return;
    setDirection('backward');
    setStepIndex(current => current - 1);
  };

  const handleSkip = async () => {
    if (mode === 'preferences') {
      onCancel?.();
      return;
    }

    if (!supabase || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString(),
          onboarding_learning_preset: null,
          onboarding_focus_window: null,
          onboarding_ai_structure: null,
          onboarding_session_minutes: null,
          onboarding_schedule_intensity: null,
          onboarding_work_style: null,
        },
      });

      if (updateError) throw updateError;

      await onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish onboarding.');
      setIsSubmitting(false);
    }
  };

  const FocusIcon = iconForFocusWindow(focusWindow ?? 'afternoon');

  const content = (
    <div
      className={cn(
        'text-[var(--text-primary)]',
        mode === 'preferences'
          ? 'fixed inset-0 z-[10010] flex items-center justify-center px-4 py-8'
          : 'flex min-h-screen items-center justify-center px-6 py-10',
      )}
      style={mode === 'preferences' ? undefined : { background: 'var(--bg-app)' }}
    >
      {mode === 'preferences' && (
        <button
          type="button"
          className="absolute inset-0 bg-black/55"
          aria-label="Close preference setup"
          onClick={onCancel}
        />
      )}

      <div className="relative w-full max-w-3xl rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-6 shadow-sm sm:p-8">
        <div className="mx-auto max-w-xl overflow-hidden">
          {mode === 'preferences' && (
            <button
              type="button"
              onClick={onCancel}
              className="absolute right-5 top-5 rounded-xl p-2 text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
              aria-label="Close preference setup"
            >
              <X size={16} />
            </button>
          )}

          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-muted)] text-[var(--accent)]">
            <Sparkles size={22} />
          </div>

          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
            <div
              className="h-full rounded-full bg-[var(--accent-strong)] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-3 text-xs uppercase tracking-[0.18em] text-[var(--text-faint)]">
            Step {stepIndex + 1} of {steps.length}
          </div>

          <div className="mt-6">
            <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{subheading}</p>
            <p className="mt-3 text-sm text-[var(--text-secondary)]">
              {mode === 'preferences'
                ? `Updating your preferences for ${displayName}.`
                : `Welcome, ${displayName}.`}
            </p>
          </div>

          <div className="mt-8">
            <div
              className={cn(
                'transition-all duration-300 onboarding-step-enter',
                direction === 'forward' ? 'onboarding-step-forward' : 'onboarding-step-backward',
              )}
              key={currentStep.id}
            >
              {currentStep.id === 'focus-window' && (
                <div className="space-y-3">
                  {focusOptions.map(option => {
                    const Icon = option.id === 'morning' ? Sunrise : option.id === 'late-night' ? Moon : Sunset;
                    const active = focusWindow === option.id;

                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setFocusWindow(option.id);
                          void goNext();
                        }}
                        className={cn(
                          'flex w-full items-start gap-4 rounded-2xl border px-4 py-4 text-left transition',
                          active
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                            : 'border-[var(--border-soft)] bg-[var(--surface)] hover:border-[var(--accent)]/35',
                        )}
                      >
                        <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--surface-muted)] text-[var(--accent)]">
                          <Icon size={18} />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-[var(--text-primary)]">{option.title}</div>
                          <div className="mt-1 text-sm text-[var(--text-secondary)]">{option.subtitle}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {currentStep.id === 'ai-structure' && (
                <div className="space-y-3">
                  {structureOptions.map(option => {
                    const active = aiStructure === option.id;

                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setAiStructure(option.id);
                          void goNext();
                        }}
                        className={cn(
                          'w-full rounded-2xl border px-4 py-4 text-left transition',
                          active
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                            : 'border-[var(--border-soft)] bg-[var(--surface)] hover:border-[var(--accent)]/35',
                        )}
                      >
                        <div className="text-sm font-semibold text-[var(--text-primary)]">{option.title}</div>
                        <div className="mt-1 text-sm text-[var(--text-secondary)]">{option.subtitle}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              {currentStep.id === 'session-length' && (
                <div className="rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-muted)] text-[var(--accent)]">
                      <FocusIcon size={20} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{selectedSession.label}</div>
                      <div className="text-sm text-[var(--text-secondary)]">
                        {selectedSession.minutes < 30
                          ? 'Short, low-friction focus bursts.'
                          : selectedSession.minutes < 60
                            ? 'A compact block that is easier to start.'
                            : selectedSession.minutes < 90
                              ? 'A balanced default for most study sessions.'
                              : selectedSession.minutes < 120
                                ? 'Longer deep-work sessions.'
                                : 'Extended blocks when you really want to settle in.'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 px-2">
                    <input
                      type="range"
                      min={0}
                      max={sessionStops.length - 1}
                      step={1}
                      value={sessionStopIndex}
                      onChange={(event) => setSessionStopIndex(Number(event.target.value))}
                      onMouseUp={() => void goNext()}
                      onTouchEnd={() => void goNext()}
                      onKeyUp={(event) => {
                        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                          void goNext();
                        }
                      }}
                      className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--surface-muted)] accent-[var(--accent-strong)]"
                    />
                    <div className="mt-4 flex items-center justify-between gap-2 text-[11px] text-[var(--text-faint)]">
                      {sessionStops.map((stop, index) => (
                        <button
                          key={stop.label}
                          type="button"
                          onClick={() => {
                            setSessionStopIndex(index);
                            void goNext();
                          }}
                          className={cn(
                            'rounded-full px-2 py-1 transition',
                            index === sessionStopIndex
                              ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                              : 'hover:text-[var(--text-secondary)]',
                          )}
                        >
                          {stop.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {currentStep.id === 'schedule-intensity' && (
                <div className="space-y-3">
                  {scheduleOptions.map(option => {
                    const active = scheduleIntensity === option.id;

                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setScheduleIntensity(option.id);
                          void goNext();
                        }}
                        className={cn(
                          'w-full rounded-2xl border px-4 py-4 text-left transition',
                          active
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                            : 'border-[var(--border-soft)] bg-[var(--surface)] hover:border-[var(--accent)]/35',
                        )}
                      >
                        <div className="text-sm font-semibold text-[var(--text-primary)]">{option.title}</div>
                        <div className="mt-1 text-sm text-[var(--text-secondary)]">{option.subtitle}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              {currentStep.id === 'work-style' && (
                <div className="space-y-3">
                  {workStyleOptions.map(option => {
                    const active = workStyle === option.id;

                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setWorkStyle(option.id);
                          void goNext();
                        }}
                        className={cn(
                          'w-full rounded-2xl border px-4 py-4 text-left transition',
                          active
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                            : 'border-[var(--border-soft)] bg-[var(--surface)] hover:border-[var(--accent)]/35',
                        )}
                      >
                        <div className="text-sm font-semibold text-[var(--text-primary)]">{option.title}</div>
                        <div className="mt-1 text-sm text-[var(--text-secondary)]">{option.subtitle}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-200">
              {error}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {steps.map((step, index) => (
                <span
                  key={step.id}
                  className={cn(
                    'block h-2.5 w-2.5 rounded-full transition-all',
                    index === stepIndex
                      ? 'bg-[var(--text-primary)]'
                      : 'bg-[var(--border-soft)]',
                  )}
                />
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSkip()}
                disabled={isSubmitting}
                className="text-sm font-medium text-[var(--text-muted)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mode === 'preferences' ? 'Cancel' : 'Skip for now'}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={stepIndex === 0 || isSubmitting}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-secondary)] transition hover:border-[var(--accent)]/30 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Back"
                >
                  <ArrowLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => void goNext()}
                  disabled={!canGoNext || isSubmitting}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-secondary)] transition hover:border-[var(--accent)]/30 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={stepIndex === steps.length - 1 ? 'Finish setup' : 'Next'}
                >
                  {isSubmitting ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (mode === 'preferences') {
    return createPortal(content, document.body);
  }

  return content;
}
