import { useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { AuthScreen } from './components/AuthScreen';
import { AppShell } from './components/AppShell';
import { ResetPasswordScreen } from './components/ResetPasswordScreen';
import { supabase } from './lib/supabase';

function isRecoveryLink() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(window.location.search);
  return hashParams.get('type') === 'recovery' || queryParams.get('type') === 'recovery';
}

// Handle Canvas OAuth callback: /canvas/callback?code=...&state=...
// Rewrite to root with canvas_code/canvas_state params so the SPA hook picks them up.
function handleCanvasCallback() {
  if (window.location.pathname === '/canvas/callback') {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (code && state) {
      const newParams = new URLSearchParams({ canvas_code: code, canvas_state: state });
      window.history.replaceState({}, '', `/calendar?${newParams.toString()}`);
    } else {
      window.history.replaceState({}, '', '/calendar');
    }
  }
}

// Run immediately on load
handleCanvasCallback();

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecoveryMode, setIsRecoveryMode] = useState(() => isRecoveryLink());

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
