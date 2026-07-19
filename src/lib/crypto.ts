import * as idbKeyval from 'idb-keyval';
import { supabaseClient } from './supabase';
import { ReplyData } from '../types';

const enc = new TextEncoder();
const dec = new TextDecoder();

// Helper to convert array buffer to base64
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Helper to convert base64 to array buffer
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64.replace(/[^A-Za-z0-9+/=]/g, ''));
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Generate RSA-OAEP for encryption/decryption, and ECDSA P-256 for signing/verification
export async function generatePersonalArmor(userId: number) {
  const encKeyPair = await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 4096,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  );

  const signKeyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify']
  );

  await idbKeyval.set(`my_private_key_${userId}`, encKeyPair.privateKey);
  await idbKeyval.set(`my_sign_key_${userId}`, signKeyPair.privateKey);

  const encJwk = await window.crypto.subtle.exportKey('jwk', encKeyPair.publicKey);
  const signJwk = await window.crypto.subtle.exportKey('jwk', signKeyPair.publicKey);

  return { rsa: encJwk, ecdsa: signJwk };
}

// Sign text using local private signing key
export async function signText(text: string, userId: number): Promise<string | null> {
  const signPrivKey = await idbKeyval.get<CryptoKey>(`my_sign_key_${userId}`);
  if (!signPrivKey) return null;

  const signatureBuffer = await window.crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    signPrivKey,
    enc.encode(text)
  );

  return arrayBufferToBase64(signatureBuffer);
}

// Cache for public keys to avoid DB queries
const pubKeyCache: Record<number, string | null> = {};

// Verify signature of sender
export async function verifySignature(
  text: string,
  signatureB64: string | null,
  senderId: number
): Promise<boolean> {
  if (!signatureB64) return false;

  if (pubKeyCache[senderId] === undefined) {
    const { data } = await supabaseClient.from('users').select('public_key').eq('tg_id', senderId).maybeSingle();
    pubKeyCache[senderId] = data ? data.public_key : null;
  }

  const pubKeyData = pubKeyCache[senderId];
  if (!pubKeyData) return false; // Fail-closed: missing keys mean we cannot verify signature

  let keysDict: any = {};
  try {
    keysDict = JSON.parse(pubKeyData);
  } catch (e) {
    return false; // Fail-closed: invalid signature dictionary schema
  }

  // Support both old structure (single JWK) and new structure (dict mapping device IDs to {rsa, ecdsa})
  if (keysDict.kty) {
    keysDict = { legacy: keysDict };
  }

  const sigBytes = new Uint8Array(base64ToArrayBuffer(signatureB64));
  const encodedText = enc.encode(text);

  for (const devId in keysDict) {
    const deviceKeys = keysDict[devId];
    if (!deviceKeys || !deviceKeys.ecdsa) continue;

    try {
      const pubKey = await window.crypto.subtle.importKey(
        'jwk',
        deviceKeys.ecdsa,
        { name: 'ECDSA', namedCurve: deviceKeys.ecdsa.crv || 'P-256' },
        true,
        ['verify']
      );
      const isValid = await window.crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        pubKey,
        sigBytes,
        encodedText
      );
      if (isValid) return true;
    } catch (e) {
      // Try next device key
    }
  }

  return false;
}

// Generate symmetric AES-GCM 256-bit key
export async function generateChatKey(): Promise<CryptoKey> {
  return await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

// Encrypt chat key for a friend's device
export async function encryptChatKeyForFriend(chatKey: CryptoKey, friendPublicJwk: any): Promise<string> {
  const actualRsaJwk = friendPublicJwk.rsa ? friendPublicJwk.rsa : friendPublicJwk;
  const friendPublicKey = await window.crypto.subtle.importKey(
    'jwk',
    actualRsaJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  );

  const rawChatKey = await window.crypto.subtle.exportKey('raw', chatKey);
  const encryptedKeyBuffer = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    friendPublicKey,
    rawChatKey
  );

  return arrayBufferToBase64(encryptedKeyBuffer);
}

// Decrypt chat symmetric key using our private RSA key
export async function decryptChatKey(encryptedKeyBase64: string, userId: number): Promise<CryptoKey | null> {
  try {
    const myPrivateKey = await idbKeyval.get<CryptoKey>(`my_private_key_${userId}`);
    if (!myPrivateKey) return null;

    const encryptedKeyBuffer = base64ToArrayBuffer(encryptedKeyBase64);
    const rawChatKey = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      myPrivateKey,
      encryptedKeyBuffer
    );

    return await window.crypto.subtle.importKey(
      'raw',
      rawChatKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  } catch (e) {
    console.warn('🔒 Cryptography locked: This symmetric key was encrypted for a different device key pair.', e);
    return null;
  }
}

