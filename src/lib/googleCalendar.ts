export const GOOGLE_CALENDAR_SCOPE = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');
export const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
export const isGoogleCalendarConfigured = Boolean(googleClientId);

const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: GoogleTokenClientConfig) => GoogleTokenClient;
          revoke: (token: string, callback?: () => void) => void;
        };
      };
    };
  }
}

export interface GoogleTokenResponse {
  access_token: string;
  error?: string;
  expires_in?: number;
  prompt?: string;
  scope?: string;
  token_type?: string;
}

interface GoogleTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GoogleTokenResponse) => void;
  error_callback?: (error: { type: string }) => void;
}

interface GoogleTokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}

let googleScriptPromise: Promise<void> | null = null;

export function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (googleScriptPromise) {
    return googleScriptPromise;
  }

  googleScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services.'));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
  foregroundColor?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  location?: string;
  status?: string;
  start?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  calendarId?: string;
  calendarSummary?: string;
  calendarColor?: string;
}

async function googleFetch<T>(path: string, accessToken: string, options?: RequestInit) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Google Calendar request failed.');
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function fetchGoogleCalendars(accessToken: string) {
  const data = await googleFetch<{ items?: GoogleCalendarListItem[] }>('/users/me/calendarList', accessToken);
  return data.items ?? [];
}

export interface NewGoogleCalendarEvent {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone?: string } | { date: string };
  end: { dateTime: string; timeZone?: string } | { date: string };
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: NewGoogleCalendarEvent
): Promise<GoogleCalendarEvent> {
  return googleFetch<GoogleCalendarEvent>(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    accessToken,
    { method: 'POST', body: JSON.stringify(event) }
  );
}

export async function updateGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: Partial<NewGoogleCalendarEvent>
): Promise<GoogleCalendarEvent> {
  return googleFetch<GoogleCalendarEvent>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
    { method: 'PUT', body: JSON.stringify(event) }
  );
}

export async function deleteGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  await googleFetch<void>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
    { method: 'DELETE' }
  );
}

export async function fetchGoogleCalendarEvents(
  accessToken: string,
  calendarId: string,
  calendarMeta?: Pick<GoogleCalendarListItem, 'summary' | 'backgroundColor'>,
  range?: { timeMin?: string; timeMax?: string }
) {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
    timeMin: range?.timeMin || new Date().toISOString(),
  });

  if (range?.timeMax) {
    params.set('timeMax', range.timeMax);
  }

  const data = await googleFetch<{ items?: GoogleCalendarEvent[] }>(
    `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    accessToken
  );

  return (data.items ?? []).map(event => ({
    ...event,
    calendarId,
    calendarSummary: calendarMeta?.summary,
    calendarColor: calendarMeta?.backgroundColor,
  }));
}
