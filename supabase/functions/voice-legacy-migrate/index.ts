import { getCorsHeaders, createAdminClient, json, verifySyndicateToken } from '../_shared/provider-auth.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(origin) });
  try {
    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401, origin);

    // В4: Централизованная проверка JWT + account_state + session_version
    const admin = createAdminClient();
    const { stableId: tgId, sessionVersion, user } = await verifySyndicateToken(auth.slice(7), admin);
    if (!user) return json({ error: 'Session revoked' }, 401, origin);

    const { messageId, chatId, oldPath, newPath, encryptedText } = await req.json();
    if (![messageId, chatId, oldPath, newPath, encryptedText].every((v) => typeof v === 'string' && v.length > 0)) {
      return json({ error: 'Invalid migration payload' }, 400, origin);
    }
    if (oldPath.includes('/') || !newPath.startsWith(`${chatId}/${tgId}/`) || !newPath.endsWith('.bin')) {
      return json({ error: 'Invalid storage path' }, 400, origin);
    }

    const { data: message, error: messageError } = await admin
      .from('messages')
      .select('id, chat_id, sender_id')
      .eq('id', messageId)
      .eq('chat_id', chatId)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!message || Number(message.sender_id) !== tgId) return json({ error: 'Only the original sender can migrate this file' }, 403, origin);

    const existing = await admin.from('message_attachments').select('storage_path').eq('message_id', messageId).maybeSingle();
    if (existing.data?.storage_path?.includes('/')) return json({ migrated: false, path: existing.data.storage_path }, 200, origin);

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
    return json({ migrated: true, path: newPath }, 200, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 400, origin);
  }
});
