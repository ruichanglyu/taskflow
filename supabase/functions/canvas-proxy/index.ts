// Supabase Edge Function: Canvas API proxy
// Proxies requests to a user's Canvas LMS using server-side OAuth tokens.
// Handles automatic token refresh when access_token expires.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Refresh the OAuth access token using the refresh_token
async function refreshAccessToken(
  baseUrl: string,
  refreshToken: string,
): Promise<{ access_token: string; expires_in?: number } | null> {
  const clientId = Deno.env.get('CANVAS_CLIENT_ID');
  const clientSecret = Deno.env.get('CANVAS_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;

  try {
    const resp = await fetch(`${baseUrl}/login/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Verify the caller's JWT
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Look up the user's Canvas connection (using service role to read tokens)
    const { data: conn, error: connError } = await supabaseAdmin
      .from('canvas_connections')
      .select('id, base_url, access_token, refresh_token, token_expires_at')
      .eq('user_id', user.id)
      .single();

    if (connError || !conn) {
      return jsonResponse({ error: 'No Canvas connection found. Please connect Canvas first.' }, 404);
    }

    let accessToken = conn.access_token;

    // Check if token is expired (or about to expire in 60s)
    if (conn.token_expires_at && conn.refresh_token) {
      const expiresAt = new Date(conn.token_expires_at).getTime();
      const now = Date.now();
      if (now >= expiresAt - 60_000) {
        const refreshed = await refreshAccessToken(conn.base_url, conn.refresh_token);
        if (refreshed) {
          accessToken = refreshed.access_token;
          // Persist the new token
          const updates: Record<string, unknown> = { access_token: refreshed.access_token };
          if (refreshed.expires_in) {
            updates.token_expires_at = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
          }
          await supabaseAdmin
            .from('canvas_connections')
            .update(updates)
            .eq('id', conn.id);
        } else {
          return jsonResponse({ error: 'Canvas token expired and refresh failed. Please reconnect Canvas.' }, 401);
        }
      }
    }

    // Parse the proxy request
    const { path, method = 'GET', body } = await req.json() as {
      path: string;
      method?: string;
      body?: unknown;
    };

    if (!path || !path.startsWith('/api/v1/')) {
      return jsonResponse({ error: 'Invalid Canvas API path' }, 400);
    }

    // Forward to Canvas
    const canvasUrl = `${conn.base_url.replace(/\/+$/, '')}${path}`;
    const canvasResponse = await fetch(canvasUrl, {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const responseBody = await canvasResponse.text();

    return new Response(responseBody, {
      status: canvasResponse.status,
      headers: {
        ...corsHeaders,
        'Content-Type': canvasResponse.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Canvas proxy error';
    return jsonResponse({ error: message }, 500);
  }
});
