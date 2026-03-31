import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface GoogleTokenExchangeResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new Error('Google Calendar OAuth is not configured on the server.');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Google token exchange failed:', errorText);
    throw new Error('Google rejected the calendar connection. Please try again.');
  }

  return await response.json() as GoogleTokenExchangeResponse;
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new Error('Google Calendar OAuth is not configured on the server.');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Google token refresh failed:', errorText);
    throw new Error('Google Calendar token refresh failed. Please reconnect Google Calendar.');
  }

  return await response.json() as GoogleTokenExchangeResponse;
}

async function revokeGoogleToken(token: string) {
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // best effort
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Supabase function environment is not configured.' }, 500);
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return jsonResponse({ error: 'Missing bearer token' }, 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const { action, code, redirectUri } = await req.json() as {
      action: 'exchange' | 'refresh' | 'disconnect';
      code?: string;
      redirectUri?: string;
    };

    if (action === 'exchange') {
      if (!code || !redirectUri) {
        return jsonResponse({ error: 'Missing code or redirectUri' }, 400);
      }

      const tokenData = await exchangeCodeForTokens(code, redirectUri);
      if (!tokenData.refresh_token) {
        return jsonResponse({
          error: 'Google did not return a refresh token. Disconnect Google Calendar and reconnect to grant offline access again.',
        }, 400);
      }

      const { error: upsertError } = await supabaseAdmin
        .from('google_calendar_connections')
        .upsert({
          user_id: user.id,
          refresh_token: tokenData.refresh_token,
          scopes: tokenData.scope ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (upsertError) {
        console.error('Failed to save Google Calendar connection:', upsertError);
        return jsonResponse({ error: 'Failed to save Google Calendar connection.' }, 500);
      }

      return jsonResponse({
        connected: true,
        accessToken: tokenData.access_token,
        expiresIn: tokenData.expires_in ?? 3600,
        scope: tokenData.scope ?? null,
      });
    }

    const { data: connection, error: connectionError } = await supabaseAdmin
      .from('google_calendar_connections')
      .select('id, refresh_token, scopes')
      .eq('user_id', user.id)
      .maybeSingle();

    if (connectionError) {
      console.error('Failed to load Google Calendar connection:', connectionError);
      return jsonResponse({ error: 'Failed to load Google Calendar connection.' }, 500);
    }

    if (!connection) {
      return jsonResponse({ error: 'No Google Calendar connection found. Please connect Google Calendar first.' }, 404);
    }

    if (action === 'refresh') {
      const tokenData = await refreshGoogleAccessToken(connection.refresh_token);
      return jsonResponse({
        connected: true,
        accessToken: tokenData.access_token,
        expiresIn: tokenData.expires_in ?? 3600,
        scope: tokenData.scope ?? connection.scopes ?? null,
      });
    }

    if (action === 'disconnect') {
      await revokeGoogleToken(connection.refresh_token);
      const { error: deleteError } = await supabaseAdmin
        .from('google_calendar_connections')
        .delete()
        .eq('id', connection.id);

      if (deleteError) {
        console.error('Failed to delete Google Calendar connection:', deleteError);
        return jsonResponse({ error: 'Failed to disconnect Google Calendar.' }, 500);
      }

      return jsonResponse({ connected: false });
    }

    return jsonResponse({ error: 'Invalid action' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google Calendar OAuth error';
    console.error('Google Calendar OAuth error:', message);
    return jsonResponse({ error: message }, 500);
  }
});
