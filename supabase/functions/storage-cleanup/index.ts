import { getCorsHeaders, createAdminClient, json, verifySyndicateToken } from '../_shared/provider-auth.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(origin) });
  try {
    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) throw new Error('Unauthorized');

    const { userId, stableId, sessionVersion } = await verifySyndicateToken(auth.slice(7));

    const client = createAdminClient();
    const { data: user } = await client
      .from('users')
      .select('session_version, status, account_state')
      .eq('tg_id', stableId)
      .maybeSingle();
    const accountState = user?.account_state || (user?.status === 'blocked' ? 'blocked' : 'active');
    if (!user || Number(user.session_version) !== sessionVersion
      || accountState === 'blocked' || accountState === 'deleted' || accountState === 'deactivated') {
      throw new Error('Session revoked');
    }

    const { data: rows, error } = await client
      .from('storage_cleanup_queue')
      .select('id, bucket_id, storage_path, attempts')
      .order('queued_at', { ascending: true })
      .limit(100);
    if (error) throw error;

    let removed = 0;
    for (const row of rows || []) {
      const { error: removeError } = await client.storage.from(row.bucket_id).remove([row.storage_path]);
      if (!removeError) {
        await client.from('storage_cleanup_queue').delete().eq('id', row.id);
        removed += 1;
      } else {
        await client.from('storage_cleanup_queue').update({
          attempts: Number(row.attempts || 0) + 1,
          last_error: removeError.message,
        }).eq('id', row.id);
      }
    }

    return json({ processed: rows?.length || 0, removed }, 200, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 401, origin);
  }
});
