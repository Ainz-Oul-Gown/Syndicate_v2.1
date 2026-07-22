import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as jose from 'https://deno.land/x/jose@v4.14.4/index.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function base64ToBytes(value: string): Uint8Array {
  if (typeof value !== 'string' || value.length < 16 || value.length > 1024) throw new Error('Некорректная подпись');
  let binary: string;
  try { binary = atob(value.replace(/\s/g, '')); } catch { throw new Error('Некорректная подпись'); }
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const JWT_SECRET = Deno.env.get('JWT_SECRET');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!JWT_SECRET || !SUPABASE_URL || !SERVICE_KEY) throw new Error('Не настроены серверные переменные Supabase');

    const { stableId, challenge, signature } = await req.json();
    if (!Number.isSafeInteger(stableId) || stableId <= 0) throw new Error('Некорректный идентификатор пользователя');
    if (typeof challenge !== 'string' || challenge.length > 512) throw new Error('Некорректный challenge');

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Atomic consume: only the first matching verification request receives the challenge row.
    const { data: consumed, error: consumeError } = await supabaseAdmin
      .from('auth_challenges')
      .delete()
      .eq('id', `seed_${stableId}`)
      .select('challenge')
      .maybeSingle();
    if (consumeError) throw consumeError;
    if (!consumed) throw new Error('Challenge отсутствует или уже использован');

    let record: any;
    try { record = JSON.parse(consumed.challenge); } catch { throw new Error('Повреждён challenge'); }
    if (record?.purpose !== 'seed-login' || record?.challenge !== challenge) throw new Error('Challenge не совпадает');
    if (!record?.expiresAt || Date.parse(record.expiresAt) <= Date.now()) throw new Error('Challenge истёк');

    const { data: dbUser, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, tg_id, first_name, status, account_state, deactivated_at, public_key, session_version')
      .eq('tg_id', stableId)
      .maybeSingle();
    if (userError) throw userError;
    if (!dbUser || dbUser.id !== record.userId) throw new Error('Пользователь не найден');

    let payload: any;
    try { payload = JSON.parse(dbUser.public_key || '{}'); } catch { throw new Error('Повреждён публичный ключ пользователя'); }
    const publicJwk = payload?.legacy?.ecdsa;
    if (!publicJwk) throw new Error('Для аккаунта не настроен ключ подписи');

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      publicJwk,
      { name: 'ECDSA', namedCurve: publicJwk.crv || 'P-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      base64ToBytes(signature),
      new TextEncoder().encode(challenge),
    );
    if (!valid) throw new Error('Подпись challenge не прошла проверку');

    const accountState = dbUser.account_state || (dbUser.status === 'blocked' ? 'blocked' : 'active');
    if (accountState === 'blocked' || accountState === 'deleted' || dbUser.status === 'blocked') {
      throw new Error('Аккаунт заблокирован');
    }

    let effectiveUser = dbUser;
    if (accountState === 'deactivated') {
      const nextVersion = Number(dbUser.session_version || 1) + 1;
      const { data: restored, error: restoreError } = await supabaseAdmin
        .from('users')
        .update({ account_state: 'active', deactivated_at: null, session_version: nextVersion })
        .eq('id', dbUser.id)
        .eq('account_state', 'deactivated')
        .select('id, tg_id, first_name, session_version')
        .maybeSingle();
      if (restoreError) throw restoreError;
      if (!restored) throw new Error('Не удалось восстановить аккаунт');
      effectiveUser = { ...dbUser, ...restored, account_state: 'active' };
    }

    const now = Math.floor(Date.now() / 1000);
    const token = await new jose.SignJWT({
      aud: 'authenticated', role: 'authenticated', iss: 'supabase', tg_id: stableId, auth_provider: 'seed', session_version: Number(effectiveUser.session_version || 1), sub: effectiveUser.id,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(now + 60 * 60 * 24 * 7)
      .sign(new TextEncoder().encode(JWT_SECRET));

    return json({ token, user: { id: effectiveUser.id, tg_id: effectiveUser.tg_id, first_name: effectiveUser.first_name } });
  } catch (err: any) {
    return json({ error: err?.message || 'Unknown error' }, 400);
  }
});
