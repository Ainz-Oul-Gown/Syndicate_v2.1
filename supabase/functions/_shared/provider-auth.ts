import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7'
import * as jose from 'https://deno.land/x/jose@v4.14.4/index.ts'

export function getCorsHeaders(origin?: string | null) {
  const allowed = Deno.env.get('ALLOWED_ORIGINS')
  let allowOrigin = '*'
  if (allowed && origin) {
    const origins = allowed.split(',').map((o) => o.trim()).filter(Boolean)
    if (origins.includes(origin)) {
      allowOrigin = origin
    }
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-refresh-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
  }
}

/** @deprecated Используй getCorsHeaders(req.headers.get('Origin')) */
export const corsHeaders = getCorsHeaders()

export function json(body: unknown, status = 200, origin?: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export function createAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) throw new Error('Не настроены серверные переменные Supabase')
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

/**
 * С1: stableNumericId.
 * Без pepper: хэш предсказуем из username/email → enumeration ( Accepted tradeoff).
 * Pepper НЕ добавляется — клиентский getStableNumericId() не имеет pepper,
 * и расхождение сломает вход для ВСЕХ существующих пользователей.
 * Решение С1 отложено до введения миграции с пересчётом stableId.
 */
export function stableNumericId(value: string): number {
  let hash = 0
  const clean = value.trim().toLowerCase()
  for (let index = 0; index < clean.length; index += 1) {
    hash = ((hash << 5) - hash + clean.charCodeAt(index)) | 0
  }
  return Math.abs(hash) + 100_000_000
}

/**
 * С4: JSON-schema валидация контейнера ключей.
 * Проверяет наличие корректных JWK-полей (kty, crv/n/e/x/y) для RSA и ECDSA.
 */
export function normalizePublicKeysPayload(value: unknown): string | null {
  if (value == null) return null
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  if (serialized.length > 250_000) throw new Error('Контейнер ключей слишком большой')
  let parsed: any
  try { parsed = JSON.parse(serialized) } catch { throw new Error('Некорректный формат контейнера ключей') }
  if (!parsed || typeof parsed !== 'object') throw new Error('Некорректный формат контейнера ключей')

  // С4: Валидация структуры JWK для legacy/master ключей
  function validateJwk(jwk: any, slotName: string) {
    if (!jwk || typeof jwk !== 'object') return // опциональный слот
    if (typeof jwk.kty !== 'string') throw new Error(`${slotName}: отсутствует поле kty`)
    if (jwk.kty === 'RSA') {
      if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
        throw new Error(`${slotName}: RSA-ключ должен содержать n и e`)
      }
    } else if (jwk.kty === 'EC') {
      if (typeof jwk.crv !== 'string' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
        throw new Error(`${slotName}: EC-ключ должен содержать crv, x и y`)
      }
    } else {
      throw new Error(`${slotName}: неподдерживаемый тип ключа ${jwk.kty}`)
    }
  }

  // Проверяем legacy ECDSA если есть
  if (parsed.legacy?.ecdsa) validateJwk(parsed.legacy.ecdsa, 'legacy.ecdsa')
  if (parsed.legacy?.rsa) validateJwk(parsed.legacy.rsa, 'legacy.rsa')
  // Проверяем master ключи если есть
  if (parsed.master?.ecdsa) validateJwk(parsed.master.ecdsa, 'master.ecdsa')
  if (parsed.master?.rsa) validateJwk(parsed.master.rsa, 'master.rsa')
  // Проверяем passkeys если есть
  if (Array.isArray(parsed.passkeys)) {
    for (let i = 0; i < parsed.passkeys.length; i++) {
      const pk = parsed.passkeys[i]
      if (!pk?.id || !pk?.publicKey) throw new Error(`passkeys[${i}]: отсутствуют id или publicKey`)
    }
  }

  return serialized
}

/**
 * С5: Поиск подписывающего ECDSA ключа в контейнере.
 * Проверяет оба слота: master (приоритет) и legacy.
 * Возвращает JWK или бросает ошибку.
 */
export function findEcdsaSigningKey(publicKeyPayload: any): any {
  const jwk = publicKeyPayload?.master?.ecdsa || publicKeyPayload?.legacy?.ecdsa
  if (!jwk) throw new Error('Ключ подписи не настроен')
  return jwk
}

/**
 * С5: Поиск RSA ключа для расшифровки.
 * Проверяет оба слота: master (приоритет) и legacy.
 */
export function findRsaDecryptionKey(publicKeyPayload: any): any {
  const jwk = publicKeyPayload?.master?.rsa || publicKeyPayload?.legacy?.rsa
  return jwk || null
}

export async function consumeRegistrationInvite(supabaseAdmin: any, rawCode: unknown, consumedBy?: number) {
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : ''
  if (!/^SYND-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) throw new Error('Требуется действующий код приглашения')
  const { data, error } = await supabaseAdmin
    .from('registration_invites')
    .update({ consumed_at: new Date().toISOString(), consumed_by: consumedBy || null })
    .eq('code', code).is('consumed_at', null).select('id').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Неверный или уже использованный код приглашения')
}

