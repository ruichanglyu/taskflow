import { Component, type ErrorInfo, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppBootScreen } from './components/AppBootScreen';
import { AuthScreen } from './components/AuthScreen';
import { AuthOnboarding } from './components/AuthOnboarding';
import { AppShell } from './components/AppShell';
import { ResetPasswordScreen } from './components/ResetPasswordScreen';
import { supabase } from './lib/supabase';

function isRecoveryLink() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(window.location.search);
  return hashParams.get('type') === 'recovery' || queryParams.get('type') === 'recovery';
}

function hasCompletedOnboarding(user: User | null | undefined) {
  return Boolean(user?.user_metadata?.onboarding_completed);
}

class AppShellErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: string; stack: string }> {
  state = { hasError: false, error: '', stack: '' };

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      error: error.message || 'Unknown render error',
      stack: error.stack ?? '',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppShellErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--app-bg)] px-6 py-10 text-[var(--text-primary)]">
          <div className="mx-auto max-w-3xl rounded-2xl border border-rose-500/20 bg-[var(--surface)] p-6 shadow-sm">
            <h1 className="text-2xl font-semibold">Something went wrong in the signed-in app</h1>
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              We hit a runtime error after loading your session. This is much better than a blank screen because now we can see the real problem.
            </p>
            <div className="mt-5 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">Error</div>
              <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-rose-400">{this.state.error}</pre>
              {this.state.stack && (
                <>
                  <div className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">Stack</div>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-[var(--text-muted)]">
                    {this.state.stack}
                  </pre>
                </>
              )}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)]"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: '', stack: '' })}
                className="rounded-lg border border-[var(--border-soft)] px-4 py-2 text-sm font-medium text-[var(--text-primary)]"
              >
                Try rendering again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecoveryMode, setIsRecoveryMode] = useState(() => isRecoveryLink());
  const [isEnteringApp, setIsEnteringApp] = useState(false);

  useEffect(() => {
    if (location.pathname !== '/canvas/callback') return;

    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');

    if (code && state) {
      const newParams = new URLSearchParams({ canvas_code: code, canvas_state: state });
      navigate(`/calendar?${newParams.toString()}`, { replace: true });
      return;
    }

    navigate('/calendar', { replace: true });
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadVerifiedSession = async () => {
      const { data } = await supabase.auth.getSession();
      const cachedSession = data.session;

      if (!cachedSession) {
        if (!cancelled) {
          setSession(null);
          setIsLoading(false);
        }
        return;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (!userError && userData.user) {
        if (!cancelled) {
          setSession(cachedSession);
          setIsLoading(false);
        }
        return;
      }

      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && refreshed.session) {
        if (!cancelled) {
          setSession(refreshed.session);
          setIsLoading(false);
        }
        return;
      }

      await supabase.auth.signOut();
      if (!cancelled) {
        setSession(null);
        setIsLoading(false);
      }
    };

    void loadVerifiedSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoveryMode(true);
      }
      if (event === 'SIGNED_IN' && !isRecoveryLink()) {
        setIsRecoveryMode(false);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user || isRecoveryMode || !hasCompletedOnboarding(session.user)) {
      setIsEnteringApp(false);
      return;
    }

    setIsEnteringApp(true);
    const timer = window.setTimeout(() => {
      setIsEnteringApp(false);
    }, 1100);

    return () => window.clearTimeout(timer);
  }, [isRecoveryMode, session?.user?.id, session?.user?.user_metadata?.onboarding_completed]);

  const refreshSession = async () => {
    if (!supabase) return;
    await supabase.auth.refreshSession();
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
  };

  if (isLoading) {
    return <AppBootScreen />;
  }

  if (isRecoveryMode) {
    return <ResetPasswordScreen onBackToSignIn={() => setIsRecoveryMode(false)} />;
  }

  if (!session?.user) {
    return <AuthScreen />;
  }

  if (!hasCompletedOnboarding(session.user)) {
    return <AuthOnboarding user={session.user} onComplete={refreshSession} />;
  }

  if (isEnteringApp) {
    return <AppBootScreen />;
  }

  return (
    <AppShellErrorBoundary>
      <AppShell user={session.user} />
    </AppShellErrorBoundary>
  );
}
