import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { generateRegistrationOptions } from 'npm:@simplewebauthn/server'
import { corsHeaders, createAdminClient, json, verifySyndicateToken } from '../_shared/provider-auth.ts'

function readBearer(req: Request) {
  const header = req.headers.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { name, stableId } = await req.json()
    if (!Number.isSafeInteger(stableId) || stableId <= 0) throw new Error('Некорректный ID пользователя')
    const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : 'User'
    const origin = req.headers.get('origin') || 'http://localhost:3000'
    const rpID = new URL(origin).hostname
    const admin = createAdminClient()

    const { data: existingUser, error: userError } = await admin
      .from('users')
      .select('id, tg_id, status, account_state, session_version, public_key')
      .eq('tg_id', stableId)
      .maybeSingle()
    if (userError) throw userError

    if (existingUser) {
      const identity = await verifySyndicateToken(readBearer(req))
      const state = existingUser.account_state || (existingUser.status === 'blocked' ? 'blocked' : 'active')
      if (identity.userId !== existingUser.id || identity.stableId !== stableId) throw new Error('Нельзя добавить Passkey другому пользователю')
      if (identity.sessionVersion !== Number(existingUser.session_version || 1)) throw new Error('Сессия отозвана')
      if (state !== 'active' || existingUser.status === 'blocked') throw new Error('Аккаунт недоступен')
    }

    let excludeCredentials: any[] = []
    if (existingUser?.public_key) {
      try {
        const payload = JSON.parse(existingUser.public_key)
        excludeCredentials = Array.isArray(payload?.passkeys)
          ? payload.passkeys.map((credential: any) => ({
              id: credential.id,
              transports: credential.transports,
            }))
          : []
      } catch {
        throw new Error('Повреждён контейнер публичных ключей')
      }
    }

    const options = await generateRegistrationOptions({
      rpName: 'Syndicate',
      rpID,
      userID: new TextEncoder().encode(stableId.toString()),
      userName: cleanName,
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        // Do NOT set authenticatorAttachment.
        // On Android Chrome, 'platform' causes "credential manager" errors.
        // Without it, Android Chrome defaults to the platform authenticator (fingerprint)
        // while still allowing USB/NFC as fallback — same behavior as the reference project.
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    })

    const record = JSON.stringify({
      version: 2,
      purpose: existingUser ? 'add-passkey' : 'register-passkey',
      challenge: options.challenge,
      stableId,
      userId: existingUser?.id || null,
      origin,
      rpID,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
    const { error: challengeError } = await admin.from('auth_challenges').upsert({
      id: `reg_${stableId}`,
      challenge: record,
      updated_at: new Date().toISOString(),
    })
    if (challengeError) throw challengeError

    return json(options)
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось создать Passkey challenge' }, 400)
  }
})
