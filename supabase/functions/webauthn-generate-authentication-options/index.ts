import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { generateAuthenticationOptions } from 'npm:@simplewebauthn/server'
import { corsHeaders, createAdminClient, json } from '../_shared/provider-auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { stableId } = await req.json()
    if (!Number.isSafeInteger(stableId) || stableId <= 0) throw new Error('Некорректный ID пользователя')
    const origin = req.headers.get('origin') || 'http://localhost:3000'
    const rpID = new URL(origin).hostname
    const admin = createAdminClient()

    const { data: user, error } = await admin
      .from('users')
      .select('id, public_key, status, account_state')
      .eq('tg_id', stableId)
      .maybeSingle()
    if (error) throw error
    if (!user) throw new Error('Пользователь не найден')
    const state = user.account_state || (user.status === 'blocked' ? 'blocked' : 'active')
    if (state === 'blocked' || state === 'deleted' || user.status === 'blocked') throw new Error('Аккаунт заблокирован')

    let payload: any
    try { payload = JSON.parse(user.public_key || '{}') } catch { throw new Error('Повреждён контейнер публичных ключей') }
    const passkeys = Array.isArray(payload.passkeys) ? payload.passkeys : []
    if (!passkeys.length) throw new Error('Для аккаунта не зарегистрирован Passkey')

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: passkeys.map((credential: any) => ({
        id: credential.id,
        transports: credential.transports,
      })),
      userVerification: 'preferred',
    })

    const record = JSON.stringify({
      version: 2,
      purpose: 'passkey-login',
      challenge: options.challenge,
      stableId,
      userId: user.id,
      origin,
      rpID,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
    const { error: challengeError } = await admin.from('auth_challenges').upsert({
      id: `auth_${stableId}`,
      challenge: record,
      updated_at: new Date().toISOString(),
    })
    if (challengeError) throw challengeError

    return json(options)
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось создать Passkey challenge' }, 400)
  }
})
