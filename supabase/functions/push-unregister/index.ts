import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, createAdminClient, json, verifySyndicateToken } from '../_shared/provider-auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    const identity = await verifySyndicateToken(bearer)
    const { token } = await req.json()
    if (typeof token !== 'string' || token.length > 4096) throw new Error('Некорректный push-токен')
    const admin = createAdminClient()
    const { error } = await admin.from('push_subscriptions')
      .update({ active: false, last_seen_at: new Date().toISOString() })
      .eq('user_id', identity.userId).eq('token', token)
    if (error) throw error
    return json({ ok: true })
  } catch (error: any) {
    return json({ error: error?.message || 'Unknown error' }, 400)
  }
})
