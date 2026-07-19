import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Не настроены серверные переменные Supabase');

    const { stableId } = await req.json();
    if (!Number.isSafeInteger(stableId) || stableId <= 0) throw new Error('Некорректный идентификатор пользователя');

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: dbUser, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, public_key, status, account_state')
      .eq('tg_id', stableId)
      .maybeSingle();
    if (userError) throw userError;
    if (!dbUser) throw new Error('Пользователь не найден');
    const accountState = dbUser.account_state || (dbUser.status === 'blocked' ? 'blocked' : 'active');
    if (accountState === 'blocked' || accountState === 'deleted' || dbUser.status === 'blocked') {
      throw new Error('Аккаунт заблокирован');
    }

    let payload: any;
    try { payload = JSON.parse(dbUser.public_key || '{}'); } catch { throw new Error('Повреждён публичный ключ пользователя'); }
    if (!payload?.legacy?.ecdsa) throw new Error('Для аккаунта не настроен ключ подписи');

    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonce = btoa(String.fromCharCode(...nonceBytes));
    const challenge = `syndicate:seed-login:${stableId}:${nonce}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const record = JSON.stringify({ challenge, expiresAt, purpose: 'seed-login', userId: dbUser.id });

    const { error: challengeError } = await supabaseAdmin.from('auth_challenges').upsert({
      id: `seed_${stableId}`,
      challenge: record,
      updated_at: new Date().toISOString(),
    });
    if (challengeError) throw challengeError;

    return json({ challenge, expiresAt });
  } catch (err: any) {
    return json({ error: err?.message || 'Unknown error' }, 400);
  }
});
