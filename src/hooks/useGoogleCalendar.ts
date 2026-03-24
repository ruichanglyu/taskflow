import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  fetchGoogleCalendarEvents,
  fetchGoogleCalendars,
  GOOGLE_CALENDAR_SCOPE,
  GoogleCalendarEvent,
  GoogleCalendarListItem,
  googleClientId,
  isGoogleCalendarConfigured,
  loadGoogleIdentityScript,
  NewGoogleCalendarEvent,
} from '../lib/googleCalendar';

const STORAGE_KEY_PREFIX = 'taskflow_google_calendar';

function getStorageKey(userId: string, suffix: string) {
  return `${STORAGE_KEY_PREFIX}:${userId}:${suffix}`;
}

export function useGoogleCalendar(userId: string) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('');
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calendarStorageKey = useMemo(() => getStorageKey(userId, 'selected-calendar'), [userId]);
  const tokenStorageKey = useMemo(() => getStorageKey(userId, 'access-token'), [userId]);
  const tokenExpiryStorageKey = useMemo(() => getStorageKey(userId, 'access-token-expiry'), [userId]);
  const connectedStorageKey = useMemo(() => getStorageKey(userId, 'connected'), [userId]);

  useEffect(() => {
    const storedCalendarId = localStorage.getItem(calendarStorageKey);
    if (storedCalendarId) {
      setSelectedCalendarId(storedCalendarId);
    }
  }, [calendarStorageKey]);

  useEffect(() => {
    const storedToken = localStorage.getItem(tokenStorageKey);
    const storedExpiry = localStorage.getItem(tokenExpiryStorageKey);
    if (!storedToken || !storedExpiry) {
      return;
    }

    const expiresAt = Number(storedExpiry);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      localStorage.removeItem(tokenStorageKey);
      localStorage.removeItem(tokenExpiryStorageKey);
      return;
    }

    setAccessToken(storedToken);
  }, [tokenExpiryStorageKey, tokenStorageKey]);

  useEffect(() => {
    if (selectedCalendarId) {
      localStorage.setItem(calendarStorageKey, selectedCalendarId);
    }
  }, [calendarStorageKey, selectedCalendarId]);

  useEffect(() => {
    if (accessToken) {
      localStorage.setItem(tokenStorageKey, accessToken);
      localStorage.setItem(connectedStorageKey, 'true');
    } else {
      localStorage.removeItem(tokenStorageKey);
    }
  }, [accessToken, connectedStorageKey, tokenStorageKey]);

  const loadCalendarData = useCallback(async (token: string, nextCalendarId?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const googleCalendars = await fetchGoogleCalendars(token);
      setCalendars(googleCalendars);

      const fallbackCalendarId =
        nextCalendarId ||
        selectedCalendarId ||
        googleCalendars.find(calendar => calendar.primary)?.id ||
        googleCalendars[0]?.id ||
        '';

      setSelectedCalendarId(fallbackCalendarId);

      if (!fallbackCalendarId) {
        setEvents([]);
        return;
      }

      const googleEvents = await fetchGoogleCalendarEvents(token, fallbackCalendarId);
      setEvents(googleEvents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Google Calendar.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedCalendarId]);

  const requestAccessToken = useCallback(async (prompt: '' | 'consent', silent = false) => {
    if (!isGoogleCalendarConfigured || !googleClientId) {
      throw new Error('Google Calendar is not configured yet. Add VITE_GOOGLE_CLIENT_ID first.');
    }

    await loadGoogleIdentityScript();

    return new Promise<string>((resolve, reject) => {
      const tokenClient = window.google?.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: GOOGLE_CALENDAR_SCOPE,
        callback: response => {
          if (response.error || !response.access_token) {
            reject(new Error(response.error || 'Google sign-in failed.'));
            return;
          }

          const expiresIn = response.expires_in ?? 3600;
          const expiresAt = Date.now() + expiresIn * 1000;
          localStorage.setItem(tokenExpiryStorageKey, String(expiresAt));
          setAccessToken(response.access_token);
          resolve(response.access_token);
        },
        error_callback: error => {
          reject(new Error(error.type || 'Google sign-in failed.'));
        },
      });

      tokenClient?.requestAccessToken({ prompt });
    }).catch(err => {
      if (silent) {
        return Promise.reject(err);
      }
      throw err;
    });
  }, [tokenExpiryStorageKey]);

  useEffect(() => {
    if (!accessToken) return;
    void loadCalendarData(accessToken);
  }, [accessToken, loadCalendarData]);

  useEffect(() => {
    const shouldReconnect = localStorage.getItem(connectedStorageKey) === 'true';
    if (!shouldReconnect || accessToken || !isGoogleCalendarConfigured) return;

    let cancelled = false;

    void requestAccessToken('', true)
      .then(token => {
        if (cancelled) return;
        return loadCalendarData(token);
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem(tokenStorageKey);
        localStorage.removeItem(tokenExpiryStorageKey);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, connectedStorageKey, isGoogleCalendarConfigured, loadCalendarData, requestAccessToken, tokenExpiryStorageKey, tokenStorageKey]);

  const connect = useCallback(async () => {
    if (!isGoogleCalendarConfigured || !googleClientId) {
      setError('Google Calendar is not configured yet. Add VITE_GOOGLE_CLIENT_ID first.');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const token = await requestAccessToken('consent');
      await loadCalendarData(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Google Calendar.');
    } finally {
      setIsConnecting(false);
    }
  }, [loadCalendarData, requestAccessToken]);

  const disconnect = useCallback(() => {
    if (accessToken && window.google?.accounts.oauth2) {
      window.google.accounts.oauth2.revoke(accessToken, () => undefined);
    }

    setAccessToken(null);
    setCalendars([]);
    setEvents([]);
    setSelectedCalendarId('');
    localStorage.removeItem(calendarStorageKey);
    localStorage.removeItem(tokenStorageKey);
    localStorage.removeItem(tokenExpiryStorageKey);
    localStorage.removeItem(connectedStorageKey);
    setError(null);
  }, [accessToken, calendarStorageKey, connectedStorageKey, tokenExpiryStorageKey, tokenStorageKey]);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    await loadCalendarData(accessToken);
  }, [accessToken, loadCalendarData]);

  const chooseCalendar = useCallback(async (calendarId: string) => {
    setSelectedCalendarId(calendarId);

    if (!accessToken || !calendarId) {
      setEvents([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const googleEvents = await fetchGoogleCalendarEvents(accessToken, calendarId);
      setEvents(googleEvents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar events.');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  const createEvent = useCallback(async (event: NewGoogleCalendarEvent): Promise<boolean> => {
    if (!accessToken || !selectedCalendarId) return false;

    setError(null);

    try {
      const created = await createGoogleCalendarEvent(accessToken, selectedCalendarId, event);
      setEvents(prev => {
        const next = [...prev, created];
        next.sort((a, b) => {
          const aTime = a.start?.dateTime || a.start?.date || '';
          const bTime = b.start?.dateTime || b.start?.date || '';
          return aTime.localeCompare(bTime);
        });
        return next;
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event.');
      return false;
    }
  }, [accessToken, selectedCalendarId]);

  const deleteEvent = useCallback(async (eventId: string): Promise<boolean> => {
    if (!accessToken || !selectedCalendarId) return false;

    setError(null);

    try {
      await deleteGoogleCalendarEvent(accessToken, selectedCalendarId, eventId);
      setEvents(prev => prev.filter(e => e.id !== eventId));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete event.');
      return false;
    }
  }, [accessToken, selectedCalendarId]);

  return {
    isConfigured: isGoogleCalendarConfigured,
    isConnected: Boolean(accessToken),
    isConnecting,
    isLoading,
    error,
    calendars,
    selectedCalendarId,
    events,
    connect,
    disconnect,
    refresh,
    chooseCalendar,
    createEvent,
    deleteEvent,
  };
}
