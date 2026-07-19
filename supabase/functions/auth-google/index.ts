import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import {
  allocateStableId, bindIdentity, consumeRegistrationInvite, corsHeaders,
  createAdminClient, findUserByCandidateIds, getIdentityUser, issueUserToken,
  json, normalizePublicKeysPayload, prepareUserForAuthentication, stableNumericId,
  unwrapProviderVaultSecret, wrapProviderVaultSecret,
} from '../_shared/provider-auth.ts'

type FirebaseAccount = {
  localId?: string
  email?: string
  displayName?: string
  providerUserInfo?: Array<{ providerId?: string }>
}

async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseAccount> {
  const apiKey = Deno.env.get('FIREBASE_API_KEY')
  if (!apiKey) throw new Error('Не настроен FIREBASE_API_KEY')
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error('Firebase отклонил Google ID Token')
  const account = payload?.users?.[0] as FirebaseAccount | undefined
  if (!account?.localId || !account.providerUserInfo?.some((item) => item.providerId === 'google.com')) {
    throw new Error('Токен не принадлежит Google-аккаунту')
  }
  return account
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const body = await req.json()
    const idToken = typeof body.idToken === 'string' ? body.idToken : ''
    const isRegister = body.isRegister === true
    if (!idToken || idToken.length > 20_000) throw new Error('Отсутствует Google ID Token')

    const firebaseUser = await verifyFirebaseIdToken(idToken)
    const subject = firebaseUser.localId!
    const email = firebaseUser.email?.trim().toLowerCase() || null
    const supabaseAdmin = createAdminClient()
    let { identity, user } = await getIdentityUser(supabaseAdmin, 'google', subject)

    if (isRegister) {
      if (user) throw new Error('Этот Google-аккаунт уже зарегистрирован')
      await consumeRegistrationInvite(supabaseAdmin, body.registrationInvite)
      const publicKey = normalizePublicKeysPayload(body.publicKeysPayload)
      if (!publicKey) throw new Error('Для регистрации требуется контейнер ключей')
      const wrappedVaultSecret = await wrapProviderVaultSecret(body.providerVaultSecret)
      const stableId = await allocateStableId(supabaseAdmin, [subject, `google:${subject}`, `${subject}:${crypto.randomUUID()}`])
      const requestedName = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
      const firstName = requestedName || firebaseUser.displayName?.trim().slice(0, 120) || 'Google User'
      const { data: createdUser, error: createError } = await supabaseAdmin.from('users').insert({
        tg_id: stableId, first_name: firstName, public_key: publicKey, status: 'free',
      }).select('id, tg_id, first_name, status, public_key, session_version, created_at').single()
      if (createError) throw createError
      try {
        await bindIdentity(supabaseAdmin, {
          userId: createdUser.id, provider: 'google', subject, email, wrappedVaultSecret,
        })
      } catch (error) {
        await supabaseAdmin.from('users').delete().eq('id', createdUser.id)
        throw error
      }
      user = createdUser
      identity = { provider_email: email, provider_username: null, wrapped_vault_secret: wrappedVaultSecret }
    } else if (!user) {
      const legacyUser = await findUserByCandidateIds(supabaseAdmin, [
        stableNumericId(subject), ...(email ? [stableNumericId(email)] : []),
      ])
      if (!legacyUser) throw new Error('Этот Google-аккаунт не зарегистрирован')
      await bindIdentity(supabaseAdmin, { userId: legacyUser.id, provider: 'google', subject, email })
      user = legacyUser
      identity = { provider_email: email, provider_username: null, wrapped_vault_secret: null }
    }

    user = await prepareUserForAuthentication(supabaseAdmin, user)

    const vaultSecret = identity?.wrapped_vault_secret
      ? await unwrapProviderVaultSecret(identity.wrapped_vault_secret)
      : null
    const token = await issueUserToken(user, 'google')
    return json({
      token, stableId: user.tg_id, user,
      provider: { email: identity?.provider_email || email, vaultSecret, needsVaultMigration: !vaultSecret },
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка Google-аутентификации' }, 400)
  }
})