// К2: Access-токен живёт 30 минут (вместо 7 дней) — окно атаки при XSS сокращено в 336 раз
const ACCESS_TOKEN_TTL_SECONDS = 30 * 60 // 30 минут

export async function issueUserToken(user: any, provider: string) {
  const state = user?.account_state || (user?.status === 'blocked' ? 'blocked' : 'active')
  if (state !== 'active' || user?.status === 'blocked') throw new Error('Аккаунт недоступен для входа')
  const jwtSecret = Deno.env.get('JWT_SECRET')
  if (!jwtSecret) throw new Error('Не настроен JWT_SECRET')
  const now = Math.floor(Date.now() / 1000)
  return await new jose.SignJWT({
    aud: 'authenticated', role: 'authenticated', iss: 'supabase',
    tg_id: user.tg_id, auth_provider: provider, session_version: Number(user.session_version || 1), sub: user.id,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(jwtSecret))
}

/**
 * К2: Выдаёт refresh-токен (криптографически стойкий случайный токен).
 * Хранится в БД как SHA-256 хэш. Возвращается в открытом виде клиенту.
 * @returns refresh-токен (hex-строка, 96 символов)
 */
export async function issueRefreshToken(
  supabaseAdmin: any,
  userId: string,
  userAgent?: string | null,
): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('issue_refresh_token', {
    p_user_id: userId,
    p_user_agent: userAgent || null,
  })
  if (error) throw new Error('Не удалось выдать refresh-токен')
  return data as string
}

/**
 * К2: Верифицирует refresh-токен и возвращает userId.
 */
export async function verifyRefreshToken(
  supabaseAdmin: any,
  refreshToken: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc('verify_refresh_token', {
    p_token: refreshToken,
  })
  if (error) return null
  return (data as string) || null
}

/**
 * К2: Отзывает refresh-токен.
 */
export async function revokeRefreshToken(
  supabaseAdmin: any,
  refreshToken: string,
): Promise<void> {
  await supabaseAdmin.rpc('revoke_refresh_token', { p_token: refreshToken })
}

export async function getIdentityUser(supabaseAdmin: any, provider: string, subject: string) {
  const { data: identity, error: identityError } = await supabaseAdmin
    .from('user_identities')
    .select('user_id, provider_email, provider_username, wrapped_vault_secret')
    .eq('provider', provider).eq('provider_subject', subject).maybeSingle()
  if (identityError) throw identityError
  if (!identity) return { identity: null, user: null }

  const { data: user, error: userError } = await supabaseAdmin
    .from('users').select('id, tg_id, first_name, status, account_state, deactivated_at, public_key, session_version, created_at').eq('id', identity.user_id).maybeSingle()
  if (userError) throw userError
  if (!user) throw new Error('Связанный профиль пользователя не найден')
  return { identity, user }
}


export async function prepareUserForAuthentication(supabaseAdmin: any, user: any) {
  if (!user) throw new Error('Пользователь не найден')
  const state = user.account_state || (user.status === 'blocked' ? 'blocked' : 'active')
  if (state === 'blocked' || state === 'deleted' || user.status === 'blocked') {
    throw new Error('Аккаунт заблокирован')
  }
  if (state !== 'deactivated') return user

  const nextVersion = Number(user.session_version || 1) + 1
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ account_state: 'active', deactivated_at: null, session_version: nextVersion })
    .eq('id', user.id)
    .eq('account_state', 'deactivated')
    .select('id, tg_id, first_name, status, account_state, deactivated_at, public_key, session_version, created_at')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Не удалось восстановить аккаунт')
  return data
}

export async function bindIdentity(
  supabaseAdmin: any,
  values: {
    userId: string
    provider: string
    subject: string
    email?: string | null
    username?: string | null
    wrappedVaultSecret?: string | null
  },
) {
  const { error } = await supabaseAdmin.from('user_identities').insert({
    user_id: values.userId,
    provider: values.provider,
    provider_subject: values.subject,
    provider_email: values.email || null,
    provider_username: values.username || null,
    wrapped_vault_secret: values.wrappedVaultSecret || null,
  })
  if (error) {
    if (error.code === '23505') throw new Error('Эта учётная запись провайдера уже привязана')
    throw error
  }
}

export async function findUserByCandidateIds(supabaseAdmin: any, candidateIds: number[]) {
  const uniqueIds = [...new Set(candidateIds.filter((id) => Number.isSafeInteger(id) && id > 0))]
  if (!uniqueIds.length) return null
  const { data, error } = await supabaseAdmin.from('users').select('id, tg_id, first_name, status, account_state, deactivated_at, public_key, session_version, created_at').in('tg_id', uniqueIds)
  if (error) throw error
  if (!data?.length) return null
  return uniqueIds.map((id) => data.find((user: any) => user.tg_id === id)).find(Boolean) || null
}

