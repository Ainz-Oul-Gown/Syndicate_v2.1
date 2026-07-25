import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7'
import * as jose from 'https://deno.land/x/jose@v4.14.4/index.ts'
import { getCorsHeaders, createAdminClient, json, issueRefreshToken } from '../_shared/provider-auth.ts'

async function consumeRegistrationInvite(supabaseAdmin: any, rawCode: unknown) {
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
  if (!/^SYND-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) throw new Error('Требуется действующий код приглашения');
  const { data, error } = await supabaseAdmin.from('registration_invites')
    .update({ consumed_at: new Date().toISOString() })
    .eq('code', code).is('consumed_at', null).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Неверный или уже использованный код приглашения');
}

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const headers = getCorsHeaders(origin)
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  try {
    const JWT_SECRET = Deno.env.get('JWT_SECRET');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!JWT_SECRET || !SUPABASE_URL || !SERVICE_KEY) throw new Error('Не настроены серверные переменные Supabase');

    const { stableId, name, publicKeysPayload, isRegister, registrationInvite } = await req.json();
    if (!Number.isSafeInteger(stableId) || stableId <= 0) throw new Error('Некорректный идентификатор пользователя');
    if (typeof isRegister !== 'boolean') throw new Error('Некорректный режим авторизации');

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    let { data: dbUser, error: lookupError } = await supabaseAdmin.from('users').select('id, tg_id, first_name, status, public_key, session_version, created_at').eq('tg_id', stableId).maybeSingle();
    if (lookupError) throw lookupError;

    if (isRegister) {
      if (dbUser) throw new Error('Узел с таким идентификатором уже существует');
      await consumeRegistrationInvite(supabaseAdmin, registrationInvite);
      const { data: newUser, error: insertError } = await supabaseAdmin.from('users').insert({
        tg_id: stableId,
        first_name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : 'User',
        public_key: publicKeysPayload || null,
        status: 'free'
      }).select('id, tg_id, first_name, status, public_key, session_version, created_at').single();
      if (insertError) throw insertError;
      dbUser = newUser;
    } else {
      throw new Error('Прямой вход через auth-custom отключён. Используйте проверенный метод авторизации.');
    }

    const now = Math.floor(Date.now() / 1000);
    const jwt = await new jose.SignJWT({ aud: 'authenticated', role: 'authenticated', iss: 'supabase', tg_id: stableId, auth_provider: 'seed', session_version: Number(dbUser.session_version || 1), sub: dbUser.id })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt(now).setExpirationTime(now + 30 * 60)
      .sign(new TextEncoder().encode(JWT_SECRET));

    const refreshToken = await issueRefreshToken(supabaseAdmin, dbUser.id, req.headers.get('user-agent'));

    return json({ token: jwt, refreshToken, user: dbUser }, 200, origin);
  } catch (err: any) {
    return json({ error: err?.message || 'Unknown error' }, 400, origin);
  }
})
