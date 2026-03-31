import { useEffect, useState } from 'react';
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

  return <AppShell user={session.user} />;
}
