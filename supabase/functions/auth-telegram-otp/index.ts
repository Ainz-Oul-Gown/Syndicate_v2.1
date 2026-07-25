import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { getCorsHeaders, json } from '../_shared/provider-auth.ts'
import { handleTelegramAuth } from '../_shared/telegram-auth-handler.ts'

serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin)
  try {
    const body = await req.json()
    const result = await handleTelegramAuth(body)
    return json(result, 200, origin)
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка Telegram-аутентификации' }, 400, origin)
  }
})
