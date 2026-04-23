import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../utils/cn';

export interface WalkthroughState {
  seen: boolean;
  step: number;
  completed: boolean;
}

const DEFAULT_WALKTHROUGH_STATE: WalkthroughState = {
  seen: false,
  step: 0,
  completed: false,
};

function walkthroughStorageKey(userId: string) {
  return `taskflow_walkthrough:${userId}`;
}

export function loadWalkthroughState(userId: string): WalkthroughState {
  try {
    const raw = window.localStorage.getItem(walkthroughStorageKey(userId));
    if (!raw) return DEFAULT_WALKTHROUGH_STATE;
    const parsed = JSON.parse(raw) as Partial<WalkthroughState> | null;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_WALKTHROUGH_STATE;
    return {
      seen: Boolean(parsed.seen),
      step: typeof parsed.step === 'number' && Number.isFinite(parsed.step) ? parsed.step : 0,
      completed: Boolean(parsed.completed),
    };
  } catch {
    return DEFAULT_WALKTHROUGH_STATE;
  }
}

function saveWalkthroughState(userId: string, state: WalkthroughState) {
  window.localStorage.setItem(walkthroughStorageKey(userId), JSON.stringify(state));
  window.dispatchEvent(new CustomEvent('taskflow:walkthrough-update', { detail: { userId, state } }));
}

function getWalkthroughTarget(selector: string): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  if (candidates.length === 0) return null;

  const visibleCandidates = candidates
    .map(element => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ element, rect }) => {
      const style = window.getComputedStyle(element);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 0 &&
        rect.height > 0
      );
    })
    .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));

  return visibleCandidates[0]?.element ?? candidates[0] ?? null;
}

function useAnchorRect(selector: string | undefined, active: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!active || !selector) {
      setRect(null);
      return;
    }

    let cancelled = false;

    const update = () => {
      const el = getWalkthroughTarget(selector);
      if (!el) {
        setRect(null);
        return;
      }
      const next = el.getBoundingClientRect();
      setRect(next);
    };

    const scrollIntoView = () => {
      const el = getWalkthroughTarget(selector);
      if (!el) return;
      const box = el.getBoundingClientRect();
      const offscreen = box.top < 80 || box.bottom > window.innerHeight - 80;
      if (offscreen) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };

    scrollIntoView();
    const initial = window.setTimeout(() => {
      if (!cancelled) update();
    }, 220);

    update();

    const onResize = () => update();
    const onScroll = () => update();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);

    const interval = window.setInterval(update, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [selector, active]);

  return rect;
}

interface WalkthroughStep {
  title: string;
  description: string;
  helper?: string;
  primaryLabel?: string;
  onPrimaryAction?: () => void;
  secondaryLabel: string;
  targetSelector?: string;
  beforeEnter?: () => void;
  completionPath?: string;
  completionSelector?: string;
}

export interface WalkthroughControllerProps {
  userId: string;
  hasDeadlines: boolean;
  hasPlan: boolean;
  hasReviewReady: boolean;
  onOpenImportDeadlines?: () => void;
  onOpenPlanner?: () => void;
  onOpenAiPrompt?: (prompt: string) => void;
  onOpenStudyReview?: () => void;
  onClosePlanner?: () => void;
  onCloseAiPanel?: () => void;
}

export interface WalkthroughControllerHandle {
  open: () => void;
  restart: () => void;
}

