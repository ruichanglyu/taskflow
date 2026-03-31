import { FormEvent, useState } from 'react';
import { LoaderCircle, LockKeyhole, Mail, Sparkles } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { ThemeSwitcher } from './ThemeSwitcher';

type AuthMode = 'sign-in' | 'sign-up';

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.26-.96 2.33-2.04 3.04l3.3 2.56c1.92-1.77 3.03-4.38 3.03-7.5 0-.7-.06-1.38-.18-2.03H12Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.3-2.56c-.92.62-2.1.99-3.32.99-2.55 0-4.72-1.72-5.49-4.03l-3.42 2.64A9.99 9.99 0 0 0 12 22Z"
      />
      <path
        fill="#4A90E2"
        d="M6.51 13.97A5.99 5.99 0 0 1 6.2 12c0-.68.12-1.34.31-1.97L3.09 7.4A9.99 9.99 0 0 0 2 12c0 1.61.38 3.14 1.09 4.6l3.42-2.63Z"
      />
      <path
        fill="#FBBC05"
        d="M12 5.98c1.47 0 2.78.5 3.81 1.49l2.86-2.86C16.95 3 14.69 2 12 2a9.99 9.99 0 0 0-8.91 5.4l3.42 2.63C7.28 7.7 9.45 5.98 12 5.98Z"
      />
    </svg>
  );
}

export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  const title = mode === 'sign-in' ? 'Your AI academic workspace.' : 'Get started with your AI academic workspace.';
  const subtitle = mode === 'sign-in'
    ? 'Sign in to your account'
    : 'Create your account';

  const handleGoogleAuth = async () => {
    if (!supabase) {
      setError('Supabase is not configured yet. Add your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }

    setIsGoogleSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account',
          },
        },
      });

      if (oauthError) throw oauthError;
    } catch (err) {
      setIsGoogleSubmitting(false);
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  };

  const handlePasswordReset = async () => {
    if (!supabase) {
      setError('Supabase is not configured yet. Add your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }

    if (!email.trim()) {
      setError('Enter your email address first so we know where to send the reset link.');
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
            emailRedirectTo: window.location.origin,
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
      <div className="absolute right-5 top-5 z-10">
        <ThemeSwitcher />
      </div>

      <div className="flex min-h-screen items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <div className="rounded-[28px] border border-[var(--border-soft)] bg-[var(--surface-elevated)] p-8 shadow-sm">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] text-[var(--accent)]">
              <Sparkles size={16} />
            </div>

            <div className="mt-6 text-center">
              <h1 className="text-[2rem] font-semibold tracking-tight">{title}</h1>
              <p className="mt-1 text-lg text-[var(--text-muted)]">{subtitle}</p>
            </div>

            {!isSupabaseConfigured && (
              <div className="mt-6 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-600 dark:text-amber-200">
                Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to your local `.env` and Vercel project before authentication will work.
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {mode === 'sign-up' && (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">Full name</span>
                  <input
                    type="text"
                    value={fullName}
                    onChange={event => setFullName(event.target.value)}
                    placeholder="First Name Last Name"
                    className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  />
                </label>
              )}

              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
                  <Mail size={14} />
                  Email
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  placeholder="name@work-email.com"
                  autoComplete="email"
                  className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
                  <LockKeyhole size={14} />
                  Password
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                  className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  minLength={6}
                  required
                />
              </label>

              {error && (
                <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-600 dark:text-rose-200">
                  {error}
                </div>
              )}

              {message && (
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-600 dark:text-emerald-200">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || isResettingPassword || isGoogleSubmitting || !isSupabaseConfigured}
                className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-[var(--accent-contrast)] transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent-strong)' }}
              >
                {isSubmitting && <LoaderCircle size={16} className="animate-spin" />}
                {mode === 'sign-in' ? 'Continue' : 'Create account'}
              </button>
            </form>

            <div className="my-6 flex items-center gap-4">
              <div className="h-px flex-1 bg-[var(--border-soft)]" />
              <span className="text-xs uppercase tracking-[0.18em] text-[var(--text-faint)]">or continue with</span>
              <div className="h-px flex-1 bg-[var(--border-soft)]" />
            </div>

            <button
              type="button"
              onClick={() => void handleGoogleAuth()}
              disabled={isSubmitting || isResettingPassword || isGoogleSubmitting || !isSupabaseConfigured}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent)]/35 hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGoogleSubmitting ? <LoaderCircle size={16} className="animate-spin" /> : <GoogleMark />}
              Continue with Google
            </button>

            <div className="mt-6 text-center text-sm text-[var(--text-muted)]">
              {mode === 'sign-in' ? 'New user?' : 'Already have an account?'}{' '}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
                  setError(null);
                  setMessage(null);
                }}
                className="font-medium text-[var(--text-primary)] underline-offset-4 transition hover:underline"
              >
                {mode === 'sign-in' ? 'Sign up' : 'Log in'}
              </button>
            </div>

            {mode === 'sign-in' && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => void handlePasswordReset()}
                  disabled={isSubmitting || isResettingPassword || isGoogleSubmitting || !isSupabaseConfigured}
                  className="text-sm text-[var(--text-muted)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isResettingPassword ? 'Sending reset email...' : 'Forgot password?'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
