import { FormEvent, useState } from 'react';
import { CheckCircle2, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';

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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_30%),linear-gradient(180deg,_#050816_0%,_#0f172a_100%)] text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 px-6 py-12 lg:flex-row lg:items-center lg:gap-16">
        <section className="max-w-xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-emerald-200">
            <ShieldCheck size={14} />
            Secure Reset
          </div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Set a new password and get back into your workspace.
          </h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-slate-300">
            This screen appears only from a valid Supabase recovery link. Once you save the new password, your account is updated immediately.
          </p>
        </section>

        <section className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold">Reset password</h2>
            <p className="mt-2 text-sm text-slate-400">Choose a new password for your TaskFlow account.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                <KeyRound size={14} />
                New password
              </span>
              <input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                minLength={6}
                required
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                Confirm password
              </span>
              <input
                type="password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                placeholder="Repeat your new password"
                autoComplete="new-password"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
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
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting && <LoaderCircle size={16} className="animate-spin" />}
              Update password
            </button>
          </form>

          <button
            type="button"
            onClick={onBackToSignIn}
            className="mt-5 text-sm font-medium text-emerald-300 transition hover:text-emerald-200"
          >
            Back to sign in
          </button>
        </section>
      </div>
    </div>
  );
}
