import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, json } from '../_shared/provider-auth.ts'
import { handleTelegramAuth } from '../_shared/telegram-auth-handler.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const body = await req.json()
    const result = await handleTelegramAuth(body)
    return json(result)
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка Telegram-аутентификации' }, 400)
  }
})
