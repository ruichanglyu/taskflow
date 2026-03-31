import { Sparkles } from 'lucide-react';

export function AppBootScreen() {
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
          <div className="h-full w-2/3 animate-pulse rounded-full bg-[var(--accent-strong)]" />
        </div>
      </div>
    </div>
  );
}