export const WalkthroughController = forwardRef<WalkthroughControllerHandle, WalkthroughControllerProps>(function WalkthroughController({
  userId,
  hasDeadlines,
  hasPlan,
  hasReviewReady,
  onOpenImportDeadlines,
  onOpenPlanner,
  onOpenAiPrompt,
  onOpenStudyReview,
  onClosePlanner,
  onCloseAiPanel,
}, ref) {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<WalkthroughState>(() => loadWalkthroughState(userId));
  const [open, setOpen] = useState(false);
  const dashboardRoute = '/dashboard';

  useEffect(() => {
    setState(loadWalkthroughState(userId));
  }, [userId]);

  const updateState = useCallback((updates: Partial<WalkthroughState>) => {
    setState(current => {
      const next = { ...current, ...updates };
      saveWalkthroughState(userId, next);
      return next;
    });
  }, [userId]);

  const navigateTo = useCallback((to: string) => {
    navigate(to);
  }, [navigate]);

  const resetTransientUi = useCallback(() => {
    onClosePlanner?.();
    onCloseAiPanel?.();
    window.dispatchEvent(new CustomEvent('taskflow:close-deadlines-overlays'));
    window.dispatchEvent(new CustomEvent('taskflow:close-study-review'));
  }, [onCloseAiPanel, onClosePlanner]);

  const steps: WalkthroughStep[] = useMemo(() => ([
    {
      title: 'Welcome to TaskFlow',
      description: 'TaskFlow helps you take messy school obligations and turn them into a realistic plan you can actually follow.',
      helper: 'This quick tour follows the real flow: bring in deadlines, turn them into a plan, see it on your calendar, use AI when you need help, and log quick reviews.',
      secondaryLabel: 'Start tour',
    },
    {
      title: 'This is your dashboard',
      description: 'The dashboard is your home base. It shows your overall workload at a glance and gives you the fastest path back into planning.',
      helper: 'Whenever you feel lost, come back here first.',
      secondaryLabel: 'Next',
      targetSelector: '[data-walkthrough="dashboard-hero"]',
      beforeEnter: () => {
        resetTransientUi();
        navigateTo(dashboardRoute);
      },
    },
    {
      title: 'Head to Deadlines',
      description: 'Everything starts from real deadlines: exams, assignments, labs, quizzes, and projects. Click the highlighted Deadlines tab in the sidebar.',
      helper: 'If your deadlines are clean, the rest of the app works much better.',
      secondaryLabel: 'Next',
      targetSelector: '[data-walkthrough="nav-deadlines"]',
      beforeEnter: () => {
        resetTransientUi();
        navigateTo(dashboardRoute);
      },
      completionPath: '/deadlines',
    },
    {
      title: 'Import a syllabus, screenshot, or CSV',
      description: 'This is the fastest way to get value from TaskFlow. Click the highlighted Import button and bring in a syllabus, a Canvas screenshot, an email, or a CSV.',
      helper: hasDeadlines ? 'You already have deadlines imported here, so this step is basically done.' : 'For most students, this is the first thing to try on a new account.',
      secondaryLabel: 'Next',
      targetSelector: '[data-walkthrough="deadlines-import"]',
      beforeEnter: () => {
        resetTransientUi();
        navigateTo('/deadlines');
      },
      completionSelector: '[data-walkthrough-modal="deadline-import"]',
    },
    {
      title: 'Add a deadline manually when needed',
      description: 'Not everything will come from an import. Use this when a professor mentions a one-off due date in class or you just want to enter something quickly yourself.',
      helper: 'Manual entry is perfect for small changes and surprise deadlines.',
      secondaryLabel: 'Next',
      targetSelector: '[data-walkthrough="deadlines-add"]',
      beforeEnter: () => {
        resetTransientUi();
        navigateTo('/deadlines');
      },
      completionSelector: '[data-walkthrough-modal="deadline-add"]',
    },
    {
      title: 'Come back to the dashboard to plan',
      description: 'Once deadlines are in, come back here. This planning section is where TaskFlow turns upcoming work into a proposed study plan before touching your calendar.',
      helper: 'Think of this as the bridge between “I know what is due” and “I know exactly when I am going to work on it.”',
      secondaryLabel: 'Next',
      targetSelector: '[data-walkthrough="dashboard-planning"]',
      beforeEnter: () => {
        resetTransientUi();
        navigateTo(dashboardRoute);
      },
    },
    {
      title: 'Generate your study blocks',
      description: 'Click the highlighted planning button to read your upcoming deadlines and create a realistic study plan you can review before accepting.',
      helper: hasPlan ? 'You already generated a plan once, which is exactly how this should be used.' : hasDeadlines ? 'Try this after you import one real exam or assignment.' : 'This becomes useful as soon as at least one real deadline exists.',
      secondaryLabel: 'Next',
      targetSelector: '[data-walkthrough="plan"]',
      beforeEnter: () => {
        resetTransientUi();
        navigateTo(dashboardRoute);
      },
      completionSelector: '[data-walkthrough-modal="academic-planner"]',
    },
    {
      title: 'Open the Calendar to see your real schedule',
      description: 'After you accept study blocks, they show up on the Calendar. Click the highlighted Calendar tab to see where your plan becomes real and where you adjust timing if life changes.',
      helper: 'Calendar is the execution layer. The plan starts from deadlines, then lands here.',
      secondaryLabel: 'Next',
      targetSelector: '[data-walkthrough="nav-calendar"]',
      beforeEnter: () => {
        resetTransientUi();
        navigateTo(dashboardRoute);
      },
    },
    {
      title: 'Use AI when you want help making decisions',
      description: 'Click the highlighted AI button when you want help with an actual decision: what to prioritize, how to fit studying into your week, or how to turn deadlines into prep tasks.',
      helper: 'A good starter prompt is: “Look at my deadlines and calendar and tell me what I should focus on first.”',
      secondaryLabel: 'Next',
      targetSelector: '[data-walkthrough="ai"]',
      beforeEnter: () => {
        resetTransientUi();
        navigateTo(dashboardRoute);
      },
      completionSelector: '[data-walkthrough-panel="ai"]',
    },
    {
      title: 'Teach the app what actually happened',
      description: 'After a study block ends, log whether you did it, skipped it, or only partially finished it. That feedback keeps future plans realistic.',
      helper: hasReviewReady ? 'You already have blocks waiting for review, so this is live for your account now.' : 'This step becomes important after you’ve used the planner for a few days.',
      secondaryLabel: 'Next',
      targetSelector: hasReviewReady ? '[data-walkthrough="review"]' : undefined,
      beforeEnter: () => {
        resetTransientUi();
        navigateTo(dashboardRoute);
      },
      completionSelector: hasReviewReady ? '[data-walkthrough-modal="study-review"]' : undefined,
    },
    {
      title: 'Tasks keeps smaller to-dos organized',
      description: 'Click the highlighted Tasks tab to see where the smaller pieces of work live: reading, problem sets, prep tasks, or quick admin items.',
      helper: 'Tasks supports the academic flow, but it should not replace your real deadline list.',
      secondaryLabel: 'Next',
      targetSelector: '[data-walkthrough="nav-tasks"]',
      beforeEnter: () => {
        resetTransientUi();
        navigateTo(dashboardRoute);
      },
    },
    {
      title: 'Courses keeps everything grouped by class',
      description: 'Click the highlighted Courses tab to see the class-by-class view. It keeps your tasks and deadlines from blurring together.',
      helper: 'If you take several classes, this is where the app starts feeling much easier to scan.',
      secondaryLabel: 'Next',
      targetSelector: '[data-walkthrough="nav-projects"]',
      beforeEnter: () => {
        resetTransientUi();
        navigateTo(dashboardRoute);
      },
    },
    {
      title: 'Timeline helps you zoom out',
      description: 'Click the highlighted Timeline tab for the long-range view. Use it when you want to understand how assignments and exams stack up over the next days or weeks.',
      helper: 'This is especially useful around midterms and finals when several deadlines bunch together.',
      secondaryLabel: 'Next',
      targetSelector: '[data-walkthrough="nav-timeline"]',
      beforeEnter: () => {
        resetTransientUi();
        navigateTo(dashboardRoute);
      },
    },
    {
      title: 'Gym is optional',
      description: 'Click the highlighted Gym tab if you want it, but it is not part of the core academic loop.',
      helper: 'The main TaskFlow workflow is still deadlines → plan → calendar → AI help → review.',
      secondaryLabel: 'Finish',
      targetSelector: '[data-walkthrough="nav-gym"]',
      beforeEnter: () => {
        resetTransientUi();
        navigateTo(dashboardRoute);
      },
    },
  ]), [dashboardRoute, hasDeadlines, hasPlan, hasReviewReady, navigateTo, onOpenAiPrompt, onOpenImportDeadlines, onOpenPlanner, onOpenStudyReview, resetTransientUi]);

  const stepIndex = Math.min(state.step, steps.length - 1);
  const currentStep = steps[stepIndex];

  useEffect(() => {
    if (!open) return;
    currentStep.beforeEnter?.();
    // Intentionally only keyed by open + step index so navigation setup
    // runs when the tour step changes, not on unrelated rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stepIndex]);

  useEffect(() => {
    if (!open || !currentStep.completionPath) return;
    if (location.pathname !== currentStep.completionPath) return;
    if (state.step >= steps.length - 1) return;

    const timer = window.setTimeout(() => {
      setState(current => {
        if (current.step !== stepIndex) return current;
        const next = { ...current, step: Math.min(steps.length - 1, current.step + 1) };
        saveWalkthroughState(userId, next);
        return next;
      });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [currentStep.completionPath, location.pathname, open, state.step, stepIndex, steps.length, userId]);

  useEffect(() => {
    if (!open || !currentStep.completionSelector) return;
    if (!getWalkthroughTarget(currentStep.completionSelector)) return;
    if (state.step >= steps.length - 1) return;

    const timer = window.setTimeout(() => {
      setState(current => {
        if (current.step !== stepIndex) return current;
        const next = { ...current, step: Math.min(steps.length - 1, current.step + 1) };
        saveWalkthroughState(userId, next);
        return next;
      });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [currentStep.completionSelector, open, state.step, stepIndex, steps.length, userId]);

  useEffect(() => {
    if (state.seen || state.completed) return;
    const timer = window.setTimeout(() => {
      setOpen(true);
      updateState({ seen: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [state.completed, state.seen, updateState]);

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      if (!state.seen) updateState({ seen: true });
    },
    restart: () => {
      const reset: WalkthroughState = { seen: true, step: 0, completed: false };
      setState(reset);
      saveWalkthroughState(userId, reset);
      setOpen(true);
    },
  }), [state.seen, updateState, userId]);

  const handleBack = () => {
    updateState({ step: Math.max(0, state.step - 1) });
  };

  const handleNext = () => {
    if (state.step >= steps.length - 1) {
      updateState({ completed: true, step: steps.length - 1 });
      setOpen(false);
      return;
    }
    updateState({ step: Math.min(steps.length - 1, state.step + 1) });
  };

  const handlePrimary = () => {
    currentStep.onPrimaryAction?.();
  };

  return (
    <GuidedWalkthroughModal
      open={open}
      step={stepIndex}
      totalSteps={steps.length}
      title={currentStep.title}
      description={currentStep.description}
      helper={currentStep.helper}
      primaryLabel={currentStep.primaryLabel}
      secondaryLabel={currentStep.secondaryLabel}
      canGoBack={state.step > 0}
      targetSelector={currentStep.targetSelector}
      onClose={() => setOpen(false)}
      onBack={handleBack}
      onNext={handleNext}
      onPrimaryAction={currentStep.onPrimaryAction ? handlePrimary : undefined}
    />
  );
});

function GuidedWalkthroughModal({
  open,
  step,
  totalSteps,
  title,
  description,
  helper,
  primaryLabel,
  secondaryLabel,
  canGoBack,
  targetSelector,
  onClose,
  onBack,
  onNext,
  onPrimaryAction,
}: {
  open: boolean;
  step: number;
  totalSteps: number;
  title: string;
  description: string;
  helper?: string;
  primaryLabel?: string;
  secondaryLabel: string;
  canGoBack: boolean;
  targetSelector?: string;
  onClose: () => void;
  onBack: () => void;
  onNext: () => void;
  onPrimaryAction?: () => void;
}) {
  const anchorRect = useAnchorRect(targetSelector, open);
  const previousStepRef = useRef(step);
  const [contentMotion, setContentMotion] = useState<'idle' | 'forward' | 'backward'>('idle');

  useEffect(() => {
    if (!open) return;
    if (step === previousStepRef.current) return;

    const direction = step > previousStepRef.current ? 'forward' : 'backward';
    previousStepRef.current = step;
    setContentMotion(direction);

    const settleTimer = window.setTimeout(() => {
      setContentMotion('idle');
    }, 180);

    return () => window.clearTimeout(settleTimer);
  }, [open, step]);

  if (!open) return null;

  const padding = 10;
  const hasAnchor = anchorRect !== null;
  const spot = hasAnchor
    ? {
        top: anchorRect.top - padding,
        left: anchorRect.left - padding,
        width: anchorRect.width + padding * 2,
        height: anchorRect.height + padding * 2,
      }
    : null;

  const popoverWidth = 340;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const popoverStyle: React.CSSProperties = (() => {
    if (!spot) {
      return {
        top: 96,
        right: 24,
      };
    }
    const spaceBelow = viewportH - (spot.top + spot.height);
    const spaceAbove = spot.top;
    const placeBelow = spaceBelow > 220 || spaceBelow >= spaceAbove;
    const top = placeBelow
      ? Math.min(viewportH - 24, spot.top + spot.height + 16)
      : Math.max(24, spot.top - 16);
    const centerLeft = spot.left + spot.width / 2 - popoverWidth / 2;
    const left = Math.max(16, Math.min(viewportW - popoverWidth - 16, centerLeft));
    return placeBelow
      ? { top, left }
      : { top, left, transform: 'translateY(-100%)' };
  })();

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]">
      {spot && (
        <div
          className="pointer-events-none absolute rounded-[12px] ring-2 ring-[var(--accent)] shadow-[0_0_0_4px_rgba(56,189,248,0.18)] transition-all duration-200"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
          }}
        />
      )}

      <div
        className="pointer-events-auto absolute w-[340px] overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur-sm transition-[top,left,transform] duration-200 ease-out"
        style={popoverStyle}
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 pt-4 pb-3">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalSteps }).map((_, index) => (
              <div
                key={index}
                className={cn(
                  'h-1 rounded-full transition-all',
                  index < step
                    ? 'w-4 bg-[var(--accent)]'
                    : index === step
                      ? 'w-6 bg-[var(--accent)]'
                      : 'w-4 bg-[var(--border-soft)]',
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-faint)]">
              Tour
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1 text-[var(--text-faint)] transition hover:bg-white/5 hover:text-[var(--text-primary)]"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div
          className={cn(
            'px-5 pt-4 pb-4 transition-all duration-200 ease-out',
            contentMotion === 'forward' && 'translate-x-1.5 opacity-70',
            contentMotion === 'backward' && '-translate-x-1.5 opacity-70',
          )}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            {step + 1} / {totalSteps}
          </p>
          <h3 className="mt-1 text-[16px] font-semibold leading-snug text-[var(--text-primary)]">{title}</h3>
          <p className="mt-2 text-[13px] leading-[1.55] text-[var(--text-secondary)]">{description}</p>
          {helper && (
            <p className="mt-3 border-l-2 border-[var(--accent)]/40 pl-2.5 text-[12px] leading-[1.55] text-[var(--text-muted)]">
              {helper}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border-soft)] bg-[var(--surface)]/50 px-5 py-3">
          <button
            type="button"
            onClick={onBack}
            disabled={!canGoBack}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-[var(--text-secondary)] transition hover:bg-white/5 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft size={13} />
            Back
          </button>
          <div className="flex items-center gap-2">
            {primaryLabel && onPrimaryAction && (
              <button
                type="button"
                onClick={onPrimaryAction}
                className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-2.5 py-1 text-[12px] font-medium text-[var(--text-primary)] transition hover:border-[var(--accent)]/50 hover:bg-[var(--accent-soft)]/40"
              >
                {primaryLabel}
              </button>
            )}
            <button
              type="button"
              onClick={onNext}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-strong)] px-3 py-1 text-[12px] font-medium text-[var(--accent-contrast)] transition hover:brightness-110"
            >
              {secondaryLabel}
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
