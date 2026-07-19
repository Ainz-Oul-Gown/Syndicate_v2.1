import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, createAdminClient, json, verifySyndicateToken } from '../_shared/provider-auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const header = req.headers.get('authorization') || ''
    const identity = await verifySyndicateToken(header.startsWith('Bearer ') ? header.slice(7) : '')
    const body = await req.json().catch(() => ({}))
    const credentialId = typeof body?.credentialId === 'string' ? body.credentialId : null
    const removeAll = body?.removeAll === true
    if (!credentialId && !removeAll) throw new Error('Не указан Passkey для удаления')

    const admin = createAdminClient()
    const { data: user, error: userError } = await admin
      .from('users')
      .select('id, tg_id, status, account_state, session_version, public_key')
      .eq('id', identity.userId)
      .single()
    if (userError) throw userError
    const state = user.account_state || (user.status === 'blocked' ? 'blocked' : 'active')
    if (user.tg_id !== identity.stableId || Number(user.session_version) !== identity.sessionVersion) throw new Error('Сессия отозвана')
    if (state !== 'active' || user.status === 'blocked') throw new Error('Аккаунт недоступен')

    let payload: any
    try { payload = JSON.parse(user.public_key || '{}') } catch { throw new Error('Повреждён контейнер публичных ключей') }
    const current = Array.isArray(payload.passkeys) ? payload.passkeys : []
    const next = removeAll ? [] : current.filter((item: any) => item.id !== credentialId)
    const removed = current.length - next.length
    if (removed < 1) throw new Error('Passkey не найден')
    payload.passkeys = next

    const { error: updateError } = await admin
      .from('users')
      .update({ public_key: JSON.stringify(payload) })
      .eq('id', user.id)
    if (updateError) throw updateError

    return json({ removed })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось удалить Passkey' }, 400)
  }
})
