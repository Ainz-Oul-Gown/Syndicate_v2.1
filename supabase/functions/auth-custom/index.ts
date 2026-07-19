import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as jose from 'https://deno.land/x/jose@v4.14.4/index.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

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
    const jwt = await new jose.SignJWT({ aud: 'authenticated', role: 'authenticated', iss: 'supabase', tg_id: stableId, session_version: Number(dbUser.session_version || 1), sub: dbUser.id })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt(now).setExpirationTime(now + 60 * 60 * 24 * 7)
      .sign(new TextEncoder().encode(JWT_SECRET));

    return new Response(JSON.stringify({ token: jwt, user: dbUser }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Unknown error' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
})