export async function allocateStableId(supabaseAdmin: any, seeds: string[]) {
  for (const seed of seeds) {
    const candidate = stableNumericId(seed)
    const { data, error } = await supabaseAdmin.from('users').select('id').eq('tg_id', candidate).maybeSingle()
    if (error) throw error
    if (!data) return candidate
  }
  throw new Error('Не удалось выделить уникальный внутренний идентификатор')
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string) {
  let binary = ''
  try { binary = atob(value) } catch { throw new Error('Некорректный base64') }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function getProviderVaultMasterKey() {
  const encoded = Deno.env.get('PROVIDER_VAULT_MASTER_KEY')
  if (!encoded) throw new Error('Не настроен PROVIDER_VAULT_MASTER_KEY')
  const raw = base64ToBytes(encoded.trim())
  if (raw.byteLength !== 32) throw new Error('PROVIDER_VAULT_MASTER_KEY должен содержать 32 байта в base64')
  return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function wrapProviderVaultSecret(secret: unknown) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 512) {
    throw new Error('Некорректный recovery-секрет провайдера')
  }
  const key = await getProviderVaultMasterKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret),
  )
  return JSON.stringify({ version: 1, iv: bytesToBase64(iv), cipher: bytesToBase64(new Uint8Array(cipher)) })
}

export async function unwrapProviderVaultSecret(wrapped: unknown) {
  if (typeof wrapped !== 'string' || wrapped.length > 4096) return null
  let payload: any
  try { payload = JSON.parse(wrapped) } catch { throw new Error('Повреждён recovery-секрет провайдера') }
  if (payload?.version !== 1 || typeof payload.iv !== 'string' || typeof payload.cipher !== 'string') {
    throw new Error('Неподдерживаемый формат recovery-секрета')
  }
  const key = await getProviderVaultMasterKey()
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(payload.iv) }, key, base64ToBytes(payload.cipher),
    )
  } catch {
    throw new Error('Не удалось расшифровать recovery-секрет провайдера')
  }
  return new TextDecoder().decode(plain)
}

/**
 * К4: Проверяет rate-limit для данного идентификатора.
 * Возвращает true если лимит НЕ превышен (можно продолжать).
 */
export async function checkRateLimit(
  supabaseAdmin: any,
  identifier: string,
  attemptType: string,
  maxAttempts = 5,
  windowMinutes = 10,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('check_rate_limit', {
    p_identifier: identifier,
    p_attempt_type: attemptType,
    p_max_attempts: maxAttempts,
    p_window_minutes: windowMinutes,
  })
  if (error) return true // fail-open: если БД недоступна, пропускаем rate-limit
  return data === true
}

/**
 * К4: Записывает попытку аутентификации для rate-limiting.
 */
export async function recordAuthAttempt(
  supabaseAdmin: any,
  identifier: string,
  attemptType: string,
  success = false,
): Promise<void> {
  await supabaseAdmin.rpc('record_auth_attempt', {
    p_identifier: identifier,
    p_attempt_type: attemptType,
    p_success: success,
  })
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * В4: Верификация JWT + централизованная проверка account_state и session_version.
 *
 * Если передан supabaseAdmin — выполняет DB-проверку (account_state, session_version).
 * Если нет — только JWT-верификация (для функций, которые проверяют state самостоятельно).
 *
 * @returns { userId, stableId, provider, sessionVersion, user? }
 *   user возвращается только при передаче supabaseAdmin (для экономии DB-запроса).
 */
export async function verifySyndicateToken(
  token: unknown,
  supabaseAdmin?: any,
): Promise<{ userId: string; stableId: number; provider: string; sessionVersion: number; user?: any }> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 10_000) throw new Error('Отсутствует токен Syndicate')
  const secret = Deno.env.get('JWT_SECRET')
  if (!secret) throw new Error('Не настроен JWT_SECRET')
  const result = await jose.jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ['HS256'], issuer: 'supabase', audience: 'authenticated',
  })
  const sub = result.payload.sub
  const tgId = result.payload.tg_id
  const provider = typeof result.payload.auth_provider === 'string' ? result.payload.auth_provider : 'legacy'
  if (typeof sub !== 'string' || !Number.isSafeInteger(tgId)) {
    throw new Error('Некорректные claims токена Syndicate')
  }
  const sessionVersion = Number(result.payload.session_version)
  if (!Number.isSafeInteger(sessionVersion) || sessionVersion < 1) throw new Error('Токен не поддерживает отзыв сессии')

  // В4: Если передан supabaseAdmin — проверяем account_state и session_version через БД
  if (supabaseAdmin) {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, tg_id, first_name, status, account_state, session_version, public_key, created_at')
      .eq('tg_id', tgId)
      .maybeSingle()
    if (error) throw error
    if (!user) throw new Error('Пользователь не найден')
    if (Number(user.session_version) !== sessionVersion) throw new Error('Сессия отозвана')

    const accountState = user.account_state || (user.status === 'blocked' ? 'blocked' : 'active')
    if (accountState === 'blocked' || accountState === 'deleted' || user.status === 'blocked') {
      throw new Error('Аккаунт заблокирован')
    }
    return { userId: sub, stableId: tgId as number, provider, sessionVersion, user }
  }

  return { userId: sub, stableId: tgId as number, provider, sessionVersion }
}
