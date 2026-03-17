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
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-sm text-gray-400">
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
