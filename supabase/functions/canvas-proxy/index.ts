// Supabase Edge Function: Canvas API proxy
// Proxies requests to a user's Canvas LMS instance to avoid browser CORS issues.
// The client sends { path, method?, body? } and the function forwards it using
// the user's stored Canvas credentials.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the caller via their Supabase JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Look up the user's Canvas connection
    const { data: conn, error: connError } = await supabase
      .from('canvas_connections')
      .select('base_url, api_token')
      .eq('user_id', user.id)
      .single();

    if (connError || !conn) {
      return new Response(JSON.stringify({ error: 'No Canvas connection found. Please connect Canvas first.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse the proxy request
    const { path, method = 'GET', body } = await req.json() as {
      path: string;
      method?: string;
      body?: unknown;
    };

    if (!path || !path.startsWith('/api/v1/')) {
      return new Response(JSON.stringify({ error: 'Invalid Canvas API path' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Forward to Canvas
    const canvasUrl = `${conn.base_url.replace(/\/+$/, '')}${path}`;
    const canvasResponse = await fetch(canvasUrl, {
      method,
      headers: {
        'Authorization': `Bearer ${conn.api_token}`,
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
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
