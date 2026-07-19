import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import {
  allocateStableId, bindIdentity, consumeRegistrationInvite, corsHeaders,
  createAdminClient, findUserByCandidateIds, getIdentityUser, issueUserToken,
  json, normalizePublicKeysPayload, prepareUserForAuthentication, stableNumericId,
  unwrapProviderVaultSecret, wrapProviderVaultSecret,
} from '../_shared/provider-auth.ts'

function normalizeUsername(value: unknown) {
  const username = typeof value === 'string' ? value.trim().toLowerCase().replace(/^@/, '') : ''
  if (!/^[a-z0-9_]{5,32}$/.test(username)) throw new Error('Некорректный Telegram Username')
  return username
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const body = await req.json()
    const username = normalizeUsername(body.username)
    const otp = typeof body.otp === 'string' ? body.otp.trim() : ''
    const isRegister = body.isRegister === true
    if (!/^\d{6}$/.test(otp)) throw new Error('Код должен состоять из 6 цифр')

    const supabaseAdmin = createAdminClient()
    const challengeId = `tg_otp_${username}`
    const { data: challengeRow, error: readError } = await supabaseAdmin
      .from('auth_challenges').select('challenge').eq('id', challengeId).maybeSingle()
    if (readError) throw readError
    if (!challengeRow?.challenge) throw new Error('Код подтверждения не найден или уже использован')

    const { data: consumed, error: consumeError } = await supabaseAdmin
      .from('auth_challenges').delete().eq('id', challengeId).eq('challenge', challengeRow.challenge)
      .select('challenge').maybeSingle()
    if (consumeError) throw consumeError
    if (!consumed) throw new Error('Код подтверждения уже использован')

    let telegramUserId = ''
    let valid = false
    try {
      const parsed = JSON.parse(challengeRow.challenge)
      const secret = Deno.env.get('TELEGRAM_OTP_SECRET')
      if (!secret) throw new Error('Не настроен TELEGRAM_OTP_SECRET')
      if (parsed?.version !== 2 || typeof parsed.telegramUserId !== 'string') throw new Error('Unsupported challenge')
      const issuedAt = Number(parsed.issuedAt)
      const expiresAt = Number(parsed.expiresAt)
      const challengeUsername = normalizeUsername(parsed.username)
      telegramUserId = parsed.telegramUserId
      if (challengeUsername !== username) throw new Error('Username mismatch')
      if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || Date.now() > expiresAt || issuedAt > Date.now() + 60_000) {
        throw new Error('Срок действия кода истёк')
      }
      const digest = await hmacHex(secret, `${challengeId}:${otp}:${issuedAt}:${telegramUserId}`)
      valid = constantTimeEqual(digest, String(parsed.otpDigest || ''))
    } catch (error: any) {
      if (error?.message === 'Срок действия кода истёк') throw error
      if (Deno.env.get('ALLOW_LEGACY_TELEGRAM_OTP') === 'true') {
        const [legacyOtp, timestampRaw] = String(challengeRow.challenge).split(':')
        const timestamp = Number(timestampRaw)
        telegramUserId = `legacy:${username}`
        valid = legacyOtp === otp && Number.isFinite(timestamp) && Date.now() - timestamp <= 10 * 60 * 1000
      } else {
        throw new Error('Бот использует устаревший формат OTP. Обновите telegram-bot.js')
      }
    }
    if (!valid) throw new Error('Неверный одноразовый код')

    const subject = telegramUserId
    let { identity, user } = await getIdentityUser(supabaseAdmin, 'telegram', subject)
    const legacySeed = `telegram mini app ecosystem session sync node key ${username}`

    if (isRegister) {
      if (user) throw new Error('Этот Telegram-аккаунт уже зарегистрирован')
      await consumeRegistrationInvite(supabaseAdmin, body.registrationInvite)
      const publicKey = normalizePublicKeysPayload(body.publicKeysPayload)
      if (!publicKey) throw new Error('Для регистрации требуется контейнер ключей')
      const wrappedVaultSecret = await wrapProviderVaultSecret(body.providerVaultSecret)
      const stableId = await allocateStableId(supabaseAdmin, [legacySeed, `telegram:${subject}`, `${subject}:${crypto.randomUUID()}`])
      const requestedName = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
      const { data: createdUser, error: createError } = await supabaseAdmin.from('users').insert({
        tg_id: stableId, first_name: requestedName || `@${username}`,
        public_key: publicKey, status: 'free',
      }).select('id, tg_id, first_name, status, public_key, session_version, created_at').single()
      if (createError) throw createError
      try {
        await bindIdentity(supabaseAdmin, {
          userId: createdUser.id, provider: 'telegram', subject, username, wrappedVaultSecret,
        })
      } catch (error) {
        await supabaseAdmin.from('users').delete().eq('id', createdUser.id)
        throw error
      }
      user = createdUser
      identity = { provider_username: username, provider_email: null, wrapped_vault_secret: wrappedVaultSecret }
    } else if (!user) {
      const legacyUser = await findUserByCandidateIds(supabaseAdmin, [stableNumericId(legacySeed)])
      if (!legacyUser) throw new Error('Этот Telegram-аккаунт не зарегистрирован')
      await bindIdentity(supabaseAdmin, { userId: legacyUser.id, provider: 'telegram', subject, username })
      user = legacyUser
      identity = { provider_username: username, provider_email: null, wrapped_vault_secret: null }
    }

    user = await prepareUserForAuthentication(supabaseAdmin, user)

    const vaultSecret = identity?.wrapped_vault_secret
      ? await unwrapProviderVaultSecret(identity.wrapped_vault_secret)
      : null
    const providerKeyId = identity?.provider_username || username
    const token = await issueUserToken(user, 'telegram')
    return json({
      token, stableId: user.tg_id, user,
      provider: { username, keyId: providerKeyId, vaultSecret, needsVaultMigration: !vaultSecret },
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка Telegram-аутентификации' }, 400)
  }
})
