import * as idbKeyval from 'idb-keyval';
import type { Chat } from '../types';

export const DRAFT_CHANGED_EVENT = 'syndicate:draft-changed';

export type EncryptedChatDraft = {
  iv: number[];
  payload: number[];
  updatedAt: number;
  chatName?: string;
  chatType?: Chat['type'];
  friendId?: number;
};

export type DraftChangedDetail = {
  userId: number;
  chat: Chat;
  text: string;
  updatedAt: number;
};

export const getDraftStorageKey = (userId: number, chatId: string) =>
  `chat_draft_${userId}_${chatId}`;

export const encryptChatDraft = async (
  text: string,
  key: CryptoKey,
  chat: Chat,
): Promise<EncryptedChatDraft> => {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    iv: Array.from(iv),
    payload: Array.from(new Uint8Array(encrypted)),
    updatedAt: Date.now(),
    chatName: chat.name,
    chatType: chat.type,
    friendId: chat.friendId,
  };
};

export const decryptChatDraft = async (draft: EncryptedChatDraft, key: CryptoKey) => {
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(draft.iv) },
    key,
    new Uint8Array(draft.payload),
  );
  return new TextDecoder().decode(decrypted);
};

export const emitDraftChanged = (detail: DraftChangedDetail) => {
  window.dispatchEvent(new CustomEvent<DraftChangedDetail>(DRAFT_CHANGED_EVENT, { detail }));
};

export const readDraftPreviews = async (userId: number) => {
  const prefix = `chat_draft_${userId}_`;
  const keys = await idbKeyval.keys();
  const previews: Array<{ chatId: string; draft: EncryptedChatDraft; text: string }> = [];

  await Promise.all(keys.map(async (key) => {
    if (typeof key !== 'string' || !key.startsWith(prefix)) return;
    const chatId = key.slice(prefix.length);
    const [draft, chatKey] = await Promise.all([
      idbKeyval.get<EncryptedChatDraft>(key),
      idbKeyval.get<CryptoKey>(`aes_key_${chatId}`),
    ]);
    if (!draft || !chatKey) return;
    try {
      const text = await decryptChatDraft(draft, chatKey);
      if (text.trim()) previews.push({ chatId, draft, text });
    } catch (error) {
      console.warn('Draft preview decrypt failed', error);
    }
  }));

  return previews;
};
