import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays } from '../utils/dateHelpers';
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  fetchGoogleCalendarEvents,
  fetchGoogleCalendars,
  GoogleCodeResponse,
  GOOGLE_CALENDAR_SCOPE,
  GoogleCalendarEvent,
  GoogleCalendarListItem,
  googleClientId,
  isGoogleCalendarConfigured,
  loadGoogleIdentityScript,
  moveGoogleCalendarEvent,
  NewGoogleCalendarEvent,
  updateGoogleCalendarEvent,
} from '../lib/googleCalendar';
import { supabaseUrl } from '../lib/supabase';

const STORAGE_KEY_PREFIX = 'taskflow_google_calendar';

function getStorageKey(userId: string, suffix: string) {
  return `${STORAGE_KEY_PREFIX}:${userId}:${suffix}`;
}

/** Max age for cached calendars/events before they're considered stale (5 minutes). */
const CACHE_MAX_AGE_MS = 5 * 60 * 1000;

function readJsonCache<T>(key: string, maxAge = CACHE_MAX_AGE_MS): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw) as { ts: number; data: T };
    if (Date.now() - ts > maxAge) return null;
    return data;
  } catch {
    return null;
  }
}

function writeJsonCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // storage full — non-critical
  }
}

const CALENDAR_HISTORY_BUFFER_DAYS = 365;
const CALENDAR_FUTURE_BUFFER_DAYS = 365;

function expandCalendarRange(range: { timeMin?: string; timeMax?: string }) {
  const now = new Date();
  const anchorStart = range.timeMin ? new Date(range.timeMin) : now;
  const anchorEnd = range.timeMax ? new Date(range.timeMax) : now;

  const expandedStart = addDays(anchorStart, -CALENDAR_HISTORY_BUFFER_DAYS);
  const expandedEnd = addDays(anchorEnd, CALENDAR_FUTURE_BUFFER_DAYS);
  expandedStart.setHours(0, 0, 0, 0);
  expandedEnd.setHours(0, 0, 0, 0);

  return {
    timeMin: expandedStart.toISOString(),
    timeMax: expandedEnd.toISOString(),
  };
}

function getDefaultCalendarRange() {
  const now = new Date();
  return expandCalendarRange({
    timeMin: now.toISOString(),
    timeMax: now.toISOString(),
  });
}

function buildCalendarEventIdentity(event: GoogleCalendarEvent) {
  const startValue = event.start?.dateTime || event.start?.date || '';
  const endValue = event.end?.dateTime || event.end?.date || '';
  return `${event.calendarId || ''}::${event.id || ''}::${event.summary || ''}::${startValue}::${endValue}`;
}

function eventMatchesIdentity(event: GoogleCalendarEvent, eventId: string, calendarId?: string) {
  return event.id === eventId && (calendarId ? event.calendarId === calendarId : true);
}

function dedupeCalendarEvents(events: GoogleCalendarEvent[]) {
  const byIdentity = new Map<string, GoogleCalendarEvent>();
  for (const event of events) {
    byIdentity.set(buildCalendarEventIdentity(event), event);
  }
  return [...byIdentity.values()];
}

function chooseFallbackCalendarId(
  calendars: GoogleCalendarListItem[],
  selectedCalendarId: string,
  visibleCalendarIds: string[],
) {
  if (selectedCalendarId && calendars.some(calendar => calendar.id === selectedCalendarId)) {
    return selectedCalendarId;
  }

  const firstVisible = visibleCalendarIds.find(id => calendars.some(calendar => calendar.id === id));
  if (firstVisible) return firstVisible;

  return calendars.find(calendar => calendar.primary)?.id || calendars[0]?.id || '';
}

