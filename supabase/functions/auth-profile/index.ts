import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, createAdminClient, json } from '../_shared/provider-auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json()
    const stableId = Number(body?.stableId)
    if (!Number.isSafeInteger(stableId) || stableId <= 0) {
      throw new Error('Некорректный идентификатор пользователя')
    }

    const admin = createAdminClient()
    const { data: user, error } = await admin
      .from('users')
      .select('id, tg_id, first_name, status, account_state, public_key')
      .eq('tg_id', stableId)
      .maybeSingle()
    if (error) throw error
    if (!user) return json({ exists: false, user: null })

    const state = user.account_state || (user.status === 'blocked' ? 'blocked' : 'active')
    if (state === 'blocked' || state === 'deleted' || user.status === 'blocked') {
      return json({ exists: true, user: null, unavailable: true })
    }

    return json({
      exists: true,
      user: {
        id: user.id,
        tg_id: user.tg_id,
        first_name: user.first_name,
        public_key: user.public_key,
        account_state: state,
      },
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось получить профиль' }, 400)
  }
})
