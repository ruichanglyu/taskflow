import { FormEvent, useState } from 'react';
import { CheckCircle2, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ThemeSwitcher } from './ThemeSwitcher';

interface ResetPasswordScreenProps {
  onBackToSignIn: () => void;
}

export function ResetPasswordScreen({ onBackToSignIn }: ResetPasswordScreenProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      setMessage('Password updated. You can continue into TaskFlow with your new password.');
      setPassword('');
      setConfirmPassword('');
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen text-[var(--text-primary)]" style={{ background: 'var(--bg-auth)' }}>
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 px-6 py-12 lg:flex-row lg:items-center lg:gap-16">
        <section className="max-w-xl">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-[var(--accent)]">
              <ShieldCheck size={14} />
              Secure Reset
            </div>
            <ThemeSwitcher />
          </div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Set a new password and get back into your workspace.
          </h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-[var(--text-secondary)]">
            This screen appears only from a valid Supabase recovery link. Once you save the new password, your account is updated immediately.
          </p>
        </section>

        <section className="w-full max-w-md rounded-3xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-6 shadow-2xl backdrop-blur-xl" style={{ boxShadow: '0 24px 80px var(--shadow-color)' }}>
          <div className="mb-6">
            <h2 className="text-2xl font-semibold">Reset password</h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">Choose a new password for your TaskFlow account.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
                <KeyRound size={14} />
                New password
              </span>
              <input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                minLength={6}
                required
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
                Confirm password
              </span>
              <input
                type="password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                placeholder="Repeat your new password"
                autoComplete="new-password"
                className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                minLength={6}
                required
              />
            </label>

            {error && (
              <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">
                {error}
              </div>
            )}

            {message && (
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                  <span>{message}</span>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-[var(--accent-contrast)] transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent-strong)' }}
            >
              {isSubmitting && <LoaderCircle size={16} className="animate-spin" />}
              Update password
            </button>
          </form>

          <button
            type="button"
            onClick={onBackToSignIn}
            className="mt-5 text-sm font-medium text-[var(--accent)] transition hover:opacity-80"
          >
            Back to sign in
          </button>
        </section>
      </div>
    </div>
  );
}