export function useGoogleCalendar(userId: string) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [hasHydratedStoredToken, setHasHydratedStoredToken] = useState(false);
  const [hasHydratedStoredCalendars, setHasHydratedStoredCalendars] = useState(false);
  const [calendars, setCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('');
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<string[]>([]);
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<string | null>(null);
  const visibleCalendarIdsRef = useRef<string[]>([]);

  const calendarStorageKey = useMemo(() => getStorageKey(userId, 'selected-calendar'), [userId]);
  const visibleCalendarsStorageKey = useMemo(() => getStorageKey(userId, 'visible-calendars'), [userId]);
  const tokenStorageKey = useMemo(() => getStorageKey(userId, 'access-token'), [userId]);
  const tokenExpiryStorageKey = useMemo(() => getStorageKey(userId, 'access-token-expiry'), [userId]);
  const connectedStorageKey = useMemo(() => getStorageKey(userId, 'connected'), [userId]);
  const calendarsCacheKey = useMemo(() => getStorageKey(userId, 'calendars-cache'), [userId]);
  const eventsCacheKey = useMemo(() => getStorageKey(userId, 'events-cache'), [userId]);
  const [hasStoredConnection, setHasStoredConnection] = useState(() => localStorage.getItem(connectedStorageKey) === 'true');
  const [eventRange, setEventRange] = useState<{ timeMin?: string; timeMax?: string }>(() => getDefaultCalendarRange());

  const clearLocalConnectionState = useCallback(() => {
    setAccessToken(null);
    setCalendars([]);
    setEvents([]);
    setSelectedCalendarId('');
    setVisibleCalendarIds([]);
    setError(null);
    localStorage.removeItem(calendarStorageKey);
    localStorage.removeItem(visibleCalendarsStorageKey);
    localStorage.removeItem(tokenStorageKey);
    localStorage.removeItem(tokenExpiryStorageKey);
    localStorage.removeItem(connectedStorageKey);
    localStorage.removeItem(calendarsCacheKey);
    localStorage.removeItem(eventsCacheKey);
    setHasStoredConnection(false);
  }, [calendarStorageKey, calendarsCacheKey, connectedStorageKey, eventsCacheKey, tokenExpiryStorageKey, tokenStorageKey, visibleCalendarsStorageKey]);

  useEffect(() => {
    setHasStoredConnection(localStorage.getItem(connectedStorageKey) === 'true');
  }, [connectedStorageKey]);

  useEffect(() => {
    const storedCalendarId = localStorage.getItem(calendarStorageKey);
    if (storedCalendarId) {
      setSelectedCalendarId(storedCalendarId);
    }
    const storedVisible = localStorage.getItem(visibleCalendarsStorageKey);
    if (storedVisible) {
      try {
        const parsed = JSON.parse(storedVisible);
        if (Array.isArray(parsed)) {
          setVisibleCalendarIds(parsed.filter((value): value is string => typeof value === 'string'));
        }
      } catch {
        // ignore malformed local state
      }
    }
    setHasHydratedStoredCalendars(true);
  }, [calendarStorageKey, visibleCalendarsStorageKey]);

  useEffect(() => {
    const shouldReconnect = localStorage.getItem(connectedStorageKey) === 'true';
    if (!shouldReconnect) {
      localStorage.removeItem(tokenStorageKey);
      localStorage.removeItem(tokenExpiryStorageKey);
      setHasHydratedStoredToken(true);
      return;
    }

    // Restore cached access token if it's still valid (> 60 s remaining)
    const storedToken = localStorage.getItem(tokenStorageKey);
    const storedExpiry = Number(localStorage.getItem(tokenExpiryStorageKey));
    if (storedToken && Number.isFinite(storedExpiry) && Date.now() < storedExpiry - 60_000) {
      setAccessToken(storedToken);
    }

    // Hydrate cached calendars + events so the UI renders instantly
    const cachedCalendars = readJsonCache<GoogleCalendarListItem[]>(calendarsCacheKey);
    if (cachedCalendars && cachedCalendars.length > 0) {
      setCalendars(cachedCalendars);
      setSelectedCalendarId(current => chooseFallbackCalendarId(cachedCalendars, current, visibleCalendarIdsRef.current));
    }
    const cachedEvents = readJsonCache<GoogleCalendarEvent[]>(eventsCacheKey);
    if (cachedEvents && cachedEvents.length > 0) {
      setEvents(cachedEvents);
    }

    setHasHydratedStoredToken(true);
  }, [calendarsCacheKey, connectedStorageKey, eventsCacheKey, tokenExpiryStorageKey, tokenStorageKey]);

  useEffect(() => {
    if (selectedCalendarId) {
      localStorage.setItem(calendarStorageKey, selectedCalendarId);
    }
  }, [calendarStorageKey, selectedCalendarId]);

  useEffect(() => {
    if (!hasHydratedStoredCalendars) return;
    localStorage.setItem(visibleCalendarsStorageKey, JSON.stringify(visibleCalendarIds));
    visibleCalendarIdsRef.current = visibleCalendarIds;
  }, [hasHydratedStoredCalendars, visibleCalendarIds, visibleCalendarsStorageKey]);

  useEffect(() => {
    if (accessToken) {
      localStorage.setItem(connectedStorageKey, 'true');
      localStorage.setItem(tokenStorageKey, accessToken);
    } else {
      localStorage.removeItem(tokenStorageKey);
    }
  }, [accessToken, connectedStorageKey, tokenStorageKey]);

  useEffect(() => {
    if (!accessToken && !hasStoredConnection && !isConnecting && !isLoading && error) {
      setError(null);
    }
  }, [accessToken, error, hasStoredConnection, isConnecting, isLoading]);

  const loadEventsForCalendars = useCallback(async (
    token: string,
    targetCalendars: GoogleCalendarListItem[],
    nextVisibleIds?: string[],
    nextSelectedCalendarId?: string,
    nextRange?: { timeMin?: string; timeMax?: string }
  ) => {
    const idsToShow = nextVisibleIds !== undefined
      ? nextVisibleIds
      : nextSelectedCalendarId
        ? [nextSelectedCalendarId]
        : targetCalendars.find(calendar => calendar.primary)?.id
          ? [targetCalendars.find(calendar => calendar.primary)!.id]
          : targetCalendars[0]?.id
            ? [targetCalendars[0].id]
            : [];

    const validIds = idsToShow.filter(id => targetCalendars.some(calendar => calendar.id === id));

    if (validIds.length === 0) {
      setEvents([]);
      setVisibleCalendarIds([]);
      return;
    }

    setVisibleCalendarIds(validIds);

    const calendarLookup = new Map(targetCalendars.map(calendar => [calendar.id, calendar]));
    const eventGroups = await Promise.all(
      validIds.map(async calendarId => {
        const calendarMeta = calendarLookup.get(calendarId);
        return fetchGoogleCalendarEvents(token, calendarId, {
          summary: calendarMeta?.summary ?? '',
          backgroundColor: calendarMeta?.backgroundColor,
        }, nextRange ?? eventRange);
      })
    );

    const mergedEvents = dedupeCalendarEvents(eventGroups
      .flat())
      .sort((a, b) => {
        const aTime = a.start?.dateTime || a.start?.date || '';
        const bTime = b.start?.dateTime || b.start?.date || '';
        return aTime.localeCompare(bTime);
      });

    setEvents(mergedEvents);
    writeJsonCache(eventsCacheKey, mergedEvents);
  }, [eventRange, eventsCacheKey]);

  const loadCalendarData = useCallback(async (token: string, nextCalendarId?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const googleCalendars = await fetchGoogleCalendars(token);
      setCalendars(googleCalendars);
      writeJsonCache(calendarsCacheKey, googleCalendars);

      const fallbackCalendarId =
        nextCalendarId ||
        selectedCalendarId ||
        googleCalendars.find(calendar => calendar.primary)?.id ||
        googleCalendars[0]?.id ||
        '';

      setSelectedCalendarId(fallbackCalendarId);

      if (!fallbackCalendarId) {
        setVisibleCalendarIds([]);
        setEvents([]);
        return;
      }

      const hasStoredVisiblePreference = localStorage.getItem(visibleCalendarsStorageKey) !== null;
      await loadEventsForCalendars(
        token,
        googleCalendars,
        hasStoredVisiblePreference ? visibleCalendarIdsRef.current : undefined,
        fallbackCalendarId,
        eventRange
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Google Calendar.';
      if (message.includes('Invalid Credentials') || message.includes('Login Required') || message.includes('authError')) {
        clearLocalConnectionState();
      }
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [calendarsCacheKey, clearLocalConnectionState, eventRange, loadEventsForCalendars, selectedCalendarId, visibleCalendarsStorageKey]);

  const postGoogleCalendarOAuth = useCallback(async (body: Record<string, unknown>) => {
    const { supabase } = await import('../lib/supabase');
    if (!supabase || !supabaseUrl) {
      throw new Error('Supabase is not configured yet.');
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshed.session?.access_token) {
        throw new Error('Your session expired. Please sign in again before connecting Google Calendar.');
      }
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('You need to be signed in before connecting Google Calendar.');
    }

    const { data, error: invokeError } = await supabase.functions.invoke('google-calendar-oauth', {
      body,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (invokeError) {
      throw new Error(invokeError.message || 'Google Calendar request failed.');
    }

    return (data ?? {}) as {
      accessToken?: string;
      expiresIn?: number;
      scope?: string;
      connected?: boolean;
    };
  }, []);

  const setAccessTokenWithExpiry = useCallback((token: string | null, expiresInSeconds?: number | null) => {
    if (token && expiresInSeconds) {
      const expiresAt = Date.now() + expiresInSeconds * 1000;
      localStorage.setItem(tokenExpiryStorageKey, String(expiresAt));
    } else if (!token) {
      localStorage.removeItem(tokenExpiryStorageKey);
    }

    setAccessToken(token);
  }, [tokenExpiryStorageKey]);

  const refreshAccessTokenFromServer = useCallback(async () => {
    try {
      const response = await postGoogleCalendarOAuth({ action: 'refresh' });
      if (!response.accessToken) {
        throw new Error('Failed to refresh Google Calendar access.');
      }

      setAccessTokenWithExpiry(response.accessToken, response.expiresIn ?? 3600);
      localStorage.setItem(connectedStorageKey, 'true');
      setHasStoredConnection(true);
      return response.accessToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh Google Calendar access.';
      if (message.includes('No Google Calendar connection found')) {
        clearLocalConnectionState();
        return null;
      }
      throw error;
    }
  }, [clearLocalConnectionState, postGoogleCalendarOAuth, setAccessTokenWithExpiry]);

  const ensureAccessToken = useCallback(async () => {
    const storedExpiry = Number(localStorage.getItem(tokenExpiryStorageKey));
    const isExpiredOrNearExpiry = !accessToken || !Number.isFinite(storedExpiry) || Date.now() >= storedExpiry - 60_000;

    if (!isExpiredOrNearExpiry && accessToken) {
      return accessToken;
    }

    if (localStorage.getItem(connectedStorageKey) !== 'true') {
      return null;
    }

    return refreshAccessTokenFromServer();
  }, [accessToken, connectedStorageKey, refreshAccessTokenFromServer, tokenExpiryStorageKey]);

  const requestCalendarCode = useCallback(async () => {
    if (!isGoogleCalendarConfigured || !googleClientId) {
      throw new Error('Google Calendar is not configured yet. Add VITE_GOOGLE_CLIENT_ID first.');
    }

    await loadGoogleIdentityScript();

    return new Promise<GoogleCodeResponse>((resolve, reject) => {
      const codeClient = window.google?.accounts.oauth2.initCodeClient({
        client_id: googleClientId,
        scope: GOOGLE_CALENDAR_SCOPE,
        ux_mode: 'popup',
        callback: response => {
          if (response.error || !response.code) {
            reject(new Error(response.error || 'Google sign-in failed.'));
            return;
          }
          resolve(response);
        },
        error_callback: error => {
          reject(new Error(error.type || 'Google sign-in failed.'));
        },
      });

      codeClient?.requestCode();
    });
  }, []);

  useEffect(() => {
    const shouldReconnect = localStorage.getItem(connectedStorageKey) === 'true';
    if (!hasHydratedStoredToken || !shouldReconnect || !isGoogleCalendarConfigured) return;

    // If the hydration effect already restored a valid cached token, just
    // do a background data refresh — no need for a server token round-trip.
    if (accessToken) return;

    let cancelled = false;

    void refreshAccessTokenFromServer()
      .then(token => {
        if (cancelled) return;
        if (!token) return;
        return loadCalendarData(token);
      })
      .catch(() => {
        if (cancelled) return;
        clearLocalConnectionState();
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, connectedStorageKey, clearLocalConnectionState, hasHydratedStoredToken, isGoogleCalendarConfigured, loadCalendarData, refreshAccessTokenFromServer]);

  const connect = useCallback(async () => {
    if (!isGoogleCalendarConfigured || !googleClientId) {
      setError('Google Calendar is not configured yet. Add VITE_GOOGLE_CLIENT_ID first.');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const codeResponse = await requestCalendarCode();
      const exchange = await postGoogleCalendarOAuth({
        action: 'exchange',
        code: codeResponse.code,
        redirectUri: window.location.origin,
      });
      if (!exchange.accessToken) {
        throw new Error('Google Calendar connection did not return an access token.');
      }
      setAccessTokenWithExpiry(exchange.accessToken, exchange.expiresIn ?? 3600);
      localStorage.setItem(connectedStorageKey, 'true');
      setHasStoredConnection(true);
      const token = exchange.accessToken;
      await loadCalendarData(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Google Calendar.');
    } finally {
      setIsConnecting(false);
    }
  }, [connectedStorageKey, loadCalendarData, postGoogleCalendarOAuth, requestCalendarCode, setAccessTokenWithExpiry]);

  const disconnect = useCallback(async () => {
    if (accessToken && window.google?.accounts.oauth2) {
      window.google.accounts.oauth2.revoke(accessToken, () => undefined);
    }

    try {
      await postGoogleCalendarOAuth({ action: 'disconnect' });
    } catch {
      // Keep local disconnect resilient even if server cleanup fails.
    }

    clearLocalConnectionState();
    setError(null);
  }, [accessToken, clearLocalConnectionState, postGoogleCalendarOAuth]);

  const refresh = useCallback(async () => {
    const token = await ensureAccessToken();
    if (!token) return;
    await loadCalendarData(token);
  }, [ensureAccessToken, loadCalendarData]);

  const setVisibleRange = useCallback((range: { timeMin?: string; timeMax?: string }) => {
    const expandedRange = expandCalendarRange(range);
    setEventRange(current => {
      if (current.timeMin === expandedRange.timeMin && current.timeMax === expandedRange.timeMax) {
        return current;
      }
      return expandedRange;
    });
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    void loadCalendarData(accessToken);
  }, [accessToken, eventRange, loadCalendarData]);

  const chooseCalendar = useCallback(async (calendarId: string) => {
    setSelectedCalendarId(calendarId);

    const token = await ensureAccessToken();
    if (!token || !calendarId) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const nextVisible = visibleCalendarIds;
      await loadEventsForCalendars(token, calendars, nextVisible, calendarId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar events.');
    } finally {
      setIsLoading(false);
    }
  }, [calendars, ensureAccessToken, loadEventsForCalendars, visibleCalendarIds]);

  const toggleCalendarVisibility = useCallback(async (calendarId: string) => {
    const token = await ensureAccessToken();
    if (!token) return;

    const nextVisible = visibleCalendarIds.includes(calendarId)
      ? visibleCalendarIds.filter(id => id !== calendarId)
      : [...visibleCalendarIds, calendarId];

    setIsLoading(true);
    setError(null);

    try {
      const fallbackSelected = nextVisible.length === 0
        ? ''
        : nextVisible.includes(selectedCalendarId)
          ? selectedCalendarId
          : nextVisible[0];

      setSelectedCalendarId(fallbackSelected);
      await loadEventsForCalendars(token, calendars, nextVisible, fallbackSelected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update visible calendars.');
    } finally {
      setIsLoading(false);
    }
  }, [calendars, ensureAccessToken, loadEventsForCalendars, selectedCalendarId, visibleCalendarIds]);

  const createEvent = useCallback(async (event: NewGoogleCalendarEvent, calendarIdOverride?: string): Promise<boolean> => {
    errorRef.current = null;
    let activeCalendars = calendars;
    const token = await ensureAccessToken();
    if (!token) {
      const message = 'Google Calendar is not ready yet. Please reconnect and try again.';
      errorRef.current = message;
      setError(message);
      return false;
    }
    if (activeCalendars.length === 0) {
      try {
        activeCalendars = await fetchGoogleCalendars(token);
        if (activeCalendars.length > 0) {
          setCalendars(activeCalendars);
          writeJsonCache(calendarsCacheKey, activeCalendars);
          const hydratedCalendarId = chooseFallbackCalendarId(activeCalendars, selectedCalendarId, visibleCalendarIdsRef.current);
          if (hydratedCalendarId) {
            setSelectedCalendarId(hydratedCalendarId);
          }
        }
      } catch {
        // Leave activeCalendars empty and let the user-facing error below handle it.
      }
    }
    const targetCalendarId = calendarIdOverride || chooseFallbackCalendarId(activeCalendars, selectedCalendarId, visibleCalendarIdsRef.current);
    if (!targetCalendarId) {
      const message = 'Choose a calendar first before scheduling a study block.';
      errorRef.current = message;
      setError(message);
      return false;
    }

    setError(null);

    try {
      const created = await createGoogleCalendarEvent(token, targetCalendarId, event);
      const calendarMeta = activeCalendars.find(calendar => calendar.id === targetCalendarId);
      setEvents(prev => {
        const next = [
          ...prev,
          {
            ...created,
            calendarId: targetCalendarId,
            calendarSummary: calendarMeta?.summary,
            calendarColor: calendarMeta?.backgroundColor,
          },
        ];
        next.sort((a, b) => {
          const aTime = a.start?.dateTime || a.start?.date || '';
          const bTime = b.start?.dateTime || b.start?.date || '';
          return aTime.localeCompare(bTime);
        });
        return next;
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create event.';
      errorRef.current = message;
      setError(message);
      return false;
    }
  }, [calendars, calendarsCacheKey, ensureAccessToken, selectedCalendarId]);

  const updateEvent = useCallback(async (
    eventId: string,
    event: Partial<NewGoogleCalendarEvent>,
    calendarIdOverride?: string,
    existingEventOverride?: GoogleCalendarEvent,
  ): Promise<boolean> => {
    const existingEvent = existingEventOverride
      ?? events.find(existing => eventMatchesIdentity(existing, eventId, calendarIdOverride));
    const targetCalendarId =
      calendarIdOverride ||
      existingEvent?.calendarId ||
      chooseFallbackCalendarId(calendars, selectedCalendarId, visibleCalendarIdsRef.current);
    const token = await ensureAccessToken();
    if (!token || !targetCalendarId || !existingEvent) {
      if (!token) setError('Google Calendar is not ready yet. Please reconnect and try again.');
      if (!targetCalendarId) setError('Choose a calendar first before updating this event.');
      return false;
    }

    setError(null);

    try {
      const mergedEvent: NewGoogleCalendarEvent = {
        summary: event.summary ?? existingEvent.summary ?? 'Untitled event',
        ...(event.description !== undefined || existingEvent.description ? { description: event.description ?? existingEvent.description ?? undefined } : {}),
        ...(event.location !== undefined || existingEvent.location ? { location: event.location ?? existingEvent.location ?? undefined } : {}),
        start: event.start ?? (
          existingEvent.start?.dateTime
            ? { dateTime: existingEvent.start.dateTime, ...(existingEvent.start.timeZone ? { timeZone: existingEvent.start.timeZone } : {}) }
            : { date: existingEvent.start?.date ?? '' }
        ),
        end: event.end ?? (
          existingEvent.end?.dateTime
            ? { dateTime: existingEvent.end.dateTime, ...(existingEvent.end.timeZone ? { timeZone: existingEvent.end.timeZone } : {}) }
            : { date: existingEvent.end?.date ?? existingEvent.start?.date ?? '' }
        ),
      };

      const sourceCalendarId = existingEvent.calendarId;
      const isCalendarMove = Boolean(
        sourceCalendarId &&
        targetCalendarId &&
        sourceCalendarId !== targetCalendarId,
      );

      const hasFieldChanges =
        event.summary !== undefined ||
        event.description !== undefined ||
        event.location !== undefined ||
        event.start !== undefined ||
        event.end !== undefined;

      if (isCalendarMove && sourceCalendarId) {
        const moved = await moveGoogleCalendarEvent(token, sourceCalendarId, eventId, targetCalendarId);
        const calendarMeta = calendars.find(calendar => calendar.id === targetCalendarId);

        let finalEvent: GoogleCalendarEvent = {
          ...moved,
          calendarId: targetCalendarId,
          calendarSummary: calendarMeta?.summary,
          calendarColor: calendarMeta?.backgroundColor,
        };

        if (hasFieldChanges) {
          try {
            const updatedMoved = await updateGoogleCalendarEvent(
              token,
              targetCalendarId,
              moved.id,
              mergedEvent,
            );
            finalEvent = {
              ...finalEvent,
              ...updatedMoved,
              calendarId: targetCalendarId,
              calendarSummary: calendarMeta?.summary,
              calendarColor: calendarMeta?.backgroundColor,
            };
          } catch (updateError) {
            setError(updateError instanceof Error ? updateError.message : 'Event moved, but additional changes failed to save.');
          }
        }

        setEvents(prev =>
          [
            ...prev.filter(existing => !eventMatchesIdentity(existing, eventId, sourceCalendarId)),
            ...(visibleCalendarIdsRef.current.includes(targetCalendarId) ? [finalEvent] : []),
          ].sort((a, b) => {
            const aTime = a.start?.dateTime || a.start?.date || '';
            const bTime = b.start?.dateTime || b.start?.date || '';
            return aTime.localeCompare(bTime);
          }),
        );
        return true;
      }

      const updated = await updateGoogleCalendarEvent(token, targetCalendarId, eventId, mergedEvent);
      const calendarMeta = calendars.find(calendar => calendar.id === targetCalendarId);
      setEvents(prev =>
        prev
          .map(existing =>
            eventMatchesIdentity(existing, eventId, existingEvent.calendarId)
              ? {
                  ...existing,
                  ...updated,
                  calendarId: targetCalendarId,
                  calendarSummary: calendarMeta?.summary,
                  calendarColor: calendarMeta?.backgroundColor,
                }
              : existing,
          )
          .sort((a, b) => {
            const aTime = a.start?.dateTime || a.start?.date || '';
            const bTime = b.start?.dateTime || b.start?.date || '';
            return aTime.localeCompare(bTime);
          }),
      );
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update event.');
      return false;
    }
  }, [calendars, ensureAccessToken, events, selectedCalendarId]);

  const deleteEvent = useCallback(async (eventId: string, calendarIdOverride?: string): Promise<boolean> => {
    const targetCalendarId =
      calendarIdOverride ||
      events.find(existing => eventMatchesIdentity(existing, eventId, calendarIdOverride))?.calendarId ||
      chooseFallbackCalendarId(calendars, selectedCalendarId, visibleCalendarIdsRef.current);
    const token = await ensureAccessToken();
    if (!token || !targetCalendarId) {
      if (!token) setError('Google Calendar is not ready yet. Please reconnect and try again.');
      if (!targetCalendarId) setError('Choose a calendar first before deleting this event.');
      return false;
    }

    setError(null);

    try {
      await deleteGoogleCalendarEvent(token, targetCalendarId, eventId);
      setEvents(prev => prev.filter(existing => !eventMatchesIdentity(existing, eventId, targetCalendarId)));
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete event.';
      if (/\b410\b|has been deleted|Resource has been deleted/i.test(message)) {
        setEvents(prev => prev.filter(existing => !eventMatchesIdentity(existing, eventId, targetCalendarId)));
        return true;
      }
      setError(message);
      return false;
    }
  }, [calendars, ensureAccessToken, events, selectedCalendarId]);

  const getEventsForRange = useCallback(async (
    range: { timeMin?: string; timeMax?: string },
    calendarIds?: string[],
  ): Promise<GoogleCalendarEvent[]> => {
    const token = await ensureAccessToken();
    if (!token) return [];

    const requestedIds = calendarIds && calendarIds.length > 0
      ? calendarIds
      : visibleCalendarIdsRef.current.length > 0
        ? visibleCalendarIdsRef.current
        : selectedCalendarId
          ? [selectedCalendarId]
          : calendars.find(calendar => calendar.primary)?.id
            ? [calendars.find(calendar => calendar.primary)!.id]
            : calendars[0]?.id
              ? [calendars[0].id]
              : [];

    const validIds = requestedIds.filter(id => calendars.some(calendar => calendar.id === id));
    if (validIds.length === 0) return [];

    const calendarLookup = new Map(calendars.map(calendar => [calendar.id, calendar]));
    const eventGroups = await Promise.all(
      validIds.map(async calendarId => {
        const calendarMeta = calendarLookup.get(calendarId);
        return fetchGoogleCalendarEvents(token, calendarId, {
          summary: calendarMeta?.summary ?? '',
          backgroundColor: calendarMeta?.backgroundColor,
        }, range);
      }),
    );

    return eventGroups
      .flat()
      .sort((a, b) => {
        const aTime = a.start?.dateTime || a.start?.date || '';
        const bTime = b.start?.dateTime || b.start?.date || '';
        return aTime.localeCompare(bTime);
      });
  }, [calendars, ensureAccessToken, selectedCalendarId]);

  return {
    isConfigured: isGoogleCalendarConfigured,
    isConnected: Boolean(accessToken) || hasStoredConnection,
    isConnecting,
    isLoading,
    error,
    calendars,
    selectedCalendarId,
    visibleCalendarIds,
    events,
    connect,
    disconnect,
    refresh,
    setVisibleRange,
    chooseCalendar,
    toggleCalendarVisibility,
    createEvent,
    updateEvent,
    deleteEvent,
    getEventsForRange,
    getLastError: () => errorRef.current,
  };
}

export type GoogleCalendarController = ReturnType<typeof useGoogleCalendar>;
