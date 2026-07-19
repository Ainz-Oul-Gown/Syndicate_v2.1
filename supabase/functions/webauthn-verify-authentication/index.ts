import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { verifyAuthenticationResponse } from 'npm:@simplewebauthn/server'
import { decodeBase64Url } from 'https://deno.land/std@0.224.0/encoding/base64url.ts'
import { corsHeaders, createAdminClient, issueUserToken, json, prepareUserForAuthentication } from '../_shared/provider-auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { stableId, response } = await req.json()
    if (!Number.isSafeInteger(stableId) || stableId <= 0) throw new Error('Некорректный ID пользователя')
    if (!response || typeof response !== 'object') throw new Error('Отсутствует ответ Passkey')
    const admin = createAdminClient()

    const { data: challengeRow, error: readError } = await admin
      .from('auth_challenges').select('challenge').eq('id', `auth_${stableId}`).maybeSingle()
    if (readError) throw readError
    if (!challengeRow?.challenge) throw new Error('Challenge отсутствует или уже использован')
    const { data: consumed, error: consumeError } = await admin
      .from('auth_challenges')
      .delete()
      .eq('id', `auth_${stableId}`)
      .eq('challenge', challengeRow.challenge)
      .select('challenge')
      .maybeSingle()
    if (consumeError) throw consumeError
    if (!consumed) throw new Error('Challenge уже использован')

    let record: any
    try { record = JSON.parse(challengeRow.challenge) } catch { throw new Error('Устаревший Passkey challenge. Запросите новый') }
    if (record?.version !== 2 || record?.purpose !== 'passkey-login' || record?.stableId !== stableId) {
      throw new Error('Некорректный Passkey challenge')
    }
    if (!record?.expiresAt || Date.parse(record.expiresAt) <= Date.now()) throw new Error('Passkey challenge истёк')
    const requestOrigin = req.headers.get('origin') || 'http://localhost:3000'
    if (requestOrigin !== record.origin) throw new Error('Origin не совпадает с challenge')

    const { data: user, error: userError } = await admin
      .from('users')
      .select('id, tg_id, first_name, status, account_state, deactivated_at, public_key, session_version, created_at')
      .eq('tg_id', stableId)
      .maybeSingle()
    if (userError) throw userError
    if (!user || user.id !== record.userId) throw new Error('Пользователь не найден')
    const state = user.account_state || (user.status === 'blocked' ? 'blocked' : 'active')
    if (state === 'blocked' || state === 'deleted' || user.status === 'blocked') throw new Error('Аккаунт заблокирован')

    let payload: any
    try { payload = JSON.parse(user.public_key || '{}') } catch { throw new Error('Повреждён контейнер публичных ключей') }
    const passkeys = Array.isArray(payload.passkeys) ? payload.passkeys : []
    const credential = passkeys.find((item: any) => item.id === response.id)
    if (!credential) throw new Error('Passkey не принадлежит этому аккаунту')

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: record.challenge,
      expectedOrigin: record.origin,
      expectedRPID: record.rpID,
      credential: {
        id: credential.id,
        publicKey: decodeBase64Url(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
      },
    })
    if (!verification.verified || !verification.authenticationInfo) throw new Error('Passkey не прошёл проверку')

    credential.counter = verification.authenticationInfo.newCounter
    const { data: updated, error: updateError } = await admin
      .from('users')
      .update({ public_key: JSON.stringify(payload) })
      .eq('id', user.id)
      .select('id, tg_id, first_name, status, account_state, deactivated_at, public_key, session_version, created_at')
      .single()
    if (updateError) throw updateError

    const effectiveUser = await prepareUserForAuthentication(admin, updated)
    const token = await issueUserToken(effectiveUser, 'passkey')
    return json({ verified: true, token, user: effectiveUser })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось войти по Passkey' }, 400)
  }
})
