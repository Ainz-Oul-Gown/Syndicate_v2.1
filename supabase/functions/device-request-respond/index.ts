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
    const { requestId, status, encryptedMasterKeys = null, approverDeviceId, signature } = await req.json()
    if (typeof requestId !== 'string' || requestId.length > 100) throw new Error('Некорректная заявка')
    if (status !== 'approved' && status !== 'rejected') throw new Error('Некорректное решение')
    if (typeof approverDeviceId !== 'string' || !/^dev_[a-f0-9]{36}$/.test(approverDeviceId)) throw new Error('Некорректное устройство')
    if (status === 'approved' && (typeof encryptedMasterKeys !== 'string' || encryptedMasterKeys.length > 500_000)) throw new Error('Отсутствует зашифрованный контейнер ключей')
    if (status === 'rejected' && encryptedMasterKeys !== null) throw new Error('Отклонённая заявка не должна содержать ключи')

    const admin = createAdminClient()
    const [{ data: request, error: requestError }, { data: device, error: deviceError }, { data: user, error: userError }] = await Promise.all([
      admin.from('device_requests').select('id, user_id, device_name, temp_pub_key, encrypted_master_keys, status, created_at').eq('id', requestId).eq('user_id', identity.stableId).maybeSingle(),
      admin.from('user_devices').select('id').eq('user_id', identity.stableId).eq('device_id', approverDeviceId).maybeSingle(),
      admin.from('users').select('public_key').eq('id', identity.userId).maybeSingle(),
    ])
    if (requestError) throw requestError
    if (deviceError) throw deviceError
    if (userError) throw userError
    if (!request || request.status !== 'pending') throw new Error('Заявка уже обработана или отсутствует')
    if (request.expires_at && Date.parse(request.expires_at) <= Date.now()) throw new Error('Заявка истекла')
    if (!device) throw new Error('Подтверждающее устройство не зарегистрировано')
    if (request.requester_device_id === approverDeviceId) throw new Error('Новое устройство не может подтвердить само себя')

    let keys: any
    try { keys = JSON.parse(user?.public_key || '{}') } catch { throw new Error('Повреждён публичный ключ') }
    const jwk = keys?.legacy?.ecdsa
    if (!jwk) throw new Error('Ключ подписи не настроен')
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: jwk.crv || 'P-256' }, false, ['verify'])
    const proof = JSON.stringify({ requestId, status, encryptedMasterKeys, approverDeviceId })
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decodeBase64(signature), new TextEncoder().encode(proof))
    if (!valid) throw new Error('Подпись решения не прошла проверку')

    const { data: updated, error: updateError } = await admin.from('device_requests').update({
      status, encrypted_master_keys: status === 'approved' ? encryptedMasterKeys : null,
      responded_at: new Date().toISOString(), approved_by_device_id: approverDeviceId,
    }).eq('id', requestId).eq('status', 'pending').select('id').maybeSingle()
    if (updateError) throw updateError
    if (!updated) throw new Error('Заявка уже была обработана')
    return json({ ok: true })
  } catch (error: any) {
    return json({ error: error?.message || 'Unknown error' }, 400)
  }
})
