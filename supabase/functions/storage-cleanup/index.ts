import { getCorsHeaders, createAdminClient, json, verifySyndicateToken } from '../_shared/provider-auth.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(origin) });
  try {
    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) throw new Error('Unauthorized');

    // В4: Централизованная проверка JWT + account_state + session_version
    const admin = createAdminClient();
    const { userId, sessionVersion, user } = await verifySyndicateToken(auth.slice(7), admin);
    if (!user) throw new Error('Session revoked');

    const { data: rows, error } = await admin
      .from('storage_cleanup_queue')
      .select('id, bucket_id, storage_path, attempts')
      .order('queued_at', { ascending: true })
      .limit(100);
    if (error) throw error;

    let removed = 0;
    for (const row of rows || []) {
      const { error: removeError } = await admin.storage.from(row.bucket_id).remove([row.storage_path]);
      if (!removeError) {
        await admin.from('storage_cleanup_queue').delete().eq('id', row.id);
        removed += 1;
      } else {
        await admin.from('storage_cleanup_queue').update({
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
