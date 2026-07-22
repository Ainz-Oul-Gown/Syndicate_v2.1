import { readSessionToken, writeSessionToken } from './lib/sessionStorage';
import { LoginScreen } from './components/LoginScreen';
import type { StartupState } from './components/StartupScreen';
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
    Pin,
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
import { DRAFT_CHANGED_EVENT, readDraftPreviews, type DraftChangedDetail } from './lib/drafts';
import { listenForForegroundPush, refreshPushRegistration } from './lib/pushNotifications';

type TelegramMiniAppContext = {
    initData: string;
    id: number;
    firstName: string;
    lastName?: string | null;
    username?: string | null;
    photoUrl?: string | null;
};

type DraftPreview = {
    chatId: string;
    text: string;
    updatedAt: number;
    chatName?: string;
    chatType?: Chat['type'];
    friendId?: number;
};

export default function App() {
    const [currentUser, setCurrentUser] = useState<{ id: number; first_name: string } | null>(null);
    const [telegramMiniAppContext, setTelegramMiniAppContext] = useState<TelegramMiniAppContext | null>(null);
    const [myFingerprint, setMyFingerprint] = useState<string | null>(null);
    const [isAuth, setIsAuth] = useState(false);
    const [loadingText, setLoadingText] = useState('Проверяем сессию…');
    const [startupState, setStartupState] = useState<StartupState>('loading');
    const retryBootstrapRef = useRef<() => void>(() => window.location.reload());
    const bootstrapRunningRef = useRef(false);

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
        let unsubscribe = () => {};
        void listenForForegroundPush().then((fn) => { unsubscribe = fn; });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!currentUser) return;
        void refreshPushRegistration();
    }, [currentUser]);

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
    const [draftPreviews, setDraftPreviews] = useState<Record<string, DraftPreview>>({});
    const [unreadChatIds, setUnreadChatIds] = useState<Set<string>>(new Set());
    const [privateChatByFriendId, setPrivateChatByFriendId] = useState<Record<number, string>>({});
    const [pinnedChatIds, setPinnedChatIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!currentUser) {
            setDraftPreviews({});
            return;
        }

        let disposed = false;
        const loadDrafts = async () => {
            const stored = await readDraftPreviews(currentUser.id);
            if (disposed) return;
            const next: Record<string, DraftPreview> = {};
            for (const item of stored) {
                next[item.chatId] = {
                    chatId: item.chatId,
                    text: item.text,
                    updatedAt: item.draft.updatedAt,
                    chatName: item.draft.chatName,
                    chatType: item.draft.chatType,
                    friendId: item.draft.friendId,
                };
            }
            setDraftPreviews(next);
        };

        void loadDrafts();

        const onDraftChanged = (event: Event) => {
            const detail = (event as CustomEvent<DraftChangedDetail>).detail;
            if (!detail || detail.userId !== currentUser.id) return;
            setDraftPreviews((current) => {
                const next = { ...current };
                if (!detail.text.trim()) {
                    delete next[detail.chat.id];
                    return next;
                }
                next[detail.chat.id] = {
                    chatId: detail.chat.id,
                    text: detail.text,
                    updatedAt: detail.updatedAt,
                    chatName: detail.chat.name,
                    chatType: detail.chat.type,
                    friendId: detail.chat.friendId,
                };
                return next;
            });
        };

        window.addEventListener(DRAFT_CHANGED_EVENT, onDraftChanged);
        return () => {
            disposed = true;
            window.removeEventListener(DRAFT_CHANGED_EVENT, onDraftChanged);
        };
    }, [currentUser]);


    const pinnedChatsStorageKey = currentUser ? `synd_pinned_chats_${currentUser.id}` : '';

    useEffect(() => {
        if (!pinnedChatsStorageKey) {
            setPinnedChatIds(new Set());
            return;
        }
        try {
            const stored = JSON.parse(localStorage.getItem(pinnedChatsStorageKey) || '[]');
            setPinnedChatIds(new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []));
        } catch {
            setPinnedChatIds(new Set());
        }
    }, [pinnedChatsStorageKey]);

    const toggleChatPin = (chatId: string) => {
        if (!pinnedChatsStorageKey) return;
        hapticImpact('selection');
        setPinnedChatIds((current) => {
            const next = new Set(current);
            if (next.has(chatId)) next.delete(chatId); else next.add(chatId);
            localStorage.setItem(pinnedChatsStorageKey, JSON.stringify([...next]));
            return next;
        });
    };

    const unreadStorageKey = currentUser ? `synd_unread_state_${currentUser.id}` : '';

    const readUnreadState = () => {
        if (!unreadStorageKey) return { initializedAt: Date.now(), readAt: {} as Record<string, number> };
        try {
            const raw = localStorage.getItem(unreadStorageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                return {
                    initializedAt: Number(parsed.initializedAt) || Date.now(),
                    readAt: parsed.readAt && typeof parsed.readAt === 'object' ? parsed.readAt as Record<string, number> : {},
                };
            }
        } catch (error) {
            console.warn('Failed to read unread state', error);
        }
        const fresh = { initializedAt: Date.now(), readAt: {} as Record<string, number> };
        if (unreadStorageKey) localStorage.setItem(unreadStorageKey, JSON.stringify(fresh));
        return fresh;
    };

    const markChatRead = (chatId: string) => {
        if (!chatId || !unreadStorageKey) return;
        const state = readUnreadState();
        state.readAt[chatId] = Date.now();
        localStorage.setItem(unreadStorageKey, JSON.stringify(state));
        setUnreadChatIds((current) => {
            if (!current.has(chatId)) return current;
            const next = new Set(current);
            next.delete(chatId);
            return next;
        });
    };

    useEffect(() => {
        if (!currentUser) {
            setUnreadChatIds(new Set());
            return;
        }

        let disposed = false;
        const syncUnread = async () => {
            const state = readUnreadState();
            const oldestRead = Math.min(state.initializedAt, ...Object.values(state.readAt));
            const { data, error } = await supabaseClient
                .from('messages')
                .select('chat_id, sender_id, created_at')
                .neq('sender_id', currentUser.id)
                .gt('created_at', new Date(oldestRead).toISOString())
                .order('created_at', { ascending: false })
                .limit(500);

            if (error) {
                console.warn('Failed to sync unread markers', error);
                return;
            }
            if (disposed) return;

            const next = new Set<string>();
            for (const message of data || []) {
                const readAt = state.readAt[message.chat_id] || state.initializedAt;
                if (new Date(message.created_at).getTime() > readAt) next.add(message.chat_id);
            }
            if (activeScreen === 'chat' && activeChat?.id) next.delete(activeChat.id);
            setUnreadChatIds(next);
        };

        void syncUnread();

        const channel = supabaseClient
            .channel(`unread-messages-${currentUser.id}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                (payload: any) => {
                    const message = payload.new;
                    if (!message?.chat_id || message.sender_id === currentUser.id) return;
                    if (activeScreen === 'chat' && activeChat?.id === message.chat_id) {
                        markChatRead(message.chat_id);
                        return;
                    }
                    setUnreadChatIds((current) => {
                        if (current.has(message.chat_id)) return current;
                        const next = new Set(current);
                        next.add(message.chat_id);
                        return next;
                    });
                },
            )
            .subscribe();

        const onVisible = () => {
            if (document.visibilityState === 'visible') void syncUnread();
        };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            disposed = true;
            document.removeEventListener('visibilitychange', onVisible);
            void supabaseClient.removeChannel(channel);
        };
    }, [currentUser, activeScreen, activeChat?.id]);

    const formatDraftPreview = (text: string) => {
        const compact = text.replace(/\s+/g, ' ').trim();
        return compact.length > 72 ? `${compact.slice(0, 72)}…` : compact;
    };

    const findPrivateDraft = (friendId: number) =>
        (Object.values(draftPreviews) as DraftPreview[]).find((draft) => draft.chatType === 'private' && draft.friendId === friendId);

    // Input bindings
    const [friendIdInput, setFriendIdInput] = useState('');
    const [groupNameInput, setGroupNameInput] = useState('');
    const [searchSpinner, setSearchSpinner] = useState(false);
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);
    const [pendingFriendRequestId, setPendingFriendRequestId] = useState<string | null>(null);

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
                setLoadingText('Проверяем сессию…');
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
                setLoadingText('Подключаемся…');
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
                    supabaseClient.from('chats').select('id, name, type, created_at, created_by').in('id', chatIds).then(async ({ data: chatsData }) => {
                        const allChats = chatsData || [];
                        const groups = allChats.filter((c) => c.type === 'group');
                        setGroupChats(groups);
                        localStorage.setItem('synd_cached_groups', JSON.stringify(groups));

                        const privateIds = allChats.filter((c) => c.type === 'private').map((c) => c.id);
                        if (privateIds.length > 0) {
                            const { data: privateMembers } = await supabaseClient
                                .from('chat_keys')
                                .select('chat_id, user_id')
                                .in('chat_id', privateIds)
                                .neq('user_id', userId);
                            const mapping: Record<number, string> = {};
                            for (const member of privateMembers || []) mapping[member.user_id] = member.chat_id;
                            setPrivateChatByFriendId(mapping);
                        } else {
                            setPrivateChatByFriendId({});
                        }
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

    const collectEncryptedDeviceKeys = async (
        aesKey: CryptoKey,
        rawPublicKey: string | null | undefined,
    ): Promise<Record<string, string>> => {
        let parsed: Record<string, any>;

        try {
            parsed = JSON.parse(rawPublicKey || '{}');
        } catch {
            throw new Error('Повреждён контейнер публичных ключей');
        }

        if (parsed.kty === 'RSA') {
            parsed = { legacy: { rsa: parsed } };
        }

        const encryptedKeys: Record<string, string> = {};

        for (const [deviceId, keyContainer] of Object.entries(parsed)) {
            if (deviceId === 'vault' || !keyContainer || typeof keyContainer !== 'object') {
                continue;
            }

            const candidate = keyContainer as Record<string, any>;
            const rsaJwk =
                candidate.rsa?.kty === 'RSA'
                    ? candidate.rsa
                    : candidate.kty === 'RSA'
                        ? candidate
                        : null;

            if (!rsaJwk) continue;

            encryptedKeys[deviceId] = await encryptChatKeyForFriend(aesKey, rsaJwk);
        }

        if (Object.keys(encryptedKeys).length === 0) {
            throw new Error('У пользователя отсутствует корректный RSA-ключ');
        }

        return encryptedKeys;
    };

    const handleOpenSavedMessages = async () => {
        if (!currentUser) return;
        hapticImpact('selection');

        try {
            const { data: myKeys, error: keysError } = await supabaseClient
                .from('chat_keys')
                .select('chat_id')
                .eq('user_id', currentUser.id);

            if (keysError) throw keysError;

            let savedChatId = '';

            if (myKeys?.length) {
                const { data: chatsData, error: chatsError } = await supabaseClient
                    .from('chats')
                    .select('id, name, type, created_at, created_by')
                    .eq('type', 'saved')
                    .in('id', myKeys.map((key) => key.chat_id))
                    .limit(1);

                if (chatsError) throw chatsError;
                savedChatId = chatsData?.[0]?.id || '';
            }

            let activeChatObj: Chat;

            if (savedChatId) {
                activeChatObj = {
                    id: savedChatId,
                    name: 'Избранное',
                    type: 'saved',
                };
            } else {
                const { data: myData, error: userError } = await supabaseClient
                    .from('users')
                    .select('public_key')
                    .eq('tg_id', currentUser.id)
                    .maybeSingle();

                if (userError) throw userError;
                if (!myData?.public_key) {
                    throw new Error('В профиле отсутствует публичный ключ');
                }

                const aesKey = await generateChatKey();
                const encryptedKeys = await collectEncryptedDeviceKeys(
                    aesKey,
                    myData.public_key,
                );

                const { data: newChatData, error: createError } = await supabaseClient
                    .rpc('create_saved_chat', {
                        encrypted_key: JSON.stringify(encryptedKeys),
                    })
                    .single();

                if (createError) throw createError;

                const newChat = newChatData as {
                    id: string;
                    name: string;
                    type: 'saved';
                } | null;

                if (!newChat?.id) {
                    throw new Error('Сервер не вернул созданный чат');
                }

                await idbKeyval.set(`aes_key_${newChat.id}`, aesKey);

                activeChatObj = {
                    id: newChat.id,
                    name: 'Избранное',
                    type: 'saved',
                };
            }

            markChatRead(activeChatObj.id);
            setActiveChat(activeChatObj);
            setActiveScreen('chat');
        } catch (err) {
            console.error('Failed to open Saved Messages', err);
        }
    };

    const handleOpenPrivateChat = async (friend: User) => {
        if (!currentUser) return;
        hapticImpact('selection');

        try {
            const { data: existingChatId, error: lookupError } =
                await supabaseClient.rpc('get_private_chat', {
                    user1_id: currentUser.id,
                    user2_id: friend.tg_id,
                });

            if (lookupError) throw lookupError;

            let activeChatObj: Chat;

            if (existingChatId) {
                activeChatObj = {
                    id: existingChatId as string,
                    name: friend.first_name,
                    type: 'private',
                    friendId: friend.tg_id,
                };
            } else {
                const [friendResult, myResult] = await Promise.all([
                    supabaseClient
                        .from('users')
                        .select('public_key')
                        .eq('tg_id', friend.tg_id)
                        .maybeSingle(),
                    supabaseClient
                        .from('users')
                        .select('public_key')
                        .eq('tg_id', currentUser.id)
                        .maybeSingle(),
                ]);

                if (friendResult.error) throw friendResult.error;
                if (myResult.error) throw myResult.error;

                if (!friendResult.data?.public_key) {
                    throw new Error('У друга отсутствует публичный ключ');
                }
                if (!myResult.data?.public_key) {
                    throw new Error('У текущего пользователя отсутствует публичный ключ');
                }

                const aesKey = await generateChatKey();
                const [friendEncryptedKeys, myEncryptedKeys] = await Promise.all([
                    collectEncryptedDeviceKeys(aesKey, friendResult.data.public_key),
                    collectEncryptedDeviceKeys(aesKey, myResult.data.public_key),
                ]);

                const { data: newChatData, error: createError } = await supabaseClient
                    .rpc('create_private_chat', {
                        friend_id: friend.tg_id,
                        my_encrypted_key: JSON.stringify(myEncryptedKeys),
                        friend_encrypted_key: JSON.stringify(friendEncryptedKeys),
                    })
                    .single();

                if (createError) throw createError;

                const newChat = newChatData as {
                    id: string;
                    name: string;
                    type: 'private';
                } | null;

                if (!newChat?.id) {
                    throw new Error('Сервер не вернул приватный чат');
                }

                await idbKeyval.set(`aes_key_${newChat.id}`, aesKey);

                activeChatObj = {
                    id: newChat.id,
                    name: friend.first_name,
                    type: 'private',
                    friendId: friend.tg_id,
                };
            }

            markChatRead(activeChatObj.id);
            setActiveChat(activeChatObj);
            setActiveScreen('chat');
        } catch (err) {
            console.error('Failed to open private chat', err);
        }
    };

    const handleOpenGroupChat = (g: Chat) => {
        hapticImpact("selection");
        markChatRead(g.id);
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
        if (!groupNameInput.trim() || !currentUser || isCreatingGroup) return;

        setIsCreatingGroup(true);
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

            if (!myData?.public_key) {
                throw new Error('В профиле отсутствует публичный ключ');
            }

            const encKeys = await collectEncryptedDeviceKeys(
                aesKey,
                myData.public_key,
            );

            const { data: newChatData, error: createError } = await supabaseClient
                .rpc('create_group_chat', {
                    group_name: gName,
                    creator_encrypted_key: JSON.stringify(encKeys),
                })
                .single();

            if (createError) throw createError;

            const newChat = newChatData as { id: string } | null;

            if (!newChat?.id) {
                throw new Error('Не удалось создать группу');
            }

            await idbKeyval.set(`aes_key_${newChat.id}`, aesKey);

            hapticImpact("success");
            loadChatsAndFriends(currentUser.id);
            alert(`Группа "${gName}" успешно создана!`);
        } catch (err) {
            console.error(err);
            alert(err instanceof Error ? err.message : 'Не удалось создать группу');
        } finally {
            setIsCreatingGroup(false);
        }
    };

    const handleAcceptFriend = async (reqId: string) => {
        if (!currentUser || pendingFriendRequestId) return;
        setPendingFriendRequestId(reqId);
        try {
            const { error } = await supabaseClient.rpc('respond_friend_request', { request_id: reqId, accept_request: true });
            if (error) throw error;
            hapticImpact("success");
            loadChatsAndFriends(currentUser.id);
        } catch (e) {
            console.error(e);
            alert('Не удалось принять запрос');
        } finally {
            setPendingFriendRequestId(null);
        }
    };

    const handleRejectFriend = async (reqId: string) => {
        if (!currentUser || pendingFriendRequestId) return;
        setPendingFriendRequestId(reqId);
        try {
            const { error } = await supabaseClient.rpc('respond_friend_request', { request_id: reqId, accept_request: false });
            if (error) throw error;
            hapticImpact("warning");
            loadChatsAndFriends(currentUser.id);
        } catch (e) {
            console.error(e);
            alert('Не удалось отклонить запрос');
        } finally {
            setPendingFriendRequestId(null);
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
                } catch (e) { }
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
        } catch (e) { }

        try {
            localStorage.clear();
            sessionStorage.clear();
        } catch (e) { }

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
        } catch (e) { }

        // 6. Полностью очищаем все кэши (Cache Storage)
        try {
            if (window.caches) {
                const cacheKeys = await window.caches.keys();
                for (const key of cacheKeys) {
                    await window.caches.delete(key);
                }
            }
        } catch (e) { }

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
            if (bootstrapRunningRef.current) return;
            bootstrapRunningRef.current = true;
            setStartupState('loading');
            setLoadingText('Проверяем сессию…');

            try {
                if (!navigator.onLine) {
                    setStartupState('offline');
                    setLoadingText('Для безопасной проверки сессии требуется интернет-соединение.');
                    return;
                }

                // Try reading cache for instant UI
                const cachedUsers = localStorage.getItem('synd_cached_users');
                const cachedGroups = localStorage.getItem('synd_cached_groups');
                if (cachedUsers) setFriends(JSON.parse(cachedUsers));
                if (cachedGroups) setGroupChats(JSON.parse(cachedGroups));

                const authData = await authUser();
                const activeUser = authData || currentUser;

                if (activeUser) {
                    // Check if local keys exist before registering this device as trusted.
                    setLoadingText('Загружаем ключи…');
                    const keyStatus = await checkCryptoKeys(activeUser.id);
                    if (keyStatus.ready) {
                        setLoadingText('Подключаемся…');
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
                        setIsAuth(true);
                    } else {
                        // New device! Prompt sync request popup
                        setIsAuth(true);
                        await syncDeviceKeys(activeUser.id);
                    }
                } else {
                    setStartupState('error');
                    setLoadingText('Войдите удобным способом, чтобы продолжить.');
                }
            } catch (err: any) {
                console.error(err);
                setStartupState(navigator.onLine ? 'error' : 'offline');
                setLoadingText(navigator.onLine
                    ? 'Не удалось завершить запуск. Проверьте соединение и попробуйте ещё раз.'
                    : 'Для безопасной проверки сессии требуется интернет-соединение.');
            } finally {
                bootstrapRunningRef.current = false;
            }
        };

        retryBootstrapRef.current = bootstrap;
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

        const handleStartupOnline = () => {
            void retryBootstrapRef.current();
        };

        document.addEventListener('visibilitychange', handleBackgroundAutoLock);
        window.addEventListener('online', handleStartupOnline);

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
            window.removeEventListener('online', handleStartupOnline);
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
        const showLogin = loadingText.startsWith('Войдите');
        return (
            <LoginScreen
                isError={showLogin}
                loadingText={loadingText}
                startupState={startupState}
                onRetryStartup={() => void retryBootstrapRef.current()}
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
                                    className={`flex-1 text-center py-2 px-2.5 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer ${isActive
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
                            const pinnedOrder = [...pinnedChatIds]; // preserves insertion order
                            const chatPriority = (chatId?: string) => {
                                if (!chatId) return [2, 0];
                                if (pinnedChatIds.has(chatId)) {
                                    const idx = pinnedOrder.indexOf(chatId);
                                    return [0, idx >= 0 ? idx : 0]; // pinned: sort by pin order
                                }
                                if (unreadChatIds.has(chatId)) return [1, 0];
                                return [2, 0];
                            };
                            const filteredGroupChats = groupChats
                                .filter((g) => g.name.toLowerCase().includes(chatSearch.toLowerCase()))
                                .sort((a, b) => {
                                    const [pa, oa] = chatPriority(a.id);
                                    const [pb, ob] = chatPriority(b.id);
                                    return pa !== pb ? pa - pb : oa - ob;
                                });
                            const filteredFriends = friends
                                .filter((f) => f.first_name.toLowerCase().includes(chatSearch.toLowerCase()))
                                .sort((a, b) => {
                                    const [pa, oa] = chatPriority(privateChatByFriendId[a.tg_id]);
                                    const [pb, ob] = chatPriority(privateChatByFriendId[b.tg_id]);
                                    return pa !== pb ? pa - pb : oa - ob;
                                });

                            const hasRequests = filteredRequests.length > 0;
                            const hasGroups = filteredGroupChats.length > 0;
                            const hasFriends = filteredFriends.length > 0;
                            const isSearching = chatSearch.trim() !== '';
                            const savedDraft = (Object.values(draftPreviews) as DraftPreview[]).find((draft) => draft.chatType === 'saved');

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
                                                        disabled={pendingFriendRequestId !== null}
                                                        className="w-8.5 h-8.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center transition active:scale-95 cursor-pointer shadow-md disabled:opacity-60 disabled:cursor-wait disabled:active:scale-100"
                                                        title={pendingFriendRequestId === req.id ? 'Принимаем…' : 'Принять'}
                                                        aria-label={pendingFriendRequestId === req.id ? 'Принимаем запрос' : 'Принять запрос'}
                                                    >
                                                        {pendingFriendRequestId === req.id ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <UserCheck className="w-4.5 h-4.5" />}
                                                    </button>
                                                    <button
                                                        onClick={() => handleRejectFriend(req.id)}
                                                        disabled={pendingFriendRequestId !== null}
                                                        className="w-8.5 h-8.5 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 text-rose-500 flex items-center justify-center transition active:scale-95 cursor-pointer disabled:opacity-60 disabled:cursor-wait disabled:active:scale-100"
                                                        title={pendingFriendRequestId === req.id ? 'Отклоняем…' : 'Отклонить'}
                                                        aria-label={pendingFriendRequestId === req.id ? 'Отклоняем запрос' : 'Отклонить запрос'}
                                                    >
                                                        {pendingFriendRequestId === req.id ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <UserMinus className="w-4.5 h-4.5" />}
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
                                                    <div className={`text-[11px] mt-0.5 truncate ${savedDraft ? 'text-amber-400 font-semibold' : 'text-slate-400'}`}>
                                                        {savedDraft ? `Черновик: ${formatDraftPreview(savedDraft.text)}` : 'Личный архив заметок, файлов и аудио'}
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
                                        filteredGroupChats.map((g) => {
                                            const draft = draftPreviews[g.id];
                                            return (
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
                                                        <div className={`text-[11px] mt-0.5 truncate flex items-center gap-1 ${draft ? 'text-amber-400 font-semibold' : 'text-slate-400'}`}>
                                                            {draft ? <>Черновик: {formatDraftPreview(draft.text)}</> : <><Users className="w-3 h-3 text-slate-500" /> Групповой защищенный канал</>}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 text-slate-500 group-hover:text-primary transition">
                                                    <button
                                                        type="button"
                                                        onClick={(event) => { event.stopPropagation(); toggleChatPin(g.id); }}
                                                        className={`p-1 rounded-md transition ${pinnedChatIds.has(g.id) ? 'text-amber-400 bg-amber-400/10' : 'text-slate-600 hover:text-slate-300'}`}
                                                        aria-label={pinnedChatIds.has(g.id) ? 'Открепить чат' : 'Закрепить чат'}
                                                        title={pinnedChatIds.has(g.id) ? 'Открепить чат' : 'Закрепить чат'}
                                                    >
                                                        <Pin className={`w-3.5 h-3.5 ${pinnedChatIds.has(g.id) ? 'fill-current' : ''}`} />
                                                    </button>
                                                    {unreadChatIds.has(g.id) && (
                                                        <span
                                                            className="w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_10px_rgba(34,211,238,0.65)] flex-shrink-0"
                                                            role="status"
                                                            aria-label="Есть новые сообщения"
                                                        />
                                                    )}
                                                    <span className="text-[10px] font-mono font-bold tracking-widest mr-1 text-slate-600">SECURE</span>
                                                    <ChevronRight className="w-4 h-4" />
                                                </div>
                                            </div>
                                            );
                                        })}

                                    {/* 4. Friends list (PM) */}
                                    {(activeTab === 'all' || activeTab === 'friends') &&
                                        filteredFriends.map((f) => {
                                            const draft = findPrivateDraft(f.tg_id);
                                            return (
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
                                                        <div className={`text-[11px] mt-0.5 truncate flex items-center gap-1 ${draft ? 'text-amber-400 font-semibold' : 'text-slate-400'}`}>
                                                            {draft ? <>Черновик: {formatDraftPreview(draft.text)}</> : <><Lock className="w-3 h-3 text-slate-500" /> Личный зашифрованный чат</>}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 text-slate-500 group-hover:text-primary transition">
                                                    {privateChatByFriendId[f.tg_id] && (
                                                        <button
                                                            type="button"
                                                            onClick={(event) => { event.stopPropagation(); toggleChatPin(privateChatByFriendId[f.tg_id]); }}
                                                            className={`p-1 rounded-md transition ${pinnedChatIds.has(privateChatByFriendId[f.tg_id]) ? 'text-amber-400 bg-amber-400/10' : 'text-slate-600 hover:text-slate-300'}`}
                                                            aria-label={pinnedChatIds.has(privateChatByFriendId[f.tg_id]) ? 'Открепить чат' : 'Закрепить чат'}
                                                            title={pinnedChatIds.has(privateChatByFriendId[f.tg_id]) ? 'Открепить чат' : 'Закрепить чат'}
                                                        >
                                                            <Pin className={`w-3.5 h-3.5 ${pinnedChatIds.has(privateChatByFriendId[f.tg_id]) ? 'fill-current' : ''}`} />
                                                        </button>
                                                    )}
                                                    {privateChatByFriendId[f.tg_id] && unreadChatIds.has(privateChatByFriendId[f.tg_id]) && (
                                                        <span
                                                            className="w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_10px_rgba(34,211,238,0.65)] flex-shrink-0"
                                                            role="status"
                                                            aria-label="Есть новые сообщения"
                                                        />
                                                    )}
                                                    <span className="text-[10px] font-mono font-bold tracking-widest mr-1 text-slate-600">PM</span>
                                                    <ChevronRight className="w-4 h-4" />
                                                </div>
                                            </div>
                                            );
                                        })}

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
                            onClick={() => !isCreatingGroup && setShowCreateGroup(false)}
                            disabled={isCreatingGroup}
                            className="absolute top-4 right-4 disabled:opacity-40 disabled:cursor-wait text-slate-500 hover:text-slate-300"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        <h3 className="font-bold text-slate-100 text-lg mb-1">Создать новую группу</h3>
                        <input
                            type="text"
                            placeholder="Название группы..."
                            value={groupNameInput}
                            onChange={(e) => setGroupNameInput(e.target.value)}
                            disabled={isCreatingGroup}
                            className="w-full bg-slate-950 border border-slate-900 text-slate-200 rounded-xl px-4 py-3 outline-none focus:border-primary"
                        />
                        <button
                            onClick={handleCreateGroup}
                            disabled={isCreatingGroup || !groupNameInput.trim()}
                            className="bg-primary hover:bg-primary-hover text-white font-semibold py-3.5 rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-primary"
                        >
                            {isCreatingGroup && <Loader2 className="w-5 h-5 animate-spin" />}
                            {isCreatingGroup ? 'Создаём…' : 'Создать'}
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
                            onClick={() => !searchSpinner && setShowAddFriend(false)}
                            disabled={searchSpinner}
                            className="absolute top-4 right-4 text-slate-500 disabled:opacity-40 disabled:cursor-wait hover:text-slate-300 transition-colors bg-slate-950/50 p-1.5 rounded-full"
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
                                disabled={searchSpinner}
                                className="w-full bg-slate-950/50 border border-slate-800 focus:border-primary/50 text-slate-100 rounded-2xl px-4 py-3 sm:px-5 sm:py-4 font-mono font-bold text-base sm:text-lg outline-none transition-colors"
                            />
                        </div>

                        <button
                            onClick={handleAddFriend}
                            disabled={searchSpinner}
                            className="w-full bg-primary hover:bg-primary-hover active:bg-primary/90 text-white font-bold font-mono tracking-wide py-3 sm:py-4 rounded-2xl flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] mt-1 shadow-lg shadow-primary/20 disabled:opacity-70 disabled:active:scale-100"
                        >
                            {searchSpinner && <Loader2 className="w-5 h-5 animate-spin" />}
                            {searchSpinner ? 'ОТПРАВЛЯЕМ…' : 'ОТПРАВИТЬ ЗАПРОС'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}