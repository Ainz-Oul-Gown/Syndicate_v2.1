import { readSessionToken, writeSessionToken } from './lib/sessionStorage';
import { LoginScreen } from './components/LoginScreen';
import { useState, useEffect, useRef } from 'react';
import * as idbKeyval from 'idb-keyval';
import {
  ShieldAlert,
  Smartphone,
  Bookmark,
  Users,
  UserCheck,
  UserMinus,
  Settings,
  UserPlus,
  ChevronRight,
  Plus,
  Loader2,
  X,
  LogOut,
  HelpCircle,
  Key,
  Download,
  Lock,
  ShieldCheck,
  Fingerprint,
  Copy,
  Check,
  Activity,
  Search,
} from 'lucide-react';
import { supabaseClient, setSupabaseToken, parseJwt, isSupabaseTokenUsable } from './lib/supabase';
import { checkCryptoKeys, generateChatKey, encryptChatKeyForFriend, decryptChatKey, getFingerprint } from './lib/crypto';
import { Chat, Friendship, User, DeviceRequest } from './types';
import StealthOverlay from './components/StealthOverlay';
import PinScreen from './components/PinScreen';
import ChatView from './components/ChatView';
import SettingsModal from './components/SettingsModal';
import { applyTheme } from './lib/theme';
import { hapticImpact } from './lib/haptics';
import { auth } from './lib/firebase';

type TelegramMiniAppContext = {
  initData: string;
  id: number;
  firstName: string;
  lastName?: string | null;
  username?: string | null;
  photoUrl?: string | null;
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<{ id: number; first_name: string } | null>(null);
  const [telegramMiniAppContext, setTelegramMiniAppContext] = useState<TelegramMiniAppContext | null>(null);
  const [myFingerprint, setMyFingerprint] = useState<string | null>(null);
  const [isAuth, setIsAuth] = useState(false);
  const [loadingText, setLoadingText] = useState('Загрузка Синдиката...');

  // Navigation states
  const [activeScreen, setActiveScreen] = useState<'main' | 'chat' | 'sync_waiting'>('main');
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'friends' | 'groups' | 'saved'>('all');
  const [chatSearch, setChatSearch] = useState('');
  const [copiedFingerprint, setCopiedFingerprint] = useState(false);

  // Modals & Panels
  const [showSettings, setShowSettings] = useState(false);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);
  
  // Local PIN lock
  const [isPinLocked, setIsPinLocked] = useState(false);
  const [pinMode, setPinMode] = useState<'unlock' | 'setup_1' | 'setup_2' | 'disable_normal' | 'disable_panic'>('unlock');
  const [pinType, setPinType] = useState<'normal' | 'panic'>('normal');

  // Master device approvals and requests
  const [pendingSyncRequest, setPendingSyncRequest] = useState<DeviceRequest | null>(null);

  // Chat/Friend List states
  const [chats, setChats] = useState<Chat[]>([]);
  const [friends, setFriends] = useState<User[]>([]);
  const [friendRequests, setFriendRequests] = useState<any[]>([]);
  const [groupChats, setGroupChats] = useState<Chat[]>([]);

  // Input bindings
  const [friendIdInput, setFriendIdInput] = useState('');
  const [groupNameInput, setGroupNameInput] = useState('');
  const [searchSpinner, setSearchSpinner] = useState(false);

  // Background Web Worker
  const workerRef = useRef<Worker | null>(null);
  const appChannelsRef = useRef<ReturnType<typeof supabaseClient.channel>[]>([]);
  const appIntervalsRef = useRef<number[]>([]);

  const trackChannel = (channel: ReturnType<typeof supabaseClient.channel>) => {
    appChannelsRef.current.push(channel);
    return channel;
  };

  const trackInterval = (intervalId: number) => {
    appIntervalsRef.current.push(intervalId);
    return intervalId;
  };

  const getDeviceId = () => {
    let did = localStorage.getItem('syndicate_device_id');
    if (!did) {
      did = 'dev_' + Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('syndicate_device_id', did);
    }
    return did;
  };

  // 1. Authenticate user from Telegram WebApp context or custom saved JWT tokens
  const authUser = async (): Promise<{ id: number; first_name: string } | null> => {
    const urlToken: string | null = null;
    if (window.location.hash.includes('token=')) {
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    }
    const tgInitData = window.Telegram?.WebApp?.initData;

    if (tgInitData) {
      const oldToken = readSessionToken();
      try {
        setLoadingText('Проверка Telegram Mini App...');
        setSupabaseToken(null); // Telegram initData validates the request independently.

        const { data: result, error } = await supabaseClient.functions.invoke('tg-auth', {
          body: { initData: tgInitData, isRegister: false },
        });
        if (error) throw error;
        if (result?.error) throw new Error(result.error);

        if (result?.registrationRequired && result?.telegram) {
          setTelegramMiniAppContext({ initData: tgInitData, ...result.telegram });
          setLoadingText('Telegram подтверждён. Завершите защищённую регистрацию.');
          return null;
        }

        if (result?.token && result?.user) {
          writeSessionToken(result.token);
          setSupabaseToken(result.token);
          setTelegramMiniAppContext(null);
          const userObj = { id: result.user.tg_id, first_name: result.user.first_name };
          setCurrentUser(userObj);
          return userObj;
        }
        throw new Error('Telegram-аутентификация не вернула сессию');
      } catch (e) {
        console.error('Telegram auth failed', e);
        if (oldToken) setSupabaseToken(oldToken);
      }
    }

    const candidateToken = urlToken && urlToken.startsWith('eyJ') ? urlToken : readSessionToken();
    const tokenToUse = isSupabaseTokenUsable(candidateToken) ? candidateToken : null;
    if (candidateToken && !tokenToUse) setSupabaseToken(null);
    if (tokenToUse) {
      setSupabaseToken(tokenToUse);
      const payload = parseJwt(tokenToUse);

      if (payload && payload.tg_id) {
        setLoadingText('Связь с сервером...');
        const { data } = await supabaseClient
          .from('users')
          .select('first_name')
          .eq('tg_id', payload.tg_id)
          .maybeSingle();

        if (data) {
          const userObj = { id: payload.tg_id, first_name: data.first_name };
          setCurrentUser(userObj);
          if (urlToken) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
          return userObj;
        }
      }
    }

    return null;
  };

  // 2. Perform RSA/ECDSA key synchronizations (Decentralized Master Sync protocol)
  const syncDeviceKeys = async (userId: number) => {
    setActiveScreen('sync_waiting');
    setLoadingText('Откройте Синдикат на своем основном устройстве и подтвердите вход. Это необходимо для безопасной передачи ключей шифрования.');

    try {
      // Create ephemeral RSA key pair for secure key transport
      const tempKeyPair = await window.crypto.subtle.generateKey(
        {
          name: 'RSA-OAEP',
          modulusLength: 4096,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['encrypt', 'decrypt']
      );

      await idbKeyval.set('temp_sync_priv_key', tempKeyPair.privateKey);
      const tempPubJwk = await window.crypto.subtle.exportKey('jwk', tempKeyPair.publicKey);

      const platform = navigator.userAgent.substring(0, 45) || 'Неизвестное устройство';

      const { data: requestData, error } = await supabaseClient
        .from('device_requests')
        .insert({
          user_id: userId,
          device_name: platform,
          requester_device_id: getDeviceId(),
          temp_pub_key: JSON.stringify(tempPubJwk),
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          status: 'pending',
        })
        .select()
        .maybeSingle();

      if (error) {
        alert('Ошибка подачи заявки на синхронизацию: ' + error.message);
        return;
      }
      
      if (!requestData) {
        console.warn('Сервер вернул пустой результат. Заявка могла быть создана, но заблокирована RLS для чтения.');
      }

      // Proctored approvals listener
      const chName = `sync-waiter-${userId}`;
      supabaseClient.getChannels().forEach(c => {
        if (c.topic === `realtime:${chName}`) supabaseClient.removeChannel(c);
      });
      const channel = trackChannel(supabaseClient
        .channel(chName)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'device_requests',
            filter: `user_id=eq.${userId}`,
          },
          async (payload: any) => {
            const updated = payload.new;
            if (updated.status === 'approved' && updated.temp_pub_key === JSON.stringify(tempPubJwk)) {
              supabaseClient.removeChannel(channel);
              await handleApprovedKeys(updated, tempKeyPair.privateKey, userId);
            } else if (updated.status === 'rejected' && updated.temp_pub_key === JSON.stringify(tempPubJwk)) {
              supabaseClient.removeChannel(channel);
              alert('Доступ отклонен главным устройством.');
              localStorage.clear();
              window.location.reload();
            }
          }
        )
        .subscribe());

      // Reliable polling fallback
      const poll = trackInterval(window.setInterval(async () => {
        const { data } = await supabaseClient
          .from('device_requests')
          .select('id, user_id, device_name, requester_device_id, temp_pub_key, encrypted_master_keys, status, created_at, expires_at, responded_at, approved_by_device_id')
          .eq('user_id', userId)
          .eq('temp_pub_key', JSON.stringify(tempPubJwk))
          .maybeSingle();

        if (data && data.status === 'approved') {
          clearInterval(poll);
          supabaseClient.removeChannel(channel);
          await handleApprovedKeys(data, tempKeyPair.privateKey, userId);
        } else if (data && data.status === 'rejected') {
          clearInterval(poll);
          supabaseClient.removeChannel(channel);
          alert('Доступ отклонен главным устройством.');
          localStorage.clear();
          window.location.reload();
        }
      }, 4000));
    } catch (e: any) {
      alert('Ошибка синхронизации: ' + e.message);
    }
  };

  const handleApprovedKeys = async (request: any, tempPrivKey: CryptoKey, userId: number) => {
    setLoadingText('Расшифровка и сохранение ключей...');

    try {
      const finalPayload = JSON.parse(request.encrypted_master_keys);

      const encryptedAesKeyBuffer = new Uint8Array(finalPayload.encryptedAesKey);
      const iv = new Uint8Array(finalPayload.iv);
      const encryptedMasterKeysBuffer = new Uint8Array(finalPayload.encryptedMasterKeys);

      // Decrypt symmetric AES wrapper key
      const rawAesKey = await window.crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        tempPrivKey,
        encryptedAesKeyBuffer
      );

      const tempAesKey = await window.crypto.subtle.importKey(
        'raw',
        rawAesKey,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );

      // Decrypt private master-keys
      const masterKeysRaw = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        tempAesKey,
        encryptedMasterKeysBuffer
      );

      const masterKeysJson = JSON.parse(new TextDecoder().decode(masterKeysRaw));

      // Rectify key properties to ensure decryption rights are explicitly stated
      masterKeysJson.rsa.key_ops = ['decrypt'];
      if (masterKeysJson.ecdsa) {
        masterKeysJson.ecdsa.key_ops = ['sign'];
      }

      const rsaKey = await window.crypto.subtle.importKey(
        'jwk',
        masterKeysJson.rsa,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['decrypt']
      );

      const ecdsaKey = await window.crypto.subtle.importKey(
        'jwk',
        masterKeysJson.ecdsa,
        { name: 'ECDSA', namedCurve: masterKeysJson?.ecdsa?.crv || 'P-256' },
        true,
        ['sign']
      );

      await idbKeyval.set(`my_private_key_${userId}`, rsaKey);
      await idbKeyval.set(`my_sign_key_${userId}`, ecdsaKey);
      await idbKeyval.del('temp_sync_priv_key');

      // Delete request trace
      await supabaseClient.from('device_requests').delete().eq('id', request.id);

      window.location.reload();
    } catch (err: any) {
      alert('Ошибка при импорте ключей: ' + err.message);
    }
  };

  // 3. Monitor active devices and handle remote kill switch deletions
  const registerDevice = async (userId: number) => {
    const deviceId = getDeviceId();
    const platform = navigator.userAgent.substring(0, 45) || 'Неизвестное устройство';

    const signKey = await idbKeyval.get<CryptoKey>(`my_sign_key_${userId}`);
    if (!signKey) throw new Error('Нельзя зарегистрировать устройство без локального ключа подписи');
    const registeredAt = new Date().toISOString();
    const proof = JSON.stringify({ userId, deviceId, deviceName: platform, registeredAt });
    const signature = await window.crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, signKey, new TextEncoder().encode(proof)
    );
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
    const { error: registerError } = await supabaseClient.functions.invoke('device-register', {
      body: { deviceId, deviceName: platform, registeredAt, signature: signatureBase64 },
    });
    if (registerError) throw registerError;

    // Dynamic kill switch subscription
    const channelName = `kill-switch-${deviceId}`;
    supabaseClient.getChannels().forEach(c => {
      if (c.topic === `realtime:${channelName}`) supabaseClient.removeChannel(c);
    });
    trackChannel(supabaseClient
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'user_devices', filter: `device_id=eq.${deviceId}` },
        async () => {
          await idbKeyval.clear();
          localStorage.clear();
          alert('Сеанс завершен: Устройство удалено из аккаунта.');
          window.location.reload();
        }
      )
      .subscribe());
  };

  // 4. Listen to inbound key sync requests on primary administrator device
  const listenToSyncRequests = (userId: number) => {
    const channelName = `admin-sync-${userId}`;
    supabaseClient.getChannels().forEach(c => {
      if (c.topic === `realtime:${channelName}`) supabaseClient.removeChannel(c);
    });
    trackChannel(supabaseClient
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'device_requests', filter: `user_id=eq.${userId}` },
        (payload: any) => {
          const req = payload.new;
          if (req && req.status === 'pending') {
            setPendingSyncRequest(req);
          }
        }
      )
      .subscribe());

    // Check for pending requests on load and via polling
    const fetchPending = () => {
      supabaseClient
        .from('device_requests')
        .select('id, user_id, device_name, temp_pub_key, encrypted_master_keys, status, created_at')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .then(({ data }) => {
          if (data && data.length > 0) {
            setPendingSyncRequest(data[0]);
          } else {
            setPendingSyncRequest(null);
          }
        });
    };

    fetchPending();
    trackInterval(window.setInterval(fetchPending, 10_000));
  };

  const handleDeviceDecision = async (requestId: string, safePubKey: string, status: 'approved' | 'rejected') => {
    if (!currentUser) return;
    setPendingSyncRequest(null);
    hapticImpact(status === 'approved' ? 'success' : 'warning');

    const updatePayload: any = { status };

    if (status === 'approved') {
      try {
        const myPrivRsa = await idbKeyval.get<CryptoKey>(`my_private_key_${currentUser.id}`);
        const myPrivEcdsa = await idbKeyval.get<CryptoKey>(`my_sign_key_${currentUser.id}`);

        if (!myPrivRsa || !myPrivEcdsa) return;

        const rsaJwk = await window.crypto.subtle.exportKey('jwk', myPrivRsa);
        const ecdsaJwk = await window.crypto.subtle.exportKey('jwk', myPrivEcdsa);

        const keysPayload = JSON.stringify({ rsa: rsaJwk, ecdsa: ecdsaJwk });
        const encodedPayload = new TextEncoder().encode(keysPayload);

        // Generate temporary symmetric wrapper key
        const tempAesKey = await window.crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt']
        );

        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encryptedMasterKeys = await window.crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          tempAesKey,
          encodedPayload
        );

        // Encrypt temporary AES key with new device public RSA key
        const exportedAesKey = await window.crypto.subtle.exportKey('raw', tempAesKey);
        const newDevicePubKey = await window.crypto.subtle.importKey(
          'jwk',
          JSON.parse(safePubKey),
          { name: 'RSA-OAEP', hash: 'SHA-256' },
          true,
          ['encrypt']
        );

        const encryptedAesKey = await window.crypto.subtle.encrypt(
          { name: 'RSA-OAEP' },
          newDevicePubKey,
          exportedAesKey
        );

        // Map arrays to allow robust transmissions
        updatePayload.encrypted_master_keys = JSON.stringify({
          encryptedAesKey: Array.from(new Uint8Array(encryptedAesKey)),
          iv: Array.from(iv),
          encryptedMasterKeys: Array.from(new Uint8Array(encryptedMasterKeys)),
        });
      } catch (err) {
        console.error('Secure key wrap failed', err);
        return;
      }
    }

    const signKey = await idbKeyval.get<CryptoKey>(`my_sign_key_${currentUser.id}`);
    if (!signKey) throw new Error('Локальный ключ подписи отсутствует');
    const approverDeviceId = getDeviceId();
    const encryptedMasterKeys = updatePayload.encrypted_master_keys || null;
    const proof = JSON.stringify({ requestId, status, encryptedMasterKeys, approverDeviceId });
    const signature = await window.crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, signKey, new TextEncoder().encode(proof)
    );
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
    const { error } = await supabaseClient.functions.invoke('device-request-respond', {
      body: { requestId, status, encryptedMasterKeys, approverDeviceId, signature: signatureBase64 },
    });
    if (error) throw error;
  };

  // 5. Query active chats, friends and pending requests lists
  const loadChatsAndFriends = async (userId: number) => {
    try {
      // Parallelize base queries
      const [relsRes, myKeysRes, myDataRes] = await Promise.all([
        supabaseClient
          .from('friendships')
          .select('id, requester_id, addressee_id, status, created_at')
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
        supabaseClient
          .from('chat_keys')
          .select('chat_id')
          .eq('user_id', userId),
        supabaseClient
          .from('users')
          .select('public_key')
          .eq('tg_id', userId)
          .maybeSingle()
      ]);

      const relsArray = relsRes.data || [];
      const myKeys = myKeysRes.data;
      
      if (myDataRes.data && myDataRes.data.public_key) {
        getFingerprint(myDataRes.data.public_key).then(fp => setMyFingerprint(fp));
      }

      // Prepare secondary parallel queries
      const promises: any[] = [];

      // 1. Friends
      const friendIds = relsArray
        .filter((r) => r.status === 'accepted')
        .map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id));

      if (friendIds.length > 0) {
        promises.push(
          supabaseClient.from('users').select('tg_id, first_name, public_key, status').in('tg_id', friendIds).then(({ data: users }) => {
            setFriends(users || []);
            localStorage.setItem('synd_cached_users', JSON.stringify(users || []));
          })
        );
      } else {
        setFriends([]);
      }

      // 2. Pending Requests
      const pendingRels = relsArray.filter((r) => r.status === 'pending' && r.addressee_id === userId);
      if (pendingRels.length > 0) {
        const reqUserIds = pendingRels.map((r) => r.requester_id);
        promises.push(
          supabaseClient.from('users').select('tg_id, first_name, public_key, status').in('tg_id', reqUserIds).then(({ data: pUsers }) => {
            if (pUsers) {
              const reqs = pendingRels
                .map((rel) => ({
                  id: rel.id,
                  user: pUsers.find((u) => u.tg_id === rel.requester_id),
                }))
                .filter((r) => r.user);
              setFriendRequests(reqs as any);
            }
          })
        );
      } else {
        setFriendRequests([]);
      }

      // 3. Chat Lists
      if (myKeys && myKeys.length > 0) {
        const chatIds = myKeys.map((k) => k.chat_id);
        promises.push(
          supabaseClient.from('chats').select('id, name, type, created_at, created_by').in('id', chatIds).then(({ data: chatsData }) => {
            const groups = (chatsData || []).filter((c) => c.type === 'group');
            setGroupChats(groups);
            localStorage.setItem('synd_cached_groups', JSON.stringify(groups));
          })
        );
      } else {
        setGroupChats([]);
      }

      // Execute secondary queries in parallel
      await Promise.all(promises);
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenSavedMessages = async () => {
    if (!currentUser) return;
    hapticImpact("selection");

    // Retrieve or instantiate saved self chat
    let savedChatId = '';
    try {
      const { data: myKeys } = await supabaseClient
        .from('chat_keys')
        .select('chat_id')
        .eq('user_id', currentUser.id);

      if (myKeys && myKeys.length > 0) {
        const chatIds = myKeys.map((k) => k.chat_id);
        const { data: chatsData } = await supabaseClient
          .from('chats')
          .select('id, name, type, created_at, created_by')
          .eq('type', 'saved')
          .in('id', chatIds);

        if (chatsData && chatsData.length > 0) {
          savedChatId = chatsData[0].id;
        }
      }

      let activeChatObj: Chat;

      if (savedChatId) {
        activeChatObj = { id: savedChatId, name: 'Избранное', type: 'saved' };
      } else {
        // Instantiate first-time Saved Messages E2EE chat
        const { data: myData } = await supabaseClient
          .from('users')
          .select('public_key')
          .eq('tg_id', currentUser.id)
          .maybeSingle();

        const aesKey = await generateChatKey();
        const { data: newChat } = await supabaseClient
          .from('chats')
          .insert({ name: 'saved', type: 'saved' })
          .select()
          .maybeSingle();

        let myKeysJson = JSON.parse(myData?.public_key || '{}');
        if (myKeysJson.kty) myKeysJson = { legacy: myKeysJson };

        const encKeys: Record<string, string> = {};
        for (const [devId, pubJwk] of Object.entries(myKeysJson)) {
          if (devId === 'vault' || typeof pubJwk !== 'object' || pubJwk === null) continue;
          encKeys[devId] = await encryptChatKeyForFriend(aesKey, pubJwk);
        }

        await supabaseClient.from('chat_keys').insert({
          chat_id: newChat.id,
          user_id: currentUser.id,
          encrypted_key: JSON.stringify(encKeys),
        });

        // Set local IDB fast key cache
        await idbKeyval.set(`aes_key_${newChat.id}`, aesKey);

        activeChatObj = { id: newChat.id, name: 'Избранное', type: 'saved' };
      }

      setActiveChat(activeChatObj);
      setActiveScreen('chat');
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenPrivateChat = async (friend: User) => {
    if (!currentUser) return;
    hapticImpact("selection");

    try {
      // Find private chat ID from RPC
      const { data: chatId } = await supabaseClient.rpc('get_private_chat', {
        user1_id: currentUser.id,
        user2_id: friend.tg_id,
      });

      let activeChatObj: Chat;

      if (chatId) {
        activeChatObj = { id: chatId, name: friend.first_name, type: 'private', friendId: friend.tg_id };
      } else {
        // Generate new PM chat
        const { data: friendData } = await supabaseClient
          .from('users')
          .select('public_key')
          .eq('tg_id', friend.tg_id)
          .maybeSingle();

        const { data: myData } = await supabaseClient
          .from('users')
          .select('public_key')
          .eq('tg_id', currentUser.id)
          .maybeSingle();

        const aesKey = await generateChatKey();
        const { data: newChat } = await supabaseClient
          .from('chats')
          .insert({ name: 'private', type: 'private' })
          .select()
          .maybeSingle();

        let friendKeys = JSON.parse(friendData?.public_key || '{}');
        if (friendKeys.kty) friendKeys = { legacy: friendKeys };
        const encFriendKeys: Record<string, string> = {};
        for (const [devId, pubJwk] of Object.entries(friendKeys)) {
          if (devId === 'vault' || typeof pubJwk !== 'object' || pubJwk === null) continue;
          encFriendKeys[devId] = await encryptChatKeyForFriend(aesKey, pubJwk);
        }

        let myKeys = JSON.parse(myData?.public_key || '{}');
        if (myKeys.kty) myKeys = { legacy: myKeys };
        const encMyKeys: Record<string, string> = {};
        for (const [devId, pubJwk] of Object.entries(myKeys)) {
          if (devId === 'vault' || typeof pubJwk !== 'object' || pubJwk === null) continue;
          encMyKeys[devId] = await encryptChatKeyForFriend(aesKey, pubJwk);
        }

        // Bootstrap our membership in a separate statement. Strict RLS then
        // permits this member to provision the friend's encrypted chat key.
        const { error: ownKeyError } = await supabaseClient.from('chat_keys').insert({
          chat_id: newChat.id,
          user_id: currentUser.id,
          encrypted_key: JSON.stringify(encMyKeys),
        });
        if (ownKeyError) throw ownKeyError;

        const { error: friendKeyError } = await supabaseClient.from('chat_keys').insert({
          chat_id: newChat.id,
          user_id: friend.tg_id,
          encrypted_key: JSON.stringify(encFriendKeys),
        });
        if (friendKeyError) throw friendKeyError;

        await idbKeyval.set(`aes_key_${newChat.id}`, aesKey);

        activeChatObj = { id: newChat.id, name: friend.first_name, type: 'private', friendId: friend.tg_id };
      }

      setActiveChat(activeChatObj);
      setActiveScreen('chat');
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenGroupChat = (g: Chat) => {
    hapticImpact("selection");
    setActiveChat(g);
    setActiveScreen('chat');
  };

  // Add friend workflow
  const handleAddFriend = async () => {
    const targetId = parseInt(friendIdInput.trim(), 10);
    if (!targetId || isNaN(targetId) || !currentUser) {
      hapticImpact("error");
      alert('Введите корректный ID!');
      return;
    }

    if (targetId === currentUser.id) {
      hapticImpact("error");
      alert('Это ваш собственный ID!');
      return;
    }

    setSearchSpinner(true);
    try {
      const { data: user } = await supabaseClient
        .from('users')
        .select('id')
        .eq('tg_id', targetId)
        .maybeSingle();

      if (!user) {
        hapticImpact("error");
        alert('Пользователь не зарегистрирован!');
        return;
      }

      const { error } = await supabaseClient.rpc('send_friend_request', { target_id: targetId });

      if (error) {
        hapticImpact("error");
        alert('Запрос уже отправлен или вы уже друзья!');
      } else {
        hapticImpact("success");
        alert('Запрос отправлен!');
        setFriendIdInput('');
        setShowAddFriend(false);
        loadChatsAndFriends(currentUser.id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSearchSpinner(false);
    }
  };

  // Group creation workflow
  const handleCreateGroup = async () => {
    if (!groupNameInput.trim() || !currentUser) return;

    try {
      const gName = groupNameInput.trim();
      setGroupNameInput('');
      setShowCreateGroup(false);

      const aesKey = await generateChatKey();

      const { data: myData } = await supabaseClient
        .from('users')
        .select('public_key')
        .eq('tg_id', currentUser.id)
        .maybeSingle();

      let myKeys = JSON.parse(myData?.public_key || '{}');
      if (myKeys.kty) myKeys = { legacy: myKeys };

      const encKeys: Record<string, string> = {};
      for (const [devId, pubJwk] of Object.entries(myKeys)) {
        if (devId === 'vault' || typeof pubJwk !== 'object' || pubJwk === null) continue;
        encKeys[devId] = await encryptChatKeyForFriend(aesKey, pubJwk);
      }

      const { data: newChat, error: createError } = await supabaseClient
        .rpc('create_group_chat', { group_name: gName, creator_encrypted_key: JSON.stringify(encKeys) })
        .single();
      if (createError || !newChat) throw createError || new Error('Не удалось создать группу');

      await idbKeyval.set(`aes_key_${newChat.id}`, aesKey);

      hapticImpact("success");
      loadChatsAndFriends(currentUser.id);
      alert(`Группа "${gName}" успешно создана!`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAcceptFriend = async (reqId: string) => {
    if (!currentUser) return;
    try {
      const { error } = await supabaseClient.rpc('respond_friend_request', { request_id: reqId, accept_request: true });
      if (error) throw error;
      hapticImpact("success");
      loadChatsAndFriends(currentUser.id);
    } catch (e) {
      console.error(e);
    }
  };

  const handleRejectFriend = async (reqId: string) => {
    if (!currentUser) return;
    try {
      const { error } = await supabaseClient.rpc('respond_friend_request', { request_id: reqId, accept_request: false });
      if (error) throw error;
      hapticImpact("warning");
      loadChatsAndFriends(currentUser.id);
    } catch (e) {
      console.error(e);
    }
  };

  const triggerPanicWipe = async () => {
    // 1. Деавторизуем Google-аккаунт в Firebase Auth для сброса OAuth сессии
    try {
      if (auth) {
        await auth.signOut();
      }
    } catch (e) {
      console.warn('Firebase signOut failed or not initialized:', e);
    }

    // 2. Удаляем зарегистрированное устройство из Supabase
    if (currentUser) {
      const devId = localStorage.getItem('syndicate_device_id');
      if (devId) {
        try {
          await supabaseClient.from('user_devices').delete().eq('device_id', devId);
        } catch (e) {}
      }
    }

    // 3. Отзываем все ранее выданные JWT этого аккаунта.
    try {
      if (readSessionToken()) {
        await supabaseClient.functions.invoke('auth-revoke-sessions', { body: {} });
      }
    } catch (e) {
      console.warn('Не удалось отозвать удалённые сессии перед локальной очисткой:', e);
    }

    // 4. Очищаем базовые хранилища ключей и конфигов
    try {
      await idbKeyval.clear();
    } catch (e) {}

    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {}

    // 4. Гарантированно стираем абсолютно ВСЕ базы данных IndexedDB на устройстве.
    // Это критически важно: Firebase Auth сохраняет токены внутри IndexedDB (база firebaseLocalStorageDb).
    // Обычная очистка localStorage их не удаляет, из-за чего Google-аккаунт мог автоматически восстанавливать сессию.
    try {
      if (window.indexedDB && window.indexedDB.databases) {
        const dbs = await window.indexedDB.databases();
        for (const db of dbs) {
          if (db.name) {
            window.indexedDB.deleteDatabase(db.name);
          }
        }
      }
    } catch (e) {
      console.error('Failed to purge IndexedDB databases:', e);
    }

    // 5. Полностью удаляем все куки (cookies), чтобы сбросить любые сессионные идентификаторы
    try {
      const cookies = document.cookie.split(";");
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i];
        const eqPos = cookie.indexOf("=");
        const name = eqPos > -1 ? cookie.substring(0, eqPos).trim() : cookie.trim();
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
      }
    } catch (e) {}

    // 6. Полностью очищаем все кэши (Cache Storage)
    try {
      if (window.caches) {
        const cacheKeys = await window.caches.keys();
        for (const key of cacheKeys) {
          await window.caches.delete(key);
        }
      }
    } catch (e) {}

    // Перезагружаем приложение в полностью "холодном", чистом и безопасном состоянии
    window.location.reload();
  };

  useEffect(() => {
    const handleSessionExpired = () => {
      setSupabaseToken(null);
      setIsAuth(false);
      setCurrentUser(null);
      window.location.reload();
    };
    window.addEventListener('syndicate:session-expired', handleSessionExpired);
    return () => window.removeEventListener('syndicate:session-expired', handleSessionExpired);
  }, []);

  // Bootstrap initialization
  useEffect(() => {
    const bootstrap = async () => {
      try {
        // Try reading cache for instant UI
        const cachedUsers = localStorage.getItem('synd_cached_users');
        const cachedGroups = localStorage.getItem('synd_cached_groups');
        if (cachedUsers) setFriends(JSON.parse(cachedUsers));
        if (cachedGroups) setGroupChats(JSON.parse(cachedGroups));

        const authData = await authUser();
        const activeUser = authData || currentUser;

        if (activeUser) {
          setIsAuth(true);

          // Check if local keys exist before registering this device as trusted.
          const keyStatus = await checkCryptoKeys(activeUser.id);
          if (keyStatus.ready) {
            await registerDevice(activeUser.id);
            listenToSyncRequests(activeUser.id);
            // Check local PIN code status
            if (localStorage.getItem('synd_pin_hash')) {
              setPinMode('unlock');
              setIsPinLocked(true);
            }

            // Sync data
            loadChatsAndFriends(activeUser.id);

            // Initialize background translation worker
            const worker = new Worker(new URL('./ai-worker.ts', import.meta.url), { type: 'module' });
            workerRef.current = worker;

            const savedWhisper = localStorage.getItem('synd_whisper_model') || 'Xenova/whisper-tiny';
            worker.postMessage({ type: 'init', model: savedWhisper });
          } else {
            // New device! Prompt sync request popup
            await syncDeviceKeys(activeUser.id);
          }
        } else {
          setLoadingText('Вам необходимо запустить приложение из Telegram или получить токен авторизации.');
        }
      } catch (err: any) {
        console.error(err);
        setLoadingText('Ошибка инициализации: ' + err.message);
      }
    };

    bootstrap();

    // Load custom themes on boot
    const themeColor = localStorage.getItem('synd_theme_color') || '#0A84FF';
    applyTheme(themeColor);

    const checkStandalone = () => {
      const isStA = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
      setIsStandalone(!!isStA);
    };
    checkStandalone();
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener('change', checkStandalone);

    const handleBackgroundAutoLock = () => {
      if (localStorage.getItem('synd_pin_hash')) {
        if (document.hidden) {
          setIsPinLocked(true);
          setPinMode('unlock');
        }
      }
    };

    document.addEventListener('visibilitychange', handleBackgroundAutoLock);

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      appIntervalsRef.current.forEach(window.clearInterval);
      appIntervalsRef.current = [];
      appChannelsRef.current.forEach((channel) => {
        void supabaseClient.removeChannel(channel);
      });
      appChannelsRef.current = [];
      mq.removeEventListener('change', checkStandalone);
      document.removeEventListener('visibilitychange', handleBackgroundAutoLock);
    };
  }, []);

  if (isPinLocked) {
    return (
      <PinScreen
        mode={pinMode}
        type={pinType}
        onCancel={() => {
          setIsPinLocked(false);
          setPinMode('unlock');
        }}
        onSuccess={() => {
          setIsPinLocked(false);
          setPinMode('unlock');
          if (currentUser) {
            loadChatsAndFriends(currentUser.id);
          }
        }}
        triggerPanicWipe={triggerPanicWipe}
      />
    );
  }

  if (!isAuth) {
    const isError = loadingText.includes('Вам необходимо') || loadingText.includes('Ошибка');
    return (
      <LoginScreen 
        isError={isError} 
        loadingText={loadingText} 
        deferredPrompt={deferredPrompt}
        setDeferredPrompt={setDeferredPrompt}
        telegramMiniAppContext={telegramMiniAppContext}
        onLoginSuccess={async (token, masterKeysJSON, user) => {
          writeSessionToken(token);
          
          if (masterKeysJSON) {
            try {
              const { rsa, ecdsa } = JSON.parse(masterKeysJSON);
              const pubEcdsa = Object.assign({}, ecdsa, { d: undefined });
              const pubRsa = Object.assign({}, rsa, { d: undefined, p: undefined, q: undefined, dp: undefined, dq: undefined, qi: undefined });
              
              const impEcdsa = await window.crypto.subtle.importKey('jwk', ecdsa, { name: 'ECDSA', namedCurve: ecdsa?.crv || 'P-256' }, true, ['sign']);
              const impRsa = await window.crypto.subtle.importKey('jwk', rsa, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt']);
              
              await idbKeyval.set(`my_private_key_${user.id}`, impRsa);
              await idbKeyval.set(`my_sign_key_${user.id}`, impEcdsa);
              
              localStorage.setItem('synd_my_pubkey_cache', JSON.stringify(pubRsa));
              localStorage.setItem('synd_my_pubsign_cache', JSON.stringify(pubEcdsa));
              
            } catch (e) {
              console.error('Failed to import synced master keys:', e);
            }
          }
          window.location.reload();
        }}
      />
    );
  }

  if (activeScreen === 'sync_waiting') {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-slate-950 p-6 text-center select-none text-slate-100">
        <Smartphone className="w-12 h-12 text-primary animate-bounce mb-5" />
        <h3 className="text-lg font-bold text-slate-200 mb-2">Авторизация устройства</h3>
        <p className="text-slate-400 text-sm max-w-[280px] leading-relaxed">
          {loadingText}
        </p>
        <div className="mt-8 flex flex-col gap-3 w-full max-w-[280px]">
          <button 
            onClick={() => {
              window.open(`https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=Подтверждение%20входа%20в%20Синдикат`, '_blank');
            }}
            className="w-full py-3 bg-primary hover:bg-primary-hover text-white rounded-xl font-semibold transition flex items-center justify-center gap-2"
          >
            Отправить в Избранное
          </button>
          <button 
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              alert('Ссылка скопирована!');
            }}
            className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl font-semibold transition flex items-center justify-center"
          >
            Скопировать ссылку
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-slate-950 text-slate-100 select-none overflow-hidden flex flex-col relative">
      <StealthOverlay />

      {/* Primary alert wrapper for device approvals */}
      {pendingSyncRequest && (
        <div className="fixed top-4 left-4 right-4 bg-slate-900 border-2 border-amber-500 p-4.5 rounded-2xl z-[999999] shadow-2xl flex flex-col gap-3 animate-slide-up text-slate-100">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center flex-shrink-0">
              <Smartphone className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <span className="font-bold text-sm block">Запрос на вход</span>
              <span className="text-xs text-slate-400 leading-relaxed block mt-0.5">
                Новое устройство пытается получить доступ к вашим ключам шифрования:{' '}
                <strong>{pendingSyncRequest.device_name}</strong>
              </span>
            </div>
          </div>
          <div className="flex gap-2 w-full mt-1.5">
            <button
              onClick={() => handleDeviceDecision(pendingSyncRequest.id, pendingSyncRequest.temp_pub_key, 'approved')}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 px-4 rounded-xl text-xs transition"
            >
              Разрешить
            </button>
            <button
              onClick={() => handleDeviceDecision(pendingSyncRequest.id, pendingSyncRequest.temp_pub_key, 'rejected')}
              className="flex-1 bg-slate-800 hover:bg-slate-750 text-rose-500 font-semibold py-2 px-4 rounded-xl text-xs transition"
            >
              Отклонить
            </button>
          </div>
        </div>
      )}

      {/* Screens routers */}
      {activeScreen === 'chat' && activeChat ? (
        <ChatView
          chat={activeChat}
          currentUser={currentUser!}
          onBack={() => {
            setActiveScreen('main');
            setActiveChat(null);
            if (currentUser) loadChatsAndFriends(currentUser.id);
          }}
          worker={workerRef.current}
        />
      ) : (
        <div className="flex flex-col h-full overflow-hidden px-3 pt-2 pb-4 flex-grow relative max-w-3xl mx-auto w-full">
          {/* Header */}
          <div className="flex items-center justify-between py-2 mb-3 border-b border-slate-900 flex-shrink-0">
            <div 
              onClick={() => hapticImpact("selection")}
              className="flex items-center gap-2.5 select-none group cursor-pointer"
            >
              <div className="w-6.5 h-6.5 relative flex items-center justify-center overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60 shadow-sm transition-all duration-300 group-hover:border-primary/40 group-hover:shadow-[0_0_12px_var(--primary-border)]">
                {/* Ambient inner gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/15 to-transparent pointer-events-none" />
                
                {/* Micro spinning tactical rings */}
                <div className="absolute inset-0.5 rounded border border-dashed border-primary/20 animate-cyber-spin pointer-events-none" />
                <div className="absolute inset-1.5 rounded-sm border border-primary/10 animate-cyber-spin-reverse pointer-events-none" />
                
                {/* Interactive glowing status core */}
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.8)] z-10 animate-pulse group-hover:scale-125 transition duration-300" />
              </div>
              <span className="font-mono text-[11px] font-black tracking-[0.18em] text-slate-200 group-hover:text-primary transition duration-300 mt-0.5 uppercase">
                Syndicate
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              {/* User Avatar Chip (triggers settings modal) */}
              <button
                onClick={() => { hapticImpact("selection"); setShowSettings(true); }}
                className="flex items-center gap-2.5 bg-slate-900/40 hover:bg-slate-900/80 border border-slate-900 rounded-xl px-3 py-1.5 transition active:scale-95 cursor-pointer select-none max-w-[200px] sm:max-w-xs text-left"
                title="Мой профиль и настройки"
              >
                <div className="w-6 h-6 shrink-0 rounded-md bg-gradient-to-tr from-primary to-emerald-500 text-white font-bold text-[10px] flex items-center justify-center uppercase select-none">
                  {currentUser?.first_name.charAt(0)}
                </div>
                <div className="flex flex-col min-w-0 leading-none">
                  <span className="font-bold text-slate-200 text-xs truncate leading-none">{currentUser?.first_name}</span>
                  <span className="text-[9px] text-slate-400 font-mono font-bold leading-none mt-0.5 whitespace-nowrap">
                    ID: {currentUser?.id}
                  </span>
                </div>
              </button>

              {!isStandalone && (
                <button
                  onClick={async () => {
                    hapticImpact("selection");
                    const tgWebApp = window.Telegram?.WebApp as any;
                    if (tgWebApp && tgWebApp.platform && tgWebApp.platform !== 'unknown') {
                      const url = new URL(window.location.href);
                      url.hash = '';
                      tgWebApp.openLink(url.toString());
                    } else if (deferredPrompt) {
                      deferredPrompt.prompt();
                      const { outcome } = await deferredPrompt.userChoice;
                      if (outcome === 'accepted') {
                        setDeferredPrompt(null);
                      }
                    } else {
                      setShowInstallPrompt(true);
                    }
                  }}
                  className="p-2.5 rounded-xl bg-slate-900/50 hover:bg-slate-900 text-slate-400 hover:text-slate-200 active:scale-95 transition duration-150 border border-slate-900 cursor-pointer"
                  title="Скачать приложение"
                >
                  <Download className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>

          {/* Quick Search and Actions bar */}
          <div className="flex items-center gap-2 mb-4 flex-shrink-0">
            <div className="relative flex-grow">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Поиск чатов и контактов..."
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                className="w-full bg-slate-900/20 border border-slate-900/80 focus:border-primary/50 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 outline-none transition duration-150"
              />
              {chatSearch && (
                <button
                  onClick={() => setChatSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs font-semibold px-1"
                >
                  Очистить
                </button>
              )}
            </div>
            
            <button
              onClick={() => { hapticImpact("selection"); setShowAddFriend(true); }}
              className="p-2.5 rounded-xl bg-slate-900/30 hover:bg-slate-900 text-primary border border-slate-900 hover:border-slate-800 transition active:scale-95 cursor-pointer flex-shrink-0"
              title="Добавить контакт"
            >
              <UserPlus className="w-5 h-5" />
            </button>
            
            <button
              onClick={() => { hapticImpact("selection"); setShowCreateGroup(true); }}
              className="p-2.5 rounded-xl bg-slate-900/30 hover:bg-slate-900 text-emerald-400 border border-slate-900 hover:border-slate-800 transition active:scale-95 cursor-pointer flex-shrink-0"
              title="Создать группу"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>

          {/* Slidable Filter Tabs */}
          <div className="bg-slate-900/30 border border-slate-900/80 p-1 rounded-xl flex gap-1 mb-4 select-none flex-shrink-0">
            {(['all', 'friends', 'groups', 'saved'] as const).map((tab) => {
              const label =
                tab === 'all'
                  ? 'Все'
                  : tab === 'friends'
                  ? 'Личные'
                  : tab === 'groups'
                  ? 'Группы'
                  : 'Избранное';
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab);
                    hapticImpact("selection");
                  }}
                  className={`flex-1 text-center py-2 px-2.5 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'bg-primary text-white shadow-lg shadow-primary/10'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Chat Inbox list */}
          <div className="flex-grow flex flex-col gap-2 overflow-y-auto pb-12 pr-1">
            {/* Filter computations */}
            {(() => {
              const filteredRequests = friendRequests.filter((req) =>
                req.user.first_name.toLowerCase().includes(chatSearch.toLowerCase())
              );
              const filteredGroupChats = groupChats.filter((g) =>
                g.name.toLowerCase().includes(chatSearch.toLowerCase())
              );
              const filteredFriends = friends.filter((f) =>
                f.first_name.toLowerCase().includes(chatSearch.toLowerCase())
              );

              const hasRequests = filteredRequests.length > 0;
              const hasGroups = filteredGroupChats.length > 0;
              const hasFriends = filteredFriends.length > 0;
              const isSearching = chatSearch.trim() !== '';

              return (
                <>
                  {/* 1. Pending Friend Requests */}
                  {(activeTab === 'all' || activeTab === 'friends') &&
                    filteredRequests.map((req) => (
                      <div
                        key={req.id}
                        className="flex items-center justify-between p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl animate-fade-in shadow-md"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold text-base shadow-inner">
                            {req.user.first_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-slate-100 text-sm">{req.user.first_name}</div>
                            <div className="text-[11px] text-amber-500 font-semibold mt-0.5">
                              Входящий запрос в контакты
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleAcceptFriend(req.id)}
                            className="w-8.5 h-8.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center transition active:scale-95 cursor-pointer shadow-md"
                            title="Принять"
                          >
                            <UserCheck className="w-4.5 h-4.5" />
                          </button>
                          <button
                            onClick={() => handleRejectFriend(req.id)}
                            className="w-8.5 h-8.5 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 text-rose-500 flex items-center justify-center transition active:scale-95 cursor-pointer"
                            title="Отклонить"
                          >
                            <UserMinus className="w-4.5 h-4.5" />
                          </button>
                        </div>
                      </div>
                    ))}

                  {/* 2. Saved Messages Self Chat */}
                  {(activeTab === 'all' || activeTab === 'saved') && (
                    <div
                      onClick={handleOpenSavedMessages}
                      className="flex items-center justify-between p-3.5 bg-slate-900/20 hover:bg-slate-900/40 border border-slate-900/60 hover:border-slate-900 rounded-2xl transition-all duration-200 cursor-pointer group shadow-sm active:scale-[0.99]"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10.5 h-10.5 rounded-xl bg-primary-light text-primary flex items-center justify-center shadow-inner group-hover:scale-105 transition">
                          <Bookmark className="w-5.5 h-5.5 fill-current" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="font-bold text-slate-100 text-sm flex items-center gap-1.5">
                            Избранное
                            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                            Личный архив заметок, файлов и аудио
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-slate-500 group-hover:text-primary transition">
                        <span className="text-[10px] font-mono font-bold tracking-widest mr-1 text-slate-600">E2EE</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </div>
                  )}

                  {/* 3. Group Chats list */}
                  {(activeTab === 'all' || activeTab === 'groups') &&
                    filteredGroupChats.map((g) => (
                      <div
                        key={g.id}
                        onClick={() => handleOpenGroupChat(g)}
                        className="flex items-center justify-between p-3.5 bg-slate-900/20 hover:bg-slate-900/40 border border-slate-900/60 hover:border-slate-900 rounded-2xl transition-all duration-200 cursor-pointer group shadow-sm active:scale-[0.99] animate-fade-in"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10.5 h-10.5 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-extrabold text-base shadow-inner uppercase group-hover:scale-105 transition">
                            {g.name.charAt(0)}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <div className="font-bold text-slate-100 text-sm flex items-center gap-1.5">
                              {g.name}
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5 truncate flex items-center gap-1">
                              <Users className="w-3 h-3 text-slate-500" /> Групповой защищенный канал
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-slate-500 group-hover:text-primary transition">
                          <span className="text-[10px] font-mono font-bold tracking-widest mr-1 text-slate-600">SECURE</span>
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </div>
                    ))}

                  {/* 4. Friends list (PM) */}
                  {(activeTab === 'all' || activeTab === 'friends') &&
                    filteredFriends.map((f) => (
                      <div
                        key={f.tg_id}
                        onClick={() => handleOpenPrivateChat(f)}
                        className="flex items-center justify-between p-3.5 bg-slate-900/20 hover:bg-slate-900/40 border border-slate-900/60 hover:border-slate-900 rounded-2xl transition-all duration-200 cursor-pointer group shadow-sm active:scale-[0.99] animate-fade-in"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10.5 h-10.5 rounded-xl bg-slate-800 text-slate-200 flex items-center justify-center font-bold text-base shadow-inner uppercase group-hover:scale-105 transition">
                            {f.first_name.charAt(0)}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <div className="font-bold text-slate-100 text-sm flex items-center gap-1.5">
                              {f.first_name}
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5 truncate flex items-center gap-1">
                              <Lock className="w-3 h-3 text-slate-500" /> Личный зашифрованный чат
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-slate-500 group-hover:text-primary transition">
                          <span className="text-[10px] font-mono font-bold tracking-widest mr-1 text-slate-600">PM</span>
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </div>
                    ))}

                  {/* Empty states for filters */}
                  {activeTab === 'groups' && !hasGroups && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <Users className="w-10 h-10 text-slate-600 mb-3" />
                      <p className="text-slate-500 text-sm">
                        {isSearching ? 'Группы по вашему запросу не найдены' : 'Нет активных групповых сходняков'}
                      </p>
                    </div>
                  )}

                  {activeTab === 'friends' && !hasFriends && !hasRequests && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <Users className="w-10 h-10 text-slate-600 mb-3" />
                      <p className="text-slate-500 text-sm">
                        {isSearching ? 'Контакты по вашему запросу не найдены' : 'Братва пуста. Добавьте друзей по Telegram ID!'}
                      </p>
                    </div>
                  )}
                  
                  {activeTab === 'all' && !hasFriends && !hasGroups && !hasRequests && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <Users className="w-10 h-10 text-slate-600 mb-3 animate-pulse" />
                      <p className="text-slate-400 text-sm max-w-[240px] leading-relaxed">
                        {isSearching
                          ? 'Ничего не найдено по вашему запросу'
                          : 'У вас еще нет контактов или групп. Добавьте друзей, чтобы начать секретное общение!'}
                      </p>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Install Prompt Modal */}
      {showInstallPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-4 sm:p-5 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto scrollbar-thin my-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                <Download className="w-5 h-5 text-primary" />
                Установка Синдиката
              </h3>
              <button
                onClick={() => setShowInstallPrompt(false)}
                className="p-2 text-slate-400 hover:text-white rounded-full bg-slate-800/50 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="text-sm text-slate-300 leading-relaxed bg-slate-800/50 p-4 rounded-xl">
              <p className="mb-3">Для установки приложения на ваш телефон:</p>
              <ul className="list-disc list-inside space-y-2 text-slate-400 marker:text-primary">
                <li><strong className="text-slate-200">iOS (Safari):</strong> Нажмите "Поделиться" и выберите "На экран домой".</li>
                <li><strong className="text-slate-200">Android/ПК:</strong> Выберите "Установить приложение" или "Добавить на экран" в меню браузера (обычно 3 точки).</li>
              </ul>
            </div>
            
            <div className="mt-2 text-center">
              <p className="text-xs text-slate-500 mb-2">Открыли из Telegram? Скопируйте ссылку и откройте в Safari/Chrome:</p>
              <button
                onClick={() => {
                  const url = new URL(window.location.href);
                  url.hash = '';
                  navigator.clipboard.writeText(url.toString());
                  alert('Безопасная ссылка на приложение скопирована. Войдите на новом устройстве отдельно.');
                }}
                className="w-full py-2.5 bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-white transition rounded-xl font-medium"
              >
                Скопировать ссылку на приложение
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && currentUser && (
        <SettingsModal
          userId={currentUser.id}
          userName={currentUser.first_name}
          myFingerprint={myFingerprint}
          onClose={() => setShowSettings(false)}
          worker={workerRef.current}
          onPanicWipe={triggerPanicWipe}
          onPinSetup={(type) => {
            setPinType(type);
            const savedHash = localStorage.getItem(type === 'panic' ? 'synd_panic_pin_hash' : 'synd_pin_hash');
            setPinMode(savedHash ? (type === 'panic' ? 'disable_panic' : 'disable_normal') : 'setup_1');
            setIsPinLocked(true);
            setShowSettings(false);
          }}
          onUpdateName={(newName) => {
            setCurrentUser((prev) => prev ? { ...prev, first_name: newName } : null);
          }}
        />
      )}

      {/* Create Group Modal */}
      {showCreateGroup && (
        <div className="fixed inset-0 z-[1000] bg-slate-950/80 backdrop-blur-md flex flex-col justify-center p-4 sm:p-6 animate-fade-in overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 p-5 sm:p-6 rounded-2xl flex flex-col gap-4 max-w-md w-full mx-auto relative max-h-[90vh] overflow-y-auto scrollbar-thin my-auto">
            <button
              onClick={() => setShowCreateGroup(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-300"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="font-bold text-slate-100 text-lg mb-1">Создать новую группу</h3>
            <input
              type="text"
              placeholder="Название группы..."
              value={groupNameInput}
              onChange={(e) => setGroupNameInput(e.target.value)}
              className="w-full bg-slate-950 border border-slate-900 text-slate-200 rounded-xl px-4 py-3 outline-none focus:border-primary"
            />
            <button
              onClick={handleCreateGroup}
              className="bg-primary hover:bg-primary-hover text-white font-semibold py-3.5 rounded-xl transition"
            >
              Создать
            </button>
          </div>
        </div>
      )}

      {/* Add Friend Modal */}
      {showAddFriend && (
        <div className="fixed inset-0 z-[1000] bg-slate-950/85 backdrop-blur-md flex flex-col justify-center p-3 sm:p-5 animate-fade-in font-sans overflow-y-auto overflow-x-hidden">
          <div className="bg-gradient-to-br from-slate-900/95 to-slate-950/95 border border-slate-800/90 p-4 sm:p-6 rounded-3xl flex flex-col gap-4 sm:gap-5 max-w-md w-full mx-auto relative shadow-2xl max-h-[95vh] overflow-y-auto scrollbar-none my-auto">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
            
            <button
              onClick={() => setShowAddFriend(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition-colors bg-slate-950/50 p-1.5 rounded-full"
            >
              <X className="w-4 h-4" />
            </button>
            
            <div className="flex flex-col gap-1 pr-8">
              <h3 className="font-extrabold font-mono tracking-tight text-slate-100 text-lg sm:text-xl uppercase">Добавить контакт</h3>
              <p className="text-[10px] sm:text-[11px] text-slate-400 leading-relaxed font-semibold">
                Введите идентификатор пользователя для безопасного соединения
              </p>
            </div>

            {currentUser && (
              <div className="flex flex-col gap-1">
                <span className="text-[9px] sm:text-[10px] text-slate-500 font-bold font-mono tracking-wider uppercase pl-1">Ваш ID</span>
                <div className="flex items-center justify-between bg-slate-950/60 rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3 border border-slate-800/80">
                  <span className="text-xs sm:text-sm text-slate-300 font-mono font-bold select-all">{currentUser.id}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(currentUser.id.toString());
                      hapticImpact("success");
                    }}
                    className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-primary font-bold font-mono text-[9px] sm:text-[10px] uppercase tracking-wider px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-lg transition-colors cursor-pointer border border-primary/20"
                    title="Копировать"
                  >
                    <Copy className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                    Копировать
                  </button>
                </div>
              </div>
            )}
            
            <div className="flex flex-col gap-1">
              <span className="text-[9px] sm:text-[10px] text-slate-500 font-bold font-mono tracking-wider uppercase pl-1">ID Контакта</span>
              <input
                type="number"
                placeholder="000000000"
                value={friendIdInput}
                onChange={(e) => setFriendIdInput(e.target.value)}
                className="w-full bg-slate-950/50 border border-slate-800 focus:border-primary/50 text-slate-100 rounded-2xl px-4 py-3 sm:px-5 sm:py-4 font-mono font-bold text-base sm:text-lg outline-none transition-colors"
              />
            </div>
            
            <button
              onClick={handleAddFriend}
              disabled={searchSpinner}
              className="w-full bg-primary hover:bg-primary-hover active:bg-primary/90 text-white font-bold font-mono tracking-wide py-3 sm:py-4 rounded-2xl flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] mt-1 shadow-lg shadow-primary/20 disabled:opacity-70 disabled:active:scale-100"
            >
              {searchSpinner ? <Loader2 className="w-5 h-5 animate-spin" /> : 'ОТПРАВИТЬ ЗАПРОС'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}