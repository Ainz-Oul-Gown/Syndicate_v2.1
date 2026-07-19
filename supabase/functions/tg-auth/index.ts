import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import {
  allocateStableId,
  bindIdentity,
  consumeRegistrationInvite,
  corsHeaders,
  createAdminClient,
  findUserByCandidateIds,
  getIdentityUser,
  issueUserToken,
  json,
  normalizePublicKeysPayload,
  prepareUserForAuthentication,
  stableNumericId,
  unwrapProviderVaultSecret,
  wrapProviderVaultSecret,
} from '../_shared/provider-auth.ts'

type TelegramUser = {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
  photo_url?: string
}

const encoder = new TextEncoder()

function normalizeTelegramUser(raw: unknown): TelegramUser {
  if (!raw || typeof raw !== 'object') throw new Error('Telegram не передал данные пользователя')
  const value = raw as Record<string, unknown>
  const id = Number(value.id)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Некорректный Telegram ID')
  const firstName = typeof value.first_name === 'string' ? value.first_name.trim().slice(0, 120) : ''
  if (!firstName) throw new Error('Telegram не передал имя пользователя')
  const usernameRaw = typeof value.username === 'string' ? value.username.trim().replace(/^@/, '') : ''
  const username = usernameRaw && /^[A-Za-z0-9_]{5,32}$/.test(usernameRaw) ? usernameRaw.toLowerCase() : undefined
  const lastName = typeof value.last_name === 'string' ? value.last_name.trim().slice(0, 120) || undefined : undefined
  const languageCode = typeof value.language_code === 'string' ? value.language_code.slice(0, 16) : undefined
  const photoUrl = typeof value.photo_url === 'string' && value.photo_url.length <= 2048 ? value.photo_url : undefined
  return {
    id,
    first_name: firstName,
    last_name: lastName,
    username,
    language_code: languageCode,
    is_premium: value.is_premium === true,
    photo_url: photoUrl,
  }
}

function telegramProfile(user: TelegramUser) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name || null,
    username: user.username || null,
    languageCode: user.language_code || null,
    isPremium: user.is_premium === true,
    photoUrl: user.photo_url || null,
  }
}

