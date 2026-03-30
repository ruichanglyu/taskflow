import { useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthScreen } from './components/AuthScreen';
import { AppShell } from './components/AppShell';
import { ResetPasswordScreen } from './components/ResetPasswordScreen';
import { supabase } from './lib/supabase';

function isRecoveryLink() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(window.location.search);
  return hashParams.get('type') === 'recovery' || queryParams.get('type') === 'recovery';
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecoveryMode, setIsRecoveryMode] = useState(() => isRecoveryLink());

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

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });

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

    return () => subscription.unsubscribe();
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-app)] text-sm text-[var(--text-muted)]">
        Loading TaskFlow...
      </div>
    );
  }

  if (isRecoveryMode) {
    return <ResetPasswordScreen onBackToSignIn={() => setIsRecoveryMode(false)} />;
  }

  if (!session?.user) {
    return <AuthScreen />;
  }

  return <AppShell user={session.user} />;
}
