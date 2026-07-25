import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { generateAuthenticationOptions } from 'npm:@simplewebauthn/server'
import { getCorsHeaders, createAdminClient, json, checkRateLimit, recordAuthAttempt } from '../_shared/provider-auth.ts'

serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin)

  try {
    const { stableId } = await req.json()
    if (!Number.isSafeInteger(stableId) || stableId <= 0) throw new Error('Некорректный ID пользователя')
    const requestOrigin = req.headers.get('origin') || 'http://localhost:3000'
    const rpID = new URL(requestOrigin).hostname
    const admin = createAdminClient()

    // В1: Rate-limit по IP — не более 10 запросов challenge за 10 минут
    const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
    const ipOk = await checkRateLimit(admin, `webauthn_challenge:${clientIp}`, 'challenge_ip', 10, 10)
    if (!ipOk) {
      await recordAuthAttempt(admin, `webauthn_challenge:${clientIp}`, 'challenge_ip', false)
      throw new Error('Не удалось подготовить запрос')
    }

    // В1: Rate-limit по stableId — не более 5 запросов challenge за 10 минут
    // Защита от DoS через overwrite challenge
    const stableIdOk = await checkRateLimit(admin, `webauthn_challenge:${stableId}`, 'challenge_stable', 5, 10)
    if (!stableIdOk) {
      await recordAuthAttempt(admin, `webauthn_challenge:${stableId}`, 'challenge_stable', false)
      throw new Error('Не удалось подготовить запрос')
    }

    await recordAuthAttempt(admin, `webauthn_challenge:${clientIp}`, 'challenge_ip', true)

    const { data: user, error } = await admin
      .from('users')
      .select('id, public_key, status, account_state')
      .eq('tg_id', stableId)
      .maybeSingle()
    if (error) throw error
    // Единый generic-ответ — предотвращает user enumeration (В1)
    if (!user) throw new Error('Не удалось подготовить запрос')
    const state = user.account_state || (user.status === 'blocked' ? 'blocked' : 'active')
    if (state === 'blocked' || state === 'deleted' || user.status === 'blocked') throw new Error('Не удалось подготовить запрос')

    let payload: any
    try { payload = JSON.parse(user.public_key || '{}') } catch { throw new Error('Не удалось подготовить запрос') }
    const passkeys = Array.isArray(payload.passkeys) ? payload.passkeys : []
    if (!passkeys.length) throw new Error('Не удалось подготовить запрос')

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: passkeys.map((credential: any) => ({
        id: credential.id,
        transports: credential.transports?.length ? credential.transports : ['internal'],
      })),
      userVerification: 'preferred',
    })

    const record = JSON.stringify({
      version: 2,
      purpose: 'passkey-login',
      challenge: options.challenge,
      stableId,
      userId: user.id,
      origin: requestOrigin,
      rpID,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
    const { error: challengeError } = await admin.from('auth_challenges').upsert({
      id: `auth_${stableId}`,
      challenge: record,
      updated_at: new Date().toISOString(),
    })
    if (challengeError) throw challengeError

    return json(options, 200, origin)
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось создать Passkey challenge' }, 400, origin)
  }
})
