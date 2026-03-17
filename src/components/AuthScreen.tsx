import { FormEvent, useMemo, useState } from 'react';
import { LoaderCircle, LockKeyhole, Mail, Rocket } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

type AuthMode = 'sign-in' | 'sign-up';

export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.18),_transparent_30%),linear-gradient(180deg,_#050816_0%,_#0f172a_100%)] text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 px-6 py-12 lg:flex-row lg:items-center lg:gap-16">
        <section className="max-w-xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-indigo-200">
            <Rocket size={14} />
            TaskFlow
          </div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Task management with real accounts, not just one browser.
          </h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-slate-300">
            This app now uses Supabase Authentication so each person can keep a separate workspace and stay signed in across devices.
          </p>
          <div className="mt-8 grid gap-3 text-sm text-slate-300">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              Email and password authentication is handled by Supabase.
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              Existing task UI remains intact while data still lives locally per signed-in user.
            </div>
          </div>
        </section>

        <section className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-slate-400">{subtitle}</p>
          </div>

          {!isSupabaseConfigured && (
            <div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
              Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to your Vercel and local `.env` before authentication will work.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'sign-up' && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                  Full name
                </span>
                <input
                  type="text"
                  value={fullName}
                  onChange={event => setFullName(event.target.value)}
                  placeholder="Jane Doe"
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-400/60"
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                <Mail size={14} />
                Email
              </span>
              <input
                type="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-400/60"
                required
              />
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                <LockKeyhole size={14} />
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="At least 6 characters"
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-400/60"
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
              disabled={isSubmitting || !isSupabaseConfigured}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting && <LoaderCircle size={16} className="animate-spin" />}
              {mode === 'sign-in' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className="mt-5 text-sm text-slate-400">
            {mode === 'sign-in' ? 'Need an account?' : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
                setError(null);
                setMessage(null);
              }}
              className="font-medium text-indigo-300 transition hover:text-indigo-200"
            >
              {mode === 'sign-in' ? 'Create one' : 'Sign in instead'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
