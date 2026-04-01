import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

export function AppBootScreen() {
  const [progress, setProgress] = useState(12);

  useEffect(() => {
    let frame = 0;
    const tick = window.setInterval(() => {
      frame += 1;
      setProgress(current => {
        if (current >= 96) return current;

        // Fast lift at the start, then slower creep as we approach ready.
        if (current < 55) return Math.min(55, current + 7.5);
        if (current < 78) return Math.min(78, current + 3.2);
        if (current < 90) return Math.min(90, current + 1.4);

        // Keep moving near the end so it never feels frozen.
        const tailStep = frame % 3 === 0 ? 0.45 : 0.25;
        return Math.min(96, current + tailStep);
      });
    }, 60);

    return () => window.clearInterval(tick);
  }, []);

  return (
    <div
      className="flex min-h-screen items-center justify-center px-6 text-[var(--text-primary)]"
      style={{ background: 'var(--bg-app)' }}
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-muted)] text-[var(--accent)]">
          <Sparkles size={24} />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Getting ready</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
          Setting up your workspace and preparing the app for you.
        </p>
        <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
          <div
            className="h-full rounded-full bg-[var(--accent-strong)] transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
