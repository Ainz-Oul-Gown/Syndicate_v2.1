/**
 * К2: Refresh-токен endpoint.
 *
 * Принимает refresh-токен из заголовка X-Refresh-Token.
 * Верифицирует токен, выдаёт новый access-токен (30 мин).
 *
 * POST /auth-refresh
 * Headers: X-Refresh-Token: <hex refresh token>
 * Response: { token, refreshToken } | { error }
 *
 * Cookie-стратегия:
 * - Refresh-токен передаётся клиентом в заголовке X-Refresh-Token
 * - Клиент хранит refresh-токен в HttpOnly cookie на своём домене
 *   (или в памяти, если cross-origin)
 * - При рефреше клиент передаёт его через X-Refresh-Token
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7'
import * as jose from 'https://deno.land/x/jose@v4.14.4/index.ts'
import {
  getCorsHeaders, json,
  verifyRefreshToken, issueUserToken, issueRefreshToken, revokeRefreshToken,
} from '../_shared/provider-auth.ts'

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const headers = getCorsHeaders(origin)
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const refreshToken = req.headers.get('X-Refresh-Token') || ''
    if (!refreshToken || refreshToken.length < 20 || refreshToken.length > 256) {
      throw new Error('Отсутствует refresh-токен')
    }

    const JWT_SECRET = Deno.env.get('JWT_SECRET')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!JWT_SECRET || !SUPABASE_URL || !SERVICE_KEY) {
      throw new Error('Не настроены серверные переменные Supabase')
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

    // К2: Верифицируем refresh-токен (SHA-256 хэш в БД)
    const userId = await verifyRefreshToken(supabaseAdmin, refreshToken)
    if (!userId) {
      throw new Error('Недействительный или истёкший refresh-токен')
    }

    // Получаем данные пользователя
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, tg_id, first_name, status, account_state, deactivated_at, session_version, created_at')
      .eq('id', userId)
      .maybeSingle()
    if (userError || !user) throw new Error('Пользователь не найден')

    // Проверяем состояние аккаунта
    const accountState = user.account_state || (user.status === 'blocked' ? 'blocked' : 'active')
    if (accountState === 'blocked' || accountState === 'deleted') {
      throw new Error('Аккаунт заблокирован')
    }
    if (user.status === 'blocked') throw new Error('Аккаунт заблокирован')

    // Если deactivated — восстанавливаем
    let effectiveUser = user
    if (accountState === 'deactivated') {
      const nextVersion = Number(user.session_version || 1) + 1
      const { data: restored, error: restoreError } = await supabaseAdmin
        .from('users')
        .update({ account_state: 'active', deactivated_at: null, session_version: nextVersion })
        .eq('id', user.id)
        .eq('account_state', 'deactivated')
        .select('id, tg_id, first_name, session_version')
        .maybeSingle()
      if (restoreError || !restored) throw new Error('Не удалось восстановить аккаунт')
      effectiveUser = { ...user, ...restored, account_state: 'active' }
    }

    // К2: Отзываем старый refresh-токен (одноразовый — rotation)
    await revokeRefreshToken(supabaseAdmin, refreshToken)

    // К2: Выдаём новый access-токен (30 минут)
    const newToken = await issueUserToken(effectiveUser, 'refresh')

    // К2: Выдаём новый refresh-токен (rotation — старый отозван)
    const newRefreshToken = await issueRefreshToken(
      supabaseAdmin,
      effectiveUser.id,
      req.headers.get('user-agent'),
    )

    return json({
      token: newToken,
      refreshToken: newRefreshToken,
      user: {
        id: effectiveUser.tg_id,
        tg_id: effectiveUser.tg_id,
        first_name: effectiveUser.first_name,
      },
    })
  } catch (err: any) {
    return json({ error: err?.message || 'Ошибка обновления сессии' }, 401)
  }
})
