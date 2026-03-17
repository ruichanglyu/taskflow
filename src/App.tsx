import { useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { AuthScreen } from './components/AuthScreen';
import { AppShell } from './components/AppShell';
import { supabase } from './lib/supabase';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
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

  if (!session?.user) {
    return <AuthScreen />;
  }

  return <AppShell user={session.user} />;
}