// Encrypt plain text using symmetric AES-GCM key and sign it
export async function encryptText(
  text: string,
  aesKey: CryptoKey,
  userId: number,
  replyData?: ReplyData | null
): Promise<string> {
  // Sign the text
  const signature = await signText(text, userId);

  // Bundle content, signature and reply
  const payloadObj: any = { t: text, s: signature };
  if (replyData) {
    payloadObj.r = replyData;
  }

  const payloadStr = JSON.stringify(payloadObj);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const encryptedContent = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    aesKey,
    enc.encode(payloadStr)
  );

  const encryptedBytes = new Uint8Array(encryptedContent);
  const payload = new Uint8Array(iv.length + encryptedBytes.length);
  payload.set(iv, 0);
  payload.set(encryptedBytes, iv.length);

  return arrayBufferToBase64(payload.buffer);
}

// Decrypts text and checks authenticity
export async function decryptText(
  encryptedBase64: string,
  aesKey: CryptoKey,
  userId: number,
  senderId: number
): Promise<{ text: string; reply?: ReplyData; isAuthentic: boolean; isError: boolean }> {
  try {
    const rawData = base64ToArrayBuffer(encryptedBase64);
    const bytes = new Uint8Array(rawData);
    const iv = bytes.slice(0, 12);
    const cipherText = bytes.slice(12);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      aesKey,
      cipherText
    );

    const decryptedStr = dec.decode(decryptedBuffer);

    let finalPlainText = decryptedStr;
    let isAuthentic = true;
    let reply: ReplyData | undefined;

    try {
      const parsed = JSON.parse(decryptedStr);
      if (parsed.t !== undefined) {
        finalPlainText = parsed.t;
        reply = parsed.r || undefined;

        // Verify digital signature if sender is another user
        if (senderId !== userId) {
          isAuthentic = await verifySignature(parsed.t, parsed.s, senderId);
        }
      }
    } catch (e) {
      // Legacy text parsing fallback
    }

    return {
      text: finalPlainText,
      reply,
      isAuthentic,
      isError: false,
    };
  } catch (err) {
    return {
      text: '🔒 [Ошибка расшифровки]',
      isAuthentic: false,
      isError: true,
    };
  }
}

// Get fingerprint of public key JWK
export async function getFingerprint(jwkKeyString: string | undefined): Promise<string> {
  if (!jwkKeyString) return 'НЕТ КЛЮЧА';
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', enc.encode(jwkKeyString));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const num = ((hashArray[0] << 24) | (hashArray[1] << 16) | (hashArray[2] << 8) | hashArray[3]) >>> 0;
  
  const numStr = num.toString().padStart(10, '0');
  const matched = numStr.match(/.{1,5}/g);
  return matched ? matched.join('-') : numStr;
}

// Check crypto keys local / global logic
export async function checkCryptoKeys(userId: number): Promise<{ ready: boolean; pendingRequestId?: string }> {
  const privateKey = await idbKeyval.get(`my_private_key_${userId}`);
  const signKey = await idbKeyval.get(`my_sign_key_${userId}`);

  // Query database
  const { data: userData } = await supabaseClient.from('users').select('public_key').eq('tg_id', userId).maybeSingle();

  let publicKeysDict: Record<string, any> = {};
  let hasKeysInDatabase = false;

  if (userData && userData.public_key) {
    try {
      publicKeysDict = JSON.parse(userData.public_key);
      if (publicKeysDict.kty || Object.keys(publicKeysDict).length > 0) {
        hasKeysInDatabase = true;
      }
    } catch (e) {
      publicKeysDict = {};
    }
  }

  if (!hasKeysInDatabase) {
    // New user scenario
    const keysObj = await generatePersonalArmor(userId);
    publicKeysDict['master'] = keysObj;
    const { error } = await supabaseClient.rpc('initialize_my_public_key', { new_public_key: JSON.stringify(publicKeysDict) });
    if (error) throw error;
    return { ready: true };
  } else if (!privateKey || !signKey) {
    // New device scenario - need synchronization
    return { ready: false };
  } else {
    // Fully ready scenario
    return { ready: true };
  }
}