function hexToBytes(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Некорректная подпись Telegram')
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

async function validateInitData(initData: unknown) {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!botToken) throw new Error('Не настроен TELEGRAM_BOT_TOKEN')
  if (typeof initData !== 'string' || initData.length < 20 || initData.length > 16_384) {
    throw new Error('Некорректные данные Telegram Mini App')
  }

  const params = new URLSearchParams(initData)
  const hash = params.get('hash') || ''
  const authDate = Number(params.get('auth_date'))
  const userJson = params.get('user')
  if (!hash || !Number.isSafeInteger(authDate) || !userJson) {
    throw new Error('Telegram Mini App передал неполные данные')
  }

  const now = Math.floor(Date.now() / 1000)
  const maxAgeRaw = Number(Deno.env.get('TELEGRAM_INIT_DATA_MAX_AGE_SECONDS') || '900')
  const maxAge = Number.isFinite(maxAgeRaw) ? Math.min(Math.max(Math.trunc(maxAgeRaw), 60), 3600) : 300
  if (authDate > now + 60 || now - authDate > maxAge) {
    throw new Error('Сессия Telegram Mini App устарела. Откройте приложение заново')
  }

  params.delete('hash')
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const webAppDataKey = await crypto.subtle.importKey(
    'raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const secret = await crypto.subtle.sign('HMAC', webAppDataKey, encoder.encode(botToken))
  const verificationKey = await crypto.subtle.importKey(
    'raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  )
  const valid = await crypto.subtle.verify(
    'HMAC', verificationKey, hexToBytes(hash), encoder.encode(dataCheckString),
  )
  if (!valid) throw new Error('Telegram Mini App передал поддельные данные')

  let parsedUser: unknown
  try { parsedUser = JSON.parse(userJson) } catch { throw new Error('Повреждены данные пользователя Telegram') }
  return { user: normalizeTelegramUser(parsedUser), authDate, queryId: params.get('query_id') || null }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const contentLength = Number(req.headers.get('content-length') || '0')
    if (contentLength > 300_000) return json({ error: 'Слишком большой запрос' }, 413)

    const body = await req.json()
    const { user: telegramUser } = await validateInitData(body.initData)
    const isRegister = body.isRegister === true
    const subject = String(telegramUser.id)
    const supabaseAdmin = createAdminClient()
    let { identity, user } = await getIdentityUser(supabaseAdmin, 'telegram', subject)

    if (!user && !isRegister) {
      const candidateIds = [telegramUser.id]
      if (telegramUser.username) {
        candidateIds.push(stableNumericId(`telegram mini app ecosystem session sync node key ${telegramUser.username}`))
      }
      candidateIds.push(stableNumericId(`telegram:${subject}`))
      const legacyUser = await findUserByCandidateIds(supabaseAdmin, candidateIds)
      if (legacyUser) {
        await bindIdentity(supabaseAdmin, {
          userId: legacyUser.id,
          provider: 'telegram',
          subject,
          username: telegramUser.username || null,
        })
        user = legacyUser
        identity = {
          provider_username: telegramUser.username || null,
          provider_email: null,
          wrapped_vault_secret: null,
        }
      }
    }

    if (!user && !isRegister) {
      return json({ registrationRequired: true, telegram: telegramProfile(telegramUser) })
    }

    if (isRegister) {
      if (user) throw new Error('Этот Telegram-аккаунт уже зарегистрирован')
      const publicKey = normalizePublicKeysPayload(body.publicKeysPayload)
      if (!publicKey) throw new Error('Для регистрации требуется контейнер ключей')
      const wrappedVaultSecret = await wrapProviderVaultSecret(body.providerVaultSecret)
      const requestedName = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
      const displayName = requestedName || [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ')
      const stableId = await allocateStableId(supabaseAdmin, [
        `telegram:${subject}`,
        ...(telegramUser.username ? [`telegram mini app ecosystem session sync node key ${telegramUser.username}`] : []),
        `${subject}:${crypto.randomUUID()}`,
      ])
      await consumeRegistrationInvite(supabaseAdmin, body.registrationInvite)

      const { data: createdUser, error: createError } = await supabaseAdmin.from('users').insert({
        tg_id: stableId,
        first_name: displayName,
        public_key: publicKey,
        status: 'free',
      }).select('id, tg_id, first_name, status, account_state, deactivated_at, public_key, session_version, created_at').single()
      if (createError) throw createError

      try {
        await bindIdentity(supabaseAdmin, {
          userId: createdUser.id,
          provider: 'telegram',
          subject,
          username: telegramUser.username || null,
          wrappedVaultSecret,
        })
      } catch (error) {
        await supabaseAdmin.from('users').delete().eq('id', createdUser.id)
        throw error
      }
      user = createdUser
      identity = {
        provider_username: telegramUser.username || null,
        provider_email: null,
        wrapped_vault_secret: wrappedVaultSecret,
      }
    }

    user = await prepareUserForAuthentication(supabaseAdmin, user)
    const vaultSecret = identity?.wrapped_vault_secret
      ? await unwrapProviderVaultSecret(identity.wrapped_vault_secret)
      : null
    const token = await issueUserToken(user, 'telegram')

    return json({
      token,
      stableId: user.tg_id,
      id: user.tg_id,
      first_name: user.first_name,
      user,
      telegram: telegramProfile(telegramUser),
      provider: {
        telegramId: subject,
        username: telegramUser.username || identity?.provider_username || null,
        vaultSecret,
        needsVaultMigration: !vaultSecret,
      },
    })
  } catch (error: any) {
    const message = error?.message || 'Ошибка Telegram Mini App-аутентификации'
    const status = /поддельные|подпись/i.test(message) ? 403 : /устарела/i.test(message) ? 401 : 400
    return json({ error: message }, status)
  }
})
