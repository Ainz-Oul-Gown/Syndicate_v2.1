import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, createAdminClient, json, verifySyndicateToken } from '../_shared/provider-auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const authHeader = req.headers.get('authorization') || ''
    const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    const identity = await verifySyndicateToken(rawToken)
    const admin = createAdminClient()
    const { data: user, error: readError } = await admin.from('users')
      .select('id, session_version').eq('id', identity.userId).single()
    if (readError || !user) throw readError || new Error('Пользователь не найден')
    if (Number(user.session_version || 1) !== identity.sessionVersion) throw new Error('Сессия уже отозвана')
    const nextVersion = Number(user.session_version || 1) + 1
    const { error } = await admin.from('users').update({ session_version: nextVersion }).eq('id', identity.userId)
    if (error) throw error
    return json({ revoked: true })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось отозвать сессии' }, 401)
  }
})
