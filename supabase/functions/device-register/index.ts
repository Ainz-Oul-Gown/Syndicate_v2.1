import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, createAdminClient, json, verifySyndicateToken } from '../_shared/provider-auth.ts'

function decodeBase64(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Некорректная подпись')
  let raw: string
  try { raw = atob(value) } catch { throw new Error('Некорректная подпись') }
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    const identity = await verifySyndicateToken(bearer)
    const { deviceId, deviceName, registeredAt, signature } = await req.json()
    if (typeof deviceId !== 'string' || !/^dev_[a-f0-9]{36}$/.test(deviceId)) throw new Error('Некорректный ID устройства')
    if (typeof deviceName !== 'string' || !deviceName.trim() || deviceName.length > 120) throw new Error('Некорректное имя устройства')
    if (typeof registeredAt !== 'string' || Math.abs(Date.now() - Date.parse(registeredAt)) > 5 * 60_000) throw new Error('Просроченное доказательство')

    const admin = createAdminClient()
    const { data: user, error } = await admin.from('users').select('public_key').eq('id', identity.userId).maybeSingle()
    if (error) throw error
    let keys: any
    try { keys = JSON.parse(user?.public_key || '{}') } catch { throw new Error('Повреждён публичный ключ') }
    const jwk = keys?.legacy?.ecdsa
    if (!jwk) throw new Error('Ключ подписи не настроен')
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: jwk.crv || 'P-256' }, false, ['verify'])
    const proof = JSON.stringify({ userId: identity.stableId, deviceId, deviceName, registeredAt })
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decodeBase64(signature), new TextEncoder().encode(proof))
    if (!valid) throw new Error('Подпись устройства не прошла проверку')

    const { error: upsertError } = await admin.from('user_devices').upsert({
      user_id: identity.stableId, device_id: deviceId, device_name: deviceName.trim(), last_active: new Date().toISOString(),
    }, { onConflict: 'user_id,device_id' })
    if (upsertError) throw upsertError
    return json({ ok: true })
  } catch (error: any) {
    return json({ error: error?.message || 'Unknown error' }, 400)
  }
})
