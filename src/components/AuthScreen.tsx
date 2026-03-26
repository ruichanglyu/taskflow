import { FormEvent, useMemo, useState } from 'react';
import { LoaderCircle, LockKeyhole, Mail, Rocket } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { ThemeSwitcher } from './ThemeSwitcher';

type AuthMode = 'sign-in' | 'sign-up';

export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const title = useMemo(
    () => (mode === 'sign-in' ? 'Sign in to TaskFlow' : 'Create your TaskFlow account'),
    [mode]
  );

  const subtitle = useMemo(
    () => (
      mode === 'sign-in'
        ? 'Use your email and password to access your workspace.'
        : 'Create an account so your workspace can move beyond a single browser.'
    ),
    [mode]
  );

  const handlePasswordReset = async () => {
    if (!supabase) {
      setError('Supabase is not configured yet. Add your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }

    if (!email.trim()) {
      setError('Enter your email address first so TaskFlow knows where to send the reset link.');
      return;
    }

    setIsResettingPassword(true);
    setError(null);
    setMessage(null);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });

      if (resetError) throw resetError;

      setMessage('Password reset email sent. Open the link from your inbox to choose a new password.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send password reset email.');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!supabase) {
      setError('Supabase is not configured yet. Add your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === 'sign-up') {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName.trim(),
            },
          },
        });

        if (signUpError) throw signUpError;

        setMessage('Account created. Check your inbox if email confirmation is enabled in Supabase.');
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) throw signInError;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden text-[var(--text-primary)]" style={{ background: 'var(--bg-auth)' }}>
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 px-6 py-12 lg:flex-row lg:items-center lg:gap-16">
        <section className="w-full max-w-xl">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-[var(--accent)]">
              <Rocket size={14} />
              TaskFlow
            </div>
            <ThemeSwitcher />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
            Task management with real accounts, not just one browser.
          </h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-[var(--text-secondary)]">
            This app now uses Supabase Authentication so each person can keep a separate workspace and stay signed in across devices.
          </p>
          <div className="mt-8 grid gap-3 text-sm text-[var(--text-secondary)]">
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
              Email and password authentication is handled by Supabase.
            </div>
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
              Existing task UI remains intact while data still lives locally per signed-in user.
            </div>
          </div>
        </section>

        <section className="w-full max-w-md rounded-3xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-6 shadow-2xl backdrop-blur-xl" style={{ boxShadow: '0 24px 80px var(--shadow-color)' }}>
          <div className="mb-6">
            <h2 className="text-2xl font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{subtitle}</p>
          </div>

          {!isSupabaseConfigured && (
            <div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
              Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to your Vercel and local `.env` before authentication will work.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'sign-up' && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
                  Full name
                </span>
                <input
                  type="text"
                  value={fullName}
                  onChange={event => setFullName(event.target.value)}
                  placeholder="Jane Doe"
                  className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
                <Mail size={14} />
                Email
              </span>
              <input
                type="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                required
              />
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
                <LockKeyhole size={14} />
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="At least 6 characters"
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
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
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || isResettingPassword || !isSupabaseConfigured}
              className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-[var(--accent-contrast)] transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent-strong)' }}
            >
              {isSubmitting && <LoaderCircle size={16} className="animate-spin" />}
              {mode === 'sign-in' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          {mode === 'sign-in' && (
            <button
              type="button"
              onClick={() => void handlePasswordReset()}
              disabled={isSubmitting || isResettingPassword || !isSupabaseConfigured}
              className="mt-4 text-sm font-medium text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isResettingPassword ? 'Sending reset email...' : 'Forgot password?'}
            </button>
          )}

          <div className="mt-5 text-sm text-[var(--text-muted)]">
            {mode === 'sign-in' ? 'Need an account?' : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
                setError(null);
                setMessage(null);
              }}
              className="font-medium text-[var(--accent)] transition hover:opacity-80"
            >
              {mode === 'sign-in' ? 'Create one' : 'Sign in instead'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
