import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, createAdminClient, json } from '../_shared/provider-auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { stableId } = await req.json();
    if (!Number.isSafeInteger(stableId) || stableId <= 0) throw new Error('Некорректный идентификатор пользователя');

    const supabaseAdmin = createAdminClient();
    const { data: dbUser, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, public_key, status, account_state')
      .eq('tg_id', stableId)
      .maybeSingle();
    if (userError) throw userError;
    // Единый generic-ответ для всех случаев (не найден / заблокирован / нет ключа)
    // Предотвращает user enumeration (В1)
    if (!dbUser) throw new Error('Не удалось подготовить запрос');
    const accountState = dbUser.account_state || (dbUser.status === 'blocked' ? 'blocked' : 'active');
    if (accountState === 'blocked' || accountState === 'deleted' || dbUser.status === 'blocked') {
      throw new Error('Не удалось подготовить запрос');
    }

    let payload: any;
    try { payload = JSON.parse(dbUser.public_key || '{}'); } catch { throw new Error('Не удалось подготовить запрос'); }
    if (!payload?.legacy?.ecdsa) throw new Error('Не удалось подготовить запрос');

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
