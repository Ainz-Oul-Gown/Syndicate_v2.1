import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createAdminClient, json } from '../_shared/provider-auth.ts'
import * as jose from 'https://deno.land/x/jose@v4.14.4/index.ts'

async function getGoogleAccessToken(serviceAccount: any) {
  const key = await jose.importPKCS8(serviceAccount.private_key, 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new jose.SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(serviceAccount.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(key)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!response.ok) throw new Error(`OAuth FCM: ${response.status}`)
  return (await response.json()).access_token as string
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const expected = Deno.env.get('PUSH_WEBHOOK_SECRET')
    if (!expected || req.headers.get('x-push-secret') !== expected) return json({ error: 'Unauthorized' }, 401)
    const payload = await req.json()
    const record = payload?.record || payload
    const chatId = record?.chat_id
    const senderId = Number(record?.sender_id)
    if (!chatId || !Number.isSafeInteger(senderId)) throw new Error('Некорректное событие сообщения')

    const admin = createAdminClient()
    const [{ data: sender }, { data: chat }, { data: members }] = await Promise.all([
      admin.from('users').select('first_name').eq('tg_id', senderId).maybeSingle(),
      admin.from('chats').select('name,type').eq('id', chatId).maybeSingle(),
      admin.from('chat_keys').select('user_id').eq('chat_id', chatId),
    ])
    const recipientIds = (members || []).map((m: any) => m.user_id)
    if (!recipientIds.length) return json({ ok: true, sent: 0 })
    const { data: senderRow } = await admin.from('users').select('id').eq('tg_id', senderId).maybeSingle()
    const filteredIds = recipientIds.filter((id: string) => id !== senderRow?.id)
    const { data: subscriptions, error } = await admin.from('push_subscriptions')
      .select('id,token').in('user_id', filteredIds).eq('active', true)
    if (error) throw error
    if (!subscriptions?.length) return json({ ok: true, sent: 0 })

    const serviceAccount = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON') || '{}')
    if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) throw new Error('FCM не настроен')
    const accessToken = await getGoogleAccessToken(serviceAccount)
    const title = chat?.type === 'group' ? (chat?.name || 'Syndicate') : (sender?.first_name || 'Новое сообщение')
    const body = chat?.type === 'group' ? `${sender?.first_name || 'Участник'}: новое зашифрованное сообщение` : 'Новое зашифрованное сообщение'
    let sent = 0
    const invalid: string[] = []
    for (const subscription of subscriptions) {
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: { token: subscription.token, data: {
          title, body, tag: `chat-${chatId}`, chatId: String(chatId), url: `/Syndicate_v2.1/?chat=${encodeURIComponent(chatId)}`,
        }, android: { priority: 'high' }, webpush: { headers: { Urgency: 'high' } } } }),
      })
      if (response.ok) sent += 1
      else if ([404, 410].includes(response.status)) invalid.push(subscription.id)
    }
    if (invalid.length) await admin.from('push_subscriptions').update({ active: false }).in('id', invalid)
    return json({ ok: true, sent })
  } catch (error: any) {
    return json({ error: error?.message || 'Unknown error' }, 400)
  }
})
