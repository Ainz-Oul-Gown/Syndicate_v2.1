import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { verifyRegistrationResponse } from 'npm:@simplewebauthn/server'
import { encodeBase64Url } from 'https://deno.land/std@0.224.0/encoding/base64url.ts'
import {
  consumeRegistrationInvite, corsHeaders, createAdminClient, issueUserToken,
  json, normalizePublicKeysPayload, verifySyndicateToken,
} from '../_shared/provider-auth.ts'

function readBearer(req: Request) {
  const header = req.headers.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { stableId, name, response, publicKeysPayload, registrationInvite } = await req.json()
    if (!Number.isSafeInteger(stableId) || stableId <= 0) throw new Error('Некорректный ID пользователя')
    if (!response || typeof response !== 'object') throw new Error('Отсутствует ответ Passkey')
    const admin = createAdminClient()

    const { data: challengeRow, error: readError } = await admin
      .from('auth_challenges').select('challenge').eq('id', `reg_${stableId}`).maybeSingle()
    if (readError) throw readError
    if (!challengeRow?.challenge) throw new Error('Challenge отсутствует или уже использован')
    const { data: consumed, error: consumeError } = await admin
      .from('auth_challenges')
      .delete()
      .eq('id', `reg_${stableId}`)
      .eq('challenge', challengeRow.challenge)
      .select('challenge')
      .maybeSingle()
    if (consumeError) throw consumeError
    if (!consumed) throw new Error('Challenge уже использован')

    let record: any
    try { record = JSON.parse(challengeRow.challenge) } catch { throw new Error('Устаревший Passkey challenge. Запросите новый') }
    if (record?.version !== 2 || record?.stableId !== stableId) throw new Error('Некорректный Passkey challenge')
    if (!record?.expiresAt || Date.parse(record.expiresAt) <= Date.now()) throw new Error('Passkey challenge истёк')
    const requestOrigin = req.headers.get('origin') || 'http://localhost:3000'
    if (requestOrigin !== record.origin) throw new Error('Origin не совпадает с challenge')

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: record.challenge,
      expectedOrigin: record.origin,
      expectedRPID: record.rpID,
    })
    if (!verification.verified || !verification.registrationInfo) throw new Error('Регистрация Passkey не подтверждена')

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
    // Ensure transports always contains ['internal'] for platform authenticators.
    // An empty transports array causes the browser to treat any authenticator (including
    // USB/NFC keys) as valid during authentication, showing the wrong dialog.
    const rawTransports = credential.transports || response.response?.transports || []
    const transports = rawTransports.length > 0 ? rawTransports : ['internal']
    const newCredential = {
      id: credential.id,
      publicKey: encodeBase64Url(credential.publicKey),
      counter: credential.counter,
      transports,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    }

    const { data: existingUser, error: userError } = await admin
      .from('users')
      .select('id, tg_id, first_name, status, account_state, public_key, session_version, created_at')
      .eq('tg_id', stableId)
      .maybeSingle()
    if (userError) throw userError

    let finalUser: any
    if (existingUser) {
      if (record.purpose !== 'add-passkey' || record.userId !== existingUser.id) throw new Error('Challenge не предназначен для этого профиля')
      const identity = await verifySyndicateToken(readBearer(req))
      const state = existingUser.account_state || (existingUser.status === 'blocked' ? 'blocked' : 'active')
      if (identity.userId !== existingUser.id || identity.stableId !== stableId) throw new Error('Нельзя добавить Passkey другому пользователю')
      if (identity.sessionVersion !== Number(existingUser.session_version || 1)) throw new Error('Сессия отозвана')
      if (state !== 'active' || existingUser.status === 'blocked') throw new Error('Аккаунт недоступен')

      let payload: any
      try { payload = JSON.parse(existingUser.public_key || '{}') } catch { throw new Error('Повреждён контейнер публичных ключей') }
      if (!Array.isArray(payload.passkeys)) payload.passkeys = []
      if (payload.passkeys.some((item: any) => item.id === newCredential.id)) throw new Error('Этот Passkey уже зарегистрирован')
      payload.passkeys.push(newCredential)

      const { data, error } = await admin
        .from('users')
        .update({ public_key: JSON.stringify(payload) })
        .eq('id', existingUser.id)
        .select('id, tg_id, first_name, status, account_state, public_key, session_version, created_at')
        .single()
      if (error) throw error
      finalUser = data
    } else {
      if (record.purpose !== 'register-passkey' || record.userId !== null) throw new Error('Challenge не предназначен для регистрации')
      await consumeRegistrationInvite(admin, registrationInvite)
      const normalizedKeys = normalizePublicKeysPayload(publicKeysPayload)
      if (!normalizedKeys) throw new Error('Для регистрации требуется контейнер ключей')
      let payload: any
      try { payload = JSON.parse(normalizedKeys) } catch { throw new Error('Некорректный контейнер ключей') }
      payload.passkeys = Array.isArray(payload.passkeys) ? payload.passkeys : []
      payload.passkeys.push(newCredential)

      const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : 'User'
      const { data, error } = await admin
        .from('users')
        .insert({ tg_id: stableId, first_name: cleanName, public_key: JSON.stringify(payload), status: 'free' })
        .select('id, tg_id, first_name, status, account_state, public_key, session_version, created_at')
        .single()
      if (error) throw error
      finalUser = data
    }

    const token = await issueUserToken(finalUser, 'passkey')
    return json({ verified: true, token, user: finalUser })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось зарегистрировать Passkey' }, 400)
  }
})
