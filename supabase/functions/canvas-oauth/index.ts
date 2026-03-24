// Supabase Edge Function: Canvas OAuth2 callback handler
// Exchanges the authorization code for access + refresh tokens,
// stores them in canvas_connections, and redirects back to the app.

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // POST: exchange auth code for tokens (called from the client after redirect)
  if (req.method === 'POST') {
    try {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        return jsonResponse({ error: 'Missing authorization header' }, 401);
      }

      // Verify the user
      const supabaseUser = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
      if (authError || !user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const { code, base_url, redirect_uri } = await req.json() as {
        code: string;
        base_url: string;
        redirect_uri: string;
      };

      if (!code || !base_url) {
        return jsonResponse({ error: 'Missing code or base_url' }, 400);
      }

      const clientId = Deno.env.get('CANVAS_CLIENT_ID');
      const clientSecret = Deno.env.get('CANVAS_CLIENT_SECRET');
      if (!clientId || !clientSecret) {
        return jsonResponse({ error: 'Canvas OAuth not configured on server. Set CANVAS_CLIENT_ID and CANVAS_CLIENT_SECRET.' }, 500);
      }

      // Exchange authorization code for tokens
      const cleanBaseUrl = base_url.replace(/\/+$/, '');
      const tokenResp = await fetch(`${cleanBaseUrl}/login/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirect_uri || '',
          code,
        }),
      });

      if (!tokenResp.ok) {
        const errBody = await tokenResp.text();
        console.error('Canvas token exchange failed:', errBody);
        return jsonResponse({ error: 'Canvas rejected the authorization code. Please try again.' }, 400);
      }

      const tokenData = await tokenResp.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        token_type: string;
        user?: { id: number; name: string };
      };

      // Compute expiry
      const tokenExpiresAt = tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : null;

      // Get Canvas user info for display
      let canvasUserId: string | null = null;
      if (tokenData.user?.id) {
        canvasUserId = String(tokenData.user.id);
      } else {
        // Fetch user self to get Canvas user ID
        try {
          const selfResp = await fetch(`${cleanBaseUrl}/api/v1/users/self`, {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
          });
          if (selfResp.ok) {
            const selfData = await selfResp.json();
            canvasUserId = String(selfData.id);
          }
        } catch { /* non-critical */ }
      }

      // Upsert the connection using service role (tokens are sensitive)
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      const { data: conn, error: upsertError } = await supabaseAdmin
        .from('canvas_connections')
        .upsert({
          user_id: user.id,
          base_url: cleanBaseUrl,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || null,
          token_expires_at: tokenExpiresAt,
          canvas_user_id: canvasUserId,
        }, { onConflict: 'user_id' })
        .select('id, base_url, canvas_user_id, last_synced_at, created_at')
        .single();

      if (upsertError) {
        console.error('Failed to save Canvas connection:', upsertError);
        return jsonResponse({ error: 'Failed to save Canvas connection' }, 500);
      }

      return jsonResponse({
        success: true,
        connection: {
          id: conn.id,
          baseUrl: conn.base_url,
          canvasUserId: conn.canvas_user_id,
          lastSyncedAt: conn.last_synced_at,
          createdAt: conn.created_at,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OAuth error';
      console.error('Canvas OAuth error:', message);
      return jsonResponse({ error: message }, 500);
    }
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
});
