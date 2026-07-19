import { createClient } from 'npm:@supabase/supabase-js@2';
import { jwtVerify } from 'npm:jose@5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const jwtSecret = Deno.env.get('JWT_SECRET');
    if (!url || !serviceKey || !jwtSecret) throw new Error('Missing server configuration');

    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) throw new Error('Unauthorized');

    const { payload } = await jwtVerify(auth.slice(7), new TextEncoder().encode(jwtSecret), {
      algorithms: ['HS256'],
      issuer: 'supabase',
      audience: 'authenticated',
    });
    const tgId = Number(payload.tg_id);
    const sessionVersion = Number(payload.session_version);
    if (!Number.isSafeInteger(tgId) || !Number.isInteger(sessionVersion)) throw new Error('Unauthorized');

    const client = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: user } = await client
      .from('users')
      .select('session_version, status')
      .eq('tg_id', tgId)
      .maybeSingle();
    if (!user || Number(user.session_version) !== sessionVersion || user.status === 'blocked') {
      throw new Error('Session revoked');
    }

    const { data: rows, error } = await client
      .from('storage_cleanup_queue')
      .select('id, bucket_id, storage_path, attempts')
      .order('queued_at', { ascending: true })
      .limit(100);
    if (error) throw error;

    let removed = 0;
    for (const row of rows || []) {
      const { error: removeError } = await client.storage.from(row.bucket_id).remove([row.storage_path]);
      if (!removeError) {
        await client.from('storage_cleanup_queue').delete().eq('id', row.id);
        removed += 1;
      } else {
        await client.from('storage_cleanup_queue').update({
          attempts: Number(row.attempts || 0) + 1,
          last_error: removeError.message,
        }).eq('id', row.id);
      }
    }

    return new Response(JSON.stringify({ processed: rows?.length || 0, removed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
});
