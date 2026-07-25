import { corsHeaders, createAdminClient, json, verifySyndicateToken } from '../_shared/provider-auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const { userId, stableId, sessionVersion } = await verifySyndicateToken(auth.slice(7));
    const tgId = stableId;

    const { messageId, chatId, oldPath, newPath, encryptedText } = await req.json();
    if (![messageId, chatId, oldPath, newPath, encryptedText].every((v) => typeof v === 'string' && v.length > 0)) {
      return json({ error: 'Invalid migration payload' }, 400);
    }
    if (oldPath.includes('/') || !newPath.startsWith(`${chatId}/${tgId}/`) || !newPath.endsWith('.bin')) {
      return json({ error: 'Invalid storage path' }, 400);
    }

    const admin = createAdminClient();
    const { data: user } = await admin.from('users').select('session_version, status, account_state').eq('tg_id', tgId).maybeSingle();
    const accountState = user?.account_state || (user?.status === 'blocked' ? 'blocked' : 'active');
    if (!user || Number(user.session_version) !== sessionVersion
      || accountState === 'blocked' || accountState === 'deleted' || accountState === 'deactivated') {
      return json({ error: 'Session revoked' }, 401);
    }

    const { data: message, error: messageError } = await admin
      .from('messages')
      .select('id, chat_id, sender_id')
      .eq('id', messageId)
      .eq('chat_id', chatId)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!message || Number(message.sender_id) !== tgId) return json({ error: 'Only the original sender can migrate this file' }, 403);

    const existing = await admin.from('message_attachments').select('storage_path').eq('message_id', messageId).maybeSingle();
    if (existing.data?.storage_path?.includes('/')) return json({ migrated: false, path: existing.data.storage_path });

    const download = await admin.storage.from('voice_messages').download(oldPath);
    if (download.error || !download.data) throw download.error || new Error('Legacy file not found');
    const bytes = await download.data.arrayBuffer();
    const upload = await admin.storage.from('voice_messages').upload(newPath, bytes, {
      contentType: 'application/octet-stream', upsert: false,
    });
    if (upload.error && !upload.error.message.toLowerCase().includes('already exists')) throw upload.error;

    const updated = await admin.from('messages').update({ encrypted_text: encryptedText }).eq('id', messageId).eq('sender_id', tgId);
    if (updated.error) {
      await admin.storage.from('voice_messages').remove([newPath]);
      throw updated.error;
    }

    const attachment = await admin.from('message_attachments').upsert({
      message_id: messageId,
      chat_id: chatId,
      uploader_id: tgId,
      bucket_id: 'voice_messages',
      storage_path: newPath,
      kind: 'voice',
      size_bytes: bytes.byteLength,
    }, { onConflict: 'message_id,kind' });
    if (attachment.error) {
      await admin.storage.from('voice_messages').remove([newPath]);
      throw attachment.error;
    }

    const removed = await admin.storage.from('voice_messages').remove([oldPath]);
    if (removed.error) {
      await admin.from('storage_cleanup_queue').upsert({ bucket_id: 'voice_messages', storage_path: oldPath }, { onConflict: 'bucket_id,storage_path' });
    }
    return json({ migrated: true, path: newPath });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 400);
  }
});
