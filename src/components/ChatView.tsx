import { hapticImpact } from "../lib/haptics";
import { useState, useEffect, useRef, FormEvent, UIEvent, TouchEvent, MouseEvent } from 'react';
import {
    ChevronLeft,
    Search,
    Wallet,
    MoreVertical,
    Mic,
    Send,
    X,
    Trash2,
    Play,
    Pause,
    ArrowDown,
    UserMinus,
    UserPlus,
    Edit2,
    Trash,
    LogOut,
    HelpCircle,
    Loader2,
    Check,
    Shield,
    Plus,
    History,
    Calendar,
    AlertTriangle,
    Pin,
    PinOff,
    Reply,
} from 'lucide-react';
import * as idbKeyval from 'idb-keyval';
import { decryptChatDraft, emitDraftChanged, encryptChatDraft, getDraftStorageKey, type EncryptedChatDraft } from '../lib/drafts';
import { supabaseClient } from '../lib/supabase';
import {
    encryptText,
    decryptText,
    generateChatKey,
    encryptChatKeyForFriend,
    decryptChatKey,
    getFingerprint,
} from '../lib/crypto';
import { Chat, DecryptedMessage, Message, User, Currency, Debt, ReplyData } from '../types';
import VoicePlayer from './VoicePlayer';
import DeepSearch from './DeepSearch';
import { getCachedEmbeddingPipeline } from '../lib/ai';
import { isOnline, NETWORK_STATE_EVENT, type NetworkStateDetail } from '../lib/network';
import { notify } from '../lib/notifications';

interface ChatViewProps {
    chat: Chat;
    currentUser: { id: number; first_name: string };
    onBack: () => void;
    worker: Worker | null;
}

let globalAudioStream: MediaStream | null = null;

export default function ChatView({ chat, currentUser, onBack, worker }: ChatViewProps) {
    const [messages, setMessages] = useState<DecryptedMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [chatKey, setChatKey] = useState<CryptoKey | null>(null);
    const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const draftTextRef = useRef('');

    // Pagination & Loading states
    const [renderLimit, setRenderLimit] = useState(30);
    const [hasMoreInHistory, setHasMoreInHistory] = useState(false);
    const [isLoadingOlder, setIsLoadingOlder] = useState(false);
    const [oldestServerCursor, setOldestServerCursor] = useState<string | null>(null);
    const [isLoadingChat, setIsLoadingChat] = useState(true);

    // Nav, modals and screens
    const [activeModal, setActiveModal] = useState<'none' | 'info' | 'search' | 'debts' | 'add-debt' | 'invite-friend'>('none');
    const [activeMessageMenu, setActiveMessageMenu] = useState<string | null>(null);
    const [showScrollBottom, setShowScrollBottom] = useState(false);
    const [online, setOnline] = useState(() => isOnline());
    const [isRetryingFailed, setIsRetryingFailed] = useState(false);
    const [pinnedMessageIds, setPinnedMessageIds] = useState<Set<string>>(new Set());
    const [menuOpenUp, setMenuOpenUp] = useState(false);
    const [pinnedBannerIdx, setPinnedBannerIdx] = useState(0);
    const pinnedScrollThrottleRef = useRef(false);

    const pinnedMessagesStorageKey = `synd_pinned_messages_${currentUser.id}_${chat.id}`;

    // Sorted pinned messages by chat history (oldest first, like in chat)
    const sortedPinnedMessages = (() => {
        const pinned = messages.filter((m) => pinnedMessageIds.has(m.id));
        pinned.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        return pinned;
    })();

    // Current pinned message shown in banner (clamped safely)
    const currentPinnedForBanner = sortedPinnedMessages.length > 0
        ? sortedPinnedMessages[Math.min(pinnedBannerIdx, sortedPinnedMessages.length - 1)]
        : null;

    // Reset banner index when pinned set changes (by IDs, not just size)
    useEffect(() => {
        setPinnedBannerIdx(sortedPinnedMessages.length > 0 ? sortedPinnedMessages.length - 1 : 0);
    }, [pinnedMessageIds.size, pinnedMessageIds]);

    useEffect(() => {
        try {
            const stored = JSON.parse(localStorage.getItem(pinnedMessagesStorageKey) || '[]');
            setPinnedMessageIds(new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []));
        } catch {
            setPinnedMessageIds(new Set());
        }
    }, [pinnedMessagesStorageKey]);

    const toggleMessagePin = (messageId: string) => {
        hapticImpact('selection');
        setPinnedMessageIds((current) => {
            const next = new Set(current);
            if (next.has(messageId)) next.delete(messageId); else next.add(messageId);
            localStorage.setItem(pinnedMessagesStorageKey, JSON.stringify([...next]));
            return next;
        });
    };

    const scrollToPinnedMessage = () => {
        const pinned = messages.findLast?.((message) => pinnedMessageIds.has(message.id))
            || [...messages].reverse().find((message) => pinnedMessageIds.has(message.id));
        if (pinned) handleScrollToMessage(pinned.id);
    };

    // Banner click: scroll to the NEXT pinned message (after current trigger).
    // The scroll handler will naturally update pinnedBannerIdx when the scroll lands.
    const handlePinnedBannerClick = () => {
        if (sortedPinnedMessages.length === 0) return;
        hapticImpact('light');

        // Find the next pinned message after the current banner index
        const nextIdx = (pinnedBannerIdx + 1) % sortedPinnedMessages.length;
        const target = sortedPinnedMessages[nextIdx];
        if (target) {
            handleScrollToMessage(target.id);
        }
    };

    // Reply states
    const [replyTo, setReplyTo] = useState<ReplyData | null>(null);
    const legacyVoiceMigrationRef = useRef<Set<string>>(new Set());

    // Swipe gesture tracking
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const swipingMsgId = useRef<string | null>(null);
    const [swipeOffset, setSwipeOffset] = useState<number>(0);

    // Recording states
    const [isRecording, setIsRecording] = useState(false);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [isRecordLocked, setIsRecordingLocked] = useState(false);
    const [isRecordPaused, setIsRecordPaused] = useState(false);
    const [recordPreviewUrl, setRecordPreviewUrl] = useState<string | null>(null);
    const [isRecordPlaying, setIsRecordPlaying] = useState(false);
    const [recordPreviewProgress, setRecordPreviewProgress] = useState(0);
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);
    const [recordWaveHistory, setRecordWaveHistory] = useState<number[]>([]);
    const [micPulseScale, setMicPulseScale] = useState(1);

    // Refs for recording logic
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recStartTimeRef = useRef<number>(0);
    const recAccumulatedTimeRef = useRef<number>(0);
    const recPauseTimeRef = useRef<number>(0);
    const recTimerRef = useRef<any>(null);
    const recordVolumeIntervalRef = useRef<any>(null);

    // Audio Context for visualizer
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    // Chat Info states (members, fingerprint, delete, name editing)
    const [chatFingerprint, setChatFingerprint] = useState('');
    const [groupMembers, setGroupMembers] = useState<any[]>([]);
    const [groupName, setGroupName] = useState(chat.name);
    const [friendsList, setFriendsList] = useState<User[]>([]);

    // Interlocutor name history states
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [historyNames, setHistoryNames] = useState<any[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyEstablishedDate, setHistoryEstablishedDate] = useState<string>('');

    // Debts states
    const [debts, setDebts] = useState<Debt[]>([]);
    const [debtRubles, setDebtRubles] = useState('');
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [selectedCurrency, setSelectedCurrency] = useState<Currency | null>(null);

    const messagesAreaRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const viewportShellRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const handleNetworkState = (event: Event) => {
            const detail = (event as CustomEvent<NetworkStateDetail>).detail;
            if (typeof detail?.online === 'boolean') setOnline(detail.online);
        };
        const handleOnline = () => setOnline(true);
        const handleOffline = () => setOnline(false);

        window.addEventListener(NETWORK_STATE_EVENT, handleNetworkState);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        setOnline(isOnline());

        return () => {
            window.removeEventListener(NETWORK_STATE_EVENT, handleNetworkState);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Keep the chat inside the actually visible mobile viewport. This prevents the
    // software keyboard from covering the composer in browser, standalone PWA and
    // Android WebView/APK wrappers. Message scrolling behavior is intentionally untouched.
    useEffect(() => {
        const shell = viewportShellRef.current;
        if (!shell) return;

        const viewport = window.visualViewport;
        let frame = 0;

        const syncViewport = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const visibleHeight = Math.round(viewport?.height ?? window.innerHeight);
                const offsetTop = Math.round(viewport?.offsetTop ?? 0);
                const keyboardOpen = visibleHeight < window.innerHeight - 120;

                shell.style.setProperty('--chat-visible-height', `${visibleHeight}px`);
                shell.style.setProperty('--chat-viewport-top', `${offsetTop}px`);
                shell.dataset.keyboardOpen = keyboardOpen ? 'true' : 'false';
            });
        };

        syncViewport();
        viewport?.addEventListener('resize', syncViewport);
        viewport?.addEventListener('scroll', syncViewport);
        window.addEventListener('resize', syncViewport);
        window.addEventListener('orientationchange', syncViewport);

        return () => {
            cancelAnimationFrame(frame);
            viewport?.removeEventListener('resize', syncViewport);
            viewport?.removeEventListener('scroll', syncViewport);
            window.removeEventListener('resize', syncViewport);
            window.removeEventListener('orientationchange', syncViewport);
        };
    }, []);

    // Load chat symmetric key and fingerprint
    const loadChatKeys = async () => {
        try {
            if (chat.type === 'saved') {
                const fingerprint = 'Личное хранилище';
                setChatFingerprint(fingerprint);

                let cachedKey = await idbKeyval.get<CryptoKey>(`aes_key_${chat.id}`);
                if (!cachedKey) {
                    const { data } = await supabaseClient
                        .from('chat_keys')
                        .select('encrypted_key')
                        .eq('chat_id', chat.id)
                        .eq('user_id', currentUser.id)
                        .maybeSingle();

                    if (data) {
                        const keysDict = JSON.parse(data.encrypted_key);
                        let decrypted = null;
                        for (const key of Object.values(keysDict)) {
                            if (typeof key === 'string') {
                                decrypted = await decryptChatKey(key, currentUser.id);
                                if (decrypted) break;
                            }
                        }
                        cachedKey = decrypted;
                        if (cachedKey) {
                            await idbKeyval.set(`aes_key_${chat.id}`, cachedKey);
                        }
                    }
                }
                setChatKey(cachedKey || null);
            } else if (chat.type === 'private') {
                // Load friend public key to generate fingerprint
                const friendId = chat.friendId || 0;
                const { data: friendData } = await supabaseClient
                    .from('users')
                    .select('public_key')
                    .eq('tg_id', friendId)
                    .maybeSingle();

                if (friendData?.public_key) {
                    const fp = await getFingerprint(friendData.public_key);
                    setChatFingerprint(`Шифр: ${fp}`);
                }

                let cachedKey = await idbKeyval.get<CryptoKey>(`aes_key_${chat.id}`);
                if (!cachedKey) {
                    const { data } = await supabaseClient
                        .from('chat_keys')
                        .select('encrypted_key')
                        .eq('chat_id', chat.id)
                        .eq('user_id', currentUser.id)
                        .maybeSingle();

                    if (data) {
                        let decrypted = null;
                        try {
                            const keysDict = JSON.parse(data.encrypted_key);
                            for (const key of Object.values(keysDict)) {
                                if (typeof key === 'string') {
                                    decrypted = await decryptChatKey(key, currentUser.id);
                                    if (decrypted) break;
                                }
                            }
                        } catch (e) {
                            decrypted = await decryptChatKey(data.encrypted_key, currentUser.id);
                        }
                        cachedKey = decrypted;
                        if (cachedKey) {
                            await idbKeyval.set(`aes_key_${chat.id}`, cachedKey);
                        }
                    }
                }
                setChatKey(cachedKey || null);
            } else if (chat.type === 'group') {
                setChatFingerprint('Группа');

                let cachedKey = await idbKeyval.get<CryptoKey>(`aes_key_${chat.id}`);
                if (!cachedKey) {
                    const { data } = await supabaseClient
                        .from('chat_keys')
                        .select('encrypted_key')
                        .eq('chat_id', chat.id)
                        .eq('user_id', currentUser.id)
                        .maybeSingle();

                    if (data) {
                        let decrypted = null;
                        try {
                            const keysDict = JSON.parse(data.encrypted_key);
                            for (const key of Object.values(keysDict)) {
                                if (typeof key === 'string') {
                                    decrypted = await decryptChatKey(key, currentUser.id);
                                    if (decrypted) break;
                                }
                            }
                        } catch (e) {
                            decrypted = await decryptChatKey(data.encrypted_key, currentUser.id);
                        }
                        cachedKey = decrypted;
                        if (cachedKey) {
                            await idbKeyval.set(`aes_key_${chat.id}`, cachedKey);
                        }
                    }
                }
                setChatKey(cachedKey || null);
            }
        } catch (e) {
            console.error(e);
        }
    };

    // Process message model to decoupled render parameters
    const parseMessage = async (msg: Message, aesKey: CryptoKey): Promise<DecryptedMessage> => {
        const isMine = msg.sender_id === currentUser.id;
        const decrypted = await decryptText(msg.encrypted_text, aesKey, currentUser.id, msg.sender_id);

        const voiceData = decrypted.text.startsWith('[VOICE]:') ? parseVoicePayload(decrypted.text) : undefined;
        const inviteData = decrypted.text.startsWith('[GROUP_INVITE]:') ? parseInvitePayload(decrypted.text) : undefined;

        return {
            id: msg.id,
            sender_id: msg.sender_id,
            text: decrypted.text,
            created_at: msg.created_at,
            isMine,
            senderName: isMine ? 'Я' : 'Участник', // Name placeholder
            reply: decrypted.reply,
            isAuthentic: decrypted.isAuthentic,
            isError: decrypted.isError,
            voiceData,
            inviteData,
            deliveryStatus: isMine ? 'sent' : undefined,
        };
    };

    const parseVoicePayload = (text: string) => {
        const rawParams = text.replace('[VOICE]:', '');
        const parts = rawParams.split('|');
        const fileName = parts[0];

        let wfStr = '';
        let transcription = '';
        let isProcessing = false;
        let isError = false;
        let hasTranscript = false;

        for (let i = 1; i < parts.length; i++) {
            const part = parts[i].trim();
            if (part.startsWith('WF:')) {
                wfStr = part.substring(3);
            } else if (part.length > 0) {
                transcription = part;
                if (transcription.includes('⏳') || transcription.includes('анализирует')) {
                    isProcessing = true;
                } else if (transcription.includes('❌') || transcription.includes('Ошибка')) {
                    isError = true;
                } else {
                    hasTranscript = true;
                }
            }
        }

        const waveform = wfStr ? wfStr.split(',').map(Number) : Array.from({ length: 30 }, () => Math.floor(10 + Math.random() * 90));

        return {
            fileName,
            waveform,
            transcription,
            isProcessing,
            isError,
            hasTranscript,
        };
    };

    const parseInvitePayload = (text: string) => {
        const parts = text.replace('[GROUP_INVITE]:', '').split('|');
        return {
            groupId: parts[0],
            groupName: parts[1],
            keysJSON: parts[2],
        };
    };

    const migrateLegacyVoiceMessage = async (message: DecryptedMessage, aesKey: CryptoKey) => {
        const oldPath = message.voiceData?.fileName;
        if (!message.isMine || !oldPath || oldPath.includes('/') || legacyVoiceMigrationRef.current.has(message.id)) return;

        legacyVoiceMigrationRef.current.add(message.id);
        const newPath = `${chat.id}/${currentUser.id}/voice_${Date.now()}_${crypto.randomUUID()}.bin`;
        try {
            const rewrittenText = message.text.replace(`[VOICE]:${oldPath}`, `[VOICE]:${newPath}`);
            const encryptedText = await encryptText(rewrittenText, aesKey, currentUser.id, message.reply);
            const { error } = await supabaseClient.functions.invoke('voice-legacy-migrate', {
                body: {
                    messageId: message.id,
                    chatId: chat.id,
                    oldPath,
                    newPath,
                    encryptedText,
                },
            });
            if (error) throw error;

            setMessages((prev) => prev.map((item) => item.id === message.id
                ? {
                    ...item,
                    text: rewrittenText,
                    voiceData: item.voiceData ? { ...item.voiceData, fileName: newPath } : item.voiceData,
                }
                : item));

            const cacheKey = `chat_hist_${chat.id}`;
            const cached = await idbKeyval.get<{ updated_at: number; history: Message[] }>(cacheKey);
            if (cached?.history) {
                await idbKeyval.set(cacheKey, {
                    ...cached,
                    history: cached.history.map((item) => item.id === message.id ? { ...item, encrypted_text: encryptedText } : item),
                });
            }
        } catch (error) {
            console.warn('Legacy voice migration postponed', error);
            legacyVoiceMigrationRef.current.delete(message.id);
        }
    };

    const scheduleLegacyVoiceMigration = (items: DecryptedMessage[], aesKey: CryptoKey) => {
        const candidates = items.filter((item) => item.isMine && item.voiceData?.fileName && !item.voiceData.fileName.includes('/'));
        if (candidates.length === 0) return;
        void (async () => {
            for (const item of candidates) await migrateLegacyVoiceMessage(item, aesKey);
        })();
    };

    const removeMessageLocally = async (messageId: string) => {
        setPinnedMessageIds((current) => {
            if (!current.has(messageId)) return current;
            const next = new Set(current);
            next.delete(messageId);
            localStorage.setItem(pinnedMessagesStorageKey, JSON.stringify([...next]));
            return next;
        });
        setMessages((prev) => {
            const removed = prev.find((item) => item.id === messageId);
            if (removed?.voiceData?.localUrl) URL.revokeObjectURL(removed.voiceData.localUrl);
            return prev.filter((item) => item.id !== messageId);
        });

        const cacheKey = `chat_hist_${chat.id}`;
        const cached = await idbKeyval.get<{ updated_at: number; history: Message[] }>(cacheKey);
        if (cached?.history.some((item) => item.id === messageId)) {
            await idbKeyval.set(cacheKey, {
                ...cached,
                updated_at: Date.now(),
                history: cached.history.filter((item) => item.id !== messageId),
            });
        }
    };

    const handleDeleteMessage = async (message: DecryptedMessage) => {
        if (!message.isMine || message.deliveryStatus === 'sending') return;
        if (!confirm('Удалить сообщение для всех участников?')) return;

        if (message.id.startsWith('pending-')) {
            await removeMessageLocally(message.id);
            return;
        }

        try {
            const { data: deleted, error } = await supabaseClient.rpc('delete_own_message', { target_message_id: message.id });
            if (error) throw error;
            if (deleted !== true) {
                throw new Error('The server did not confirm message deletion');
            }

            await removeMessageLocally(message.id);
            await supabaseClient.functions.invoke('storage-cleanup', { body: {} });
            hapticImpact('warning');
        } catch (error) {
            console.error('Failed to delete message', error);
            alert('Не удалось удалить сообщение. Оно могло быть уже удалено или у вас нет прав.');
        }
    };

    // Load message history with E2EE decrypt
    const loadHistory = async (key: CryptoKey) => {
        setIsLoadingChat(true);
        try {
            // 1. Check local cache
            const cached = (await idbKeyval.get<any>(`chat_hist_${chat.id}`)) || { history: [] };
            let finalMessages: DecryptedMessage[] = [];

            if (cached.history.length > 0) {
                const decryptedCache = await Promise.all(
                    cached.history.map((msg: Message) => parseMessage(msg, key))
                );
                finalMessages = decryptedCache;
                setMessages(decryptedCache);
                scheduleLegacyVoiceMigration(decryptedCache, key);
                setIsLoadingChat(false);
            }

            // 2. Reconcile the latest server window with the local cache. Fetching a complete
            // window (instead of only newer rows) also removes messages deleted on another device.
            const { data: serverRows, error } = await supabaseClient
                .from('messages')
                .select('id, chat_id, sender_id, encrypted_text, encrypted_vector, created_at')
                .eq('chat_id', chat.id)
                .order('created_at', { ascending: false })
                .limit(500);

            if (error) throw error;

            const serverHistory = [...(serverRows ?? [])].reverse() as Message[];
            const serverIds = new Set(serverHistory.map((message) => message.id));
            const oldestServerTime = serverHistory[0]?.created_at
                ? new Date(serverHistory[0].created_at).getTime()
                : Number.POSITIVE_INFINITY;

            // Keep cached rows older than the fetched window for pagination, but trust the server
            // for every row inside the reconciled window.
            const olderCached = (cached.history as Message[]).filter((message) => (
                new Date(message.created_at).getTime() < oldestServerTime && !serverIds.has(message.id)
            ));
            const reconciledHistory = [...olderCached, ...serverHistory].slice(-500);
            const reconciledDecrypted = await Promise.all(reconciledHistory.map((msg) => parseMessage(msg, key)));

            await idbKeyval.set(`chat_hist_${chat.id}`, {
                updated_at: Date.now(),
                history: reconciledHistory,
            });
            finalMessages = reconciledDecrypted;
            setMessages(reconciledDecrypted);
            scheduleLegacyVoiceMigration(reconciledDecrypted, key);
            setOldestServerCursor(reconciledHistory[0]?.created_at ?? null);
            setHasMoreInHistory(serverHistory.length === 500 || olderCached.length > 0);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoadingChat(false);
        }
    };

    const loadOlderMessages = async () => {
        if (!chatKey || isLoadingOlder || !hasMoreInHistory || !oldestServerCursor) return;

        setIsLoadingOlder(true);
        try {
            const { data, error } = await supabaseClient
                .from('messages')
                .select('id, chat_id, sender_id, encrypted_text, encrypted_vector, created_at')
                .eq('chat_id', chat.id)
                .lt('created_at', oldestServerCursor)
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) throw error;
            const olderRaw = [...(data ?? [])].reverse() as Message[];
            if (olderRaw.length === 0) {
                setHasMoreInHistory(false);
                return;
            }

            const olderDecrypted = await Promise.all(olderRaw.map((msg) => parseMessage(msg, chatKey)));
            setMessages((prev) => {
                const known = new Set(prev.map((message) => message.id));
                return [...olderDecrypted.filter((message) => !known.has(message.id)), ...prev];
            });
            setOldestServerCursor(olderRaw[0].created_at);
            setHasMoreInHistory(olderRaw.length === 100);

            const cacheKey = `chat_hist_${chat.id}`;
            const cached = await idbKeyval.get<{ updated_at: number; history: Message[] }>(cacheKey);
            const combined = [...olderRaw, ...(cached?.history ?? [])];
            const unique = Array.from(new Map(combined.map((message) => [message.id, message])).values())
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                .slice(-500);
            await idbKeyval.set(cacheKey, { updated_at: Date.now(), history: unique });
            setRenderLimit((prev) => prev + olderRaw.length);
        } catch (error) {
            console.error('Failed to load older messages', error);
        } finally {
            setIsLoadingOlder(false);
        }
    };

    useEffect(() => {
        setMessages([]);
        setRenderLimit(30);
        setHasMoreInHistory(false);
        setOldestServerCursor(null);
        loadChatKeys();
        if (chat.type === 'group') {
            loadChatInfoDetails();
        }
    }, [chat.id]);

    useEffect(() => {
        if (chatKey) {
            loadHistory(chatKey);

            // Subscribe to real-time additions
            let disposed = false;
            const applyRealtimeMessage = async (newMsg: Message) => {
                const parsed = await parseMessage(newMsg, chatKey);
                if (disposed) return;

                setMessages((prev) => {
                    const existingIdx = prev.findIndex((message) => message.id === parsed.id);
                    if (existingIdx >= 0) {
                        const updated = [...prev];
                        updated[existingIdx] = parsed;
                        return updated;
                    }
                    return [...prev, parsed];
                });

                const cacheKey = `chat_hist_${chat.id}`;
                const cached = await idbKeyval.get<{ updated_at: number; history: Message[] }>(cacheKey);
                if (!disposed) {
                    const history = cached?.history ?? [];
                    const index = history.findIndex((message) => message.id === newMsg.id);
                    const nextHistory = index >= 0
                        ? history.map((message, currentIndex) => currentIndex === index ? newMsg : message)
                        : [...history, newMsg];
                    await idbKeyval.set(cacheKey, {
                        updated_at: Date.now(),
                        history: nextHistory.slice(-500),
                    });
                }

                if (
                    newMsg.sender_id !== currentUser.id &&
                    parsed.voiceData &&
                    !parsed.voiceData.hasTranscript &&
                    localStorage.getItem('synd_auto_whisper') !== 'off'
                ) {
                    void handleVoiceTranslation(parsed.voiceData.fileName, parsed.id);
                }
            };

            const channel = supabaseClient
                .channel(`live-chat-${chat.id}`)
                .on(
                    'postgres_changes',
                    { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chat.id}` },
                    (payload: any) => void applyRealtimeMessage(payload.new as Message)
                )
                .on(
                    'postgres_changes',
                    { event: 'UPDATE', schema: 'public', table: 'messages', filter: `chat_id=eq.${chat.id}` },
                    (payload: any) => void applyRealtimeMessage(payload.new as Message)
                )
                .on(
                    'postgres_changes',
                    { event: 'DELETE', schema: 'public', table: 'messages' },
                    (payload: any) => {
                        const deletedId = payload.old?.id as string | undefined;
                        if (deletedId) void removeMessageLocally(deletedId);
                    }
                )
                .subscribe();

            return () => {
                disposed = true;
                void supabaseClient.removeChannel(channel);
            };
        }
    }, [chatKey, chat.id]);

    const draftStorageKey = getDraftStorageKey(currentUser.id, chat.id);

    const persistDraft = (text: string) => {
        draftTextRef.current = text;
        if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = setTimeout(async () => {
            if (!chatKey) return;
            try {
                if (!draftTextRef.current) {
                    await idbKeyval.del(draftStorageKey);
                    emitDraftChanged({ userId: currentUser.id, chat, text: '', updatedAt: Date.now() });
                    return;
                }
                await idbKeyval.set(draftStorageKey, await encryptChatDraft(draftTextRef.current, chatKey, chat));
                emitDraftChanged({ userId: currentUser.id, chat, text: draftTextRef.current, updatedAt: Date.now() });
            } catch (error) {
                console.warn('Draft save failed', error);
            }
        }, 250);
    };

    useEffect(() => {
        if (!chatKey) return;
        let disposed = false;

        void (async () => {
            try {
                const encryptedDraft = await idbKeyval.get<EncryptedChatDraft>(draftStorageKey);
                if (!encryptedDraft || disposed) return;
                const restored = await decryptChatDraft(encryptedDraft, chatKey);
                if (!disposed && restored) {
                    draftTextRef.current = restored;
                    setInputText(restored);
                    requestAnimationFrame(() => {
                        if (!inputRef.current) return;
                        inputRef.current.style.height = '42px';
                        inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
                    });
                }
            } catch (error) {
                console.warn('Draft restore failed', error);
                await idbKeyval.del(draftStorageKey);
            }
        })();

        return () => {
            disposed = true;
            if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
            if (draftTextRef.current) {
                void encryptChatDraft(draftTextRef.current, chatKey, chat)
                    .then(async (draft) => {
                        await idbKeyval.set(draftStorageKey, draft);
                        emitDraftChanged({ userId: currentUser.id, chat, text: draftTextRef.current, updatedAt: draft.updatedAt });
                    })
                    .catch((error) => console.warn('Draft flush failed', error));
            }
        };
    }, [chatKey, draftStorageKey]);

    // Dynamic textarea sizing and encrypted per-chat draft persistence
    const handleInputChange = (text: string) => {
        setInputText(text);
        persistDraft(text);
        if (inputRef.current) {
            inputRef.current.style.height = '42px';
            inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
        }
    };

    const sendMessagePayload = async (textToSend: string, reply: ReplyData | null, tempId?: string): Promise<boolean> => {
        if (!chatKey) return false;

        const optimisticId = tempId ?? `pending-${crypto.randomUUID()}`;
        const optimisticMessage: DecryptedMessage = {
            id: optimisticId,
            sender_id: currentUser.id,
            text: textToSend,
            created_at: new Date().toISOString(),
            isMine: true,
            senderName: 'Я',
            reply: reply ?? undefined,
            isAuthentic: true,
            isError: false,
            deliveryStatus: 'sending',
            retryPayload: { kind: 'text', text: textToSend, reply },
        };

        setMessages((prev) => {
            const exists = prev.some((message) => message.id === optimisticId);
            return exists
                ? prev.map((message) => message.id === optimisticId ? optimisticMessage : message)
                : [...prev, optimisticMessage];
        });

        try {
            const encryptedPayload = await encryptText(textToSend, chatKey, currentUser.id, reply);
            let encryptedVector: string | null = null;
            const pipelineInstance = getCachedEmbeddingPipeline();
            if (pipelineInstance) {
                try {
                    const output = await pipelineInstance(textToSend, { pooling: 'mean', normalize: true });
                    const arrayBuffer = output.data.buffer;
                    const iv = window.crypto.getRandomValues(new Uint8Array(12));
                    const encryptedVec = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chatKey, arrayBuffer);
                    const bytes = new Uint8Array(iv.length + encryptedVec.byteLength);
                    bytes.set(iv, 0);
                    bytes.set(new Uint8Array(encryptedVec), iv.length);
                    encryptedVector = btoa(String.fromCharCode.apply(null, Array.from(bytes)));
                } catch (vectorError) {
                    console.warn('Vector gen failed', vectorError);
                }
            }

            const { data: inserted, error: insertError } = await supabaseClient
                .from('messages')
                .insert({
                    chat_id: chat.id,
                    sender_id: currentUser.id,
                    encrypted_text: encryptedPayload,
                    encrypted_vector: encryptedVector,
                })
                .select('id, chat_id, sender_id, encrypted_text, encrypted_vector, created_at')
                .single();
            if (insertError) throw insertError;

            const parsed = await parseMessage(inserted as Message, chatKey);
            parsed.deliveryStatus = 'sent';
            setMessages((prev) => {
                const withoutOptimistic = prev.filter((message) => message.id !== optimisticId && message.id !== parsed.id);
                return [...withoutOptimistic, parsed].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            });

            const cacheKey = `chat_hist_${chat.id}`;
            const cached = await idbKeyval.get<{ updated_at: number; history: Message[] }>(cacheKey);
            const history = [...(cached?.history ?? []).filter((message) => message.id !== inserted.id), inserted as Message].slice(-500);
            await idbKeyval.set(cacheKey, { updated_at: Date.now(), history });
            hapticImpact('light');
            return true;
        } catch (error) {
            console.error(error);
            setMessages((prev) => prev.map((message) => message.id === optimisticId
                ? { ...message, deliveryStatus: 'failed' as const }
                : message));
            return false;
        }
    };

    const handleSendMessage = async (e?: FormEvent) => {
        e?.preventDefault();
        if (!inputText.trim() || !chatKey) return;

        const textToSend = inputText.trim();
        const reply = replyTo;
        setInputText('');
        setReplyTo(null);
        if (inputRef.current) inputRef.current.style.height = '42px';
        const sent = await sendMessagePayload(textToSend, reply);
        if (sent) {
            draftTextRef.current = '';
            if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
            await idbKeyval.del(draftStorageKey);
            emitDraftChanged({ userId: currentUser.id, chat, text: '', updatedAt: Date.now() });
        }
    };

    const retryMessage = async (message: DecryptedMessage): Promise<boolean> => {
        if (!message.retryPayload || message.deliveryStatus !== 'failed') return false;
        if (message.retryPayload.kind === 'voice') {
            return uploadVoiceNote(
                message.retryPayload.blob,
                message.retryPayload.waveform,
                message.id,
                message.retryPayload.localUrl,
                message.retryPayload.reply ?? null,
            );
        }
        return sendMessagePayload(message.retryPayload.text, message.retryPayload.reply ?? null, message.id);
    };

    const retryAllFailedMessages = async () => {
        if (isRetryingFailed || !online) return;
        const failed = messages.filter((message) => message.deliveryStatus === 'failed' && message.retryPayload);
        if (failed.length === 0) return;

        setIsRetryingFailed(true);
        let sentCount = 0;
        try {
            // Sequential retries prevent duplicate uploads and reduce pressure on a restored mobile connection.
            for (const message of failed) {
                if (!isOnline()) break;
                const sent = await retryMessage(message);
                if (sent) sentCount += 1;
            }

            if (sentCount === failed.length) {
                notify(`Отправлено сообщений: ${sentCount}.`, 'success');
            } else if (sentCount > 0) {
                notify(`Отправлено ${sentCount} из ${failed.length}. Остальные можно повторить позже.`, 'warning');
            } else if (isOnline()) {
                notify('Не удалось отправить сообщения. Попробуйте ещё раз.', 'error');
            }
        } finally {
            setIsRetryingFailed(false);
        }
    };


    // Scrolling indicators
    const handleScroll = (e: UIEvent<HTMLDivElement>) => {
        const area = e.currentTarget;
        if (Math.abs(area.scrollTop) > 150) {
            setShowScrollBottom(true);
        } else {
            setShowScrollBottom(false);
        }

        if (Math.abs(area.scrollTop) + area.clientHeight >= area.scrollHeight - 300) {
            if (renderLimit < messages.length) {
                setRenderLimit(prev => prev + 30);
            }
        }
        // Throttled: update pinned banner when the current pinned message crosses the middle
        if (sortedPinnedMessages.length > 1 && !pinnedScrollThrottleRef.current) {
            pinnedScrollThrottleRef.current = true;
            requestAnimationFrame(() => {
                const areaRect = area.getBoundingClientRect();
                const midY = areaRect.top + areaRect.height / 2;
                // Walk newest→oldest: find the FIRST pinned message whose center is ABOVE the middle.
                // The one just after it (newer) is the active banner message.
                let crossedIdx = -1;
                for (let i = sortedPinnedMessages.length - 1; i >= 0; i--) {
                    const el = document.getElementById(`msg-${sortedPinnedMessages[i].id}`);
                    if (!el) continue;
                    const elRect = el.getBoundingClientRect();
                    const elCenter = (elRect.top + elRect.bottom) / 2;
                    if (elCenter < midY) {
                        crossedIdx = i;
                        break;
                    }
                }
                if (crossedIdx >= 0 && crossedIdx < sortedPinnedMessages.length - 1) {
                    // The message at crossedIdx went above middle → show IT in the banner
                    setPinnedBannerIdx(crossedIdx);
                } else if (crossedIdx < 0) {
                    // No pinned message crossed the middle yet → show the oldest (first visible)
                    setPinnedBannerIdx(0);
                } else {
                    // All pinned messages crossed the middle → show the newest (last)
                    setPinnedBannerIdx(sortedPinnedMessages.length - 1);
                }
                pinnedScrollThrottleRef.current = false;
            });
        }
    };

    const handleScrollToBottom = () => {
        if (messagesAreaRef.current) {
            messagesAreaRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    // Voice Note Recording Logic
    const startRecording = async (e?: TouchEvent | MouseEvent) => {
        if (e && 'touches' in e) {
            touchStartX.current = e.touches[0].clientX;
            touchStartY.current = e.touches[0].clientY;
        }

        try {
            if (!globalAudioStream) {
                globalAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }
            mediaRecorderRef.current = new MediaRecorder(globalAudioStream);
            audioChunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorderRef.current.onstop = async () => {
                clearInterval(recTimerRef.current);
                clearInterval(recordVolumeIntervalRef.current);

                if (audioCtxRef.current) {
                    await audioCtxRef.current.close();
                    audioCtxRef.current = null;
                    analyserRef.current = null;
                }

                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/ogg; codecs=opus' });
                audioChunksRef.current = [];

                // Save recorded waveform parameters
                const barsCount = 30;
                let finalWaveform = [...recordWaveHistory];
                if (finalWaveform.length < barsCount) {
                    while (finalWaveform.length < barsCount) {
                        finalWaveform.push(Math.floor(10 + Math.random() * 40));
                    }
                }
                const maxVol = Math.max(...finalWaveform, 1);
                const wfString = finalWaveform.map((v) => Math.floor((v / maxVol) * 100)).join(',');

                setIsRecording(false);
                setIsRecordingLocked(false);
                setIsRecordPaused(false);
                setRecordingDuration(0);
                setRecordWaveHistory([]);
                setMicPulseScale(1);

                // Upload voice to Storage
                if (audioBlob.size > 800) {
                    await uploadVoiceNote(audioBlob, wfString);
                }
            };

            mediaRecorderRef.current.start();
            recStartTimeRef.current = Date.now();
            recAccumulatedTimeRef.current = 0;
            setIsRecording(true);

            // Start duration updates
            recTimerRef.current = setInterval(() => {
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                    setRecordingDuration(Math.floor((Date.now() - recStartTimeRef.current + recAccumulatedTimeRef.current) / 1000));
                }
            }, 100);

            // Setup audio analyzer for dynamic pulsing button animation
            try {
                const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                audioCtxRef.current = audioCtx;
                const analyser = audioCtx.createAnalyser();
                analyser.fftSize = 256;
                analyserRef.current = analyser;

                const source = audioCtx.createMediaStreamSource(globalAudioStream);
                sourceRef.current = source;
                source.connect(analyser);

                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                const tempVolumes: number[] = [];

                recordVolumeIntervalRef.current = setInterval(() => {
                    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                        analyser.getByteFrequencyData(dataArray);
                        let sum = 0;
                        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                        const avg = sum / dataArray.length;

                        // Update mic pulse scales
                        const scale = 1 + Math.min(0.4, avg / 40);
                        setMicPulseScale(scale);

                        tempVolumes.push(avg);
                        setRecordWaveHistory([...tempVolumes]);
                    }
                }, 150);
            } catch (analyserErr) {
                console.warn('Analyser node failed', analyserErr);
            }

            hapticImpact("medium");
        } catch (err) {
            alert('Ошибка доступа к микрофону!');
        }
    };

    const uploadVoiceNote = async (audioBlob: Blob, waveformStr: string, tempId?: string, existingLocalUrl?: string, replyOverride?: ReplyData | null): Promise<boolean> => {
        if (!chatKey) return false;
        const optimisticId = tempId ?? `pending-voice-${crypto.randomUUID()}`;
        const localUrl = existingLocalUrl ?? URL.createObjectURL(audioBlob);
        const reply = replyOverride !== undefined ? replyOverride : replyTo;
        const optimisticVoice: DecryptedMessage = {
            id: optimisticId,
            sender_id: currentUser.id,
            text: '[VOICE]:pending',
            created_at: new Date().toISOString(),
            isMine: true,
            senderName: 'Я',
            reply: reply ?? undefined,
            isAuthentic: true,
            isError: false,
            deliveryStatus: 'sending',
            retryPayload: { kind: 'voice', blob: audioBlob, waveform: waveformStr, reply, localUrl },
            voiceData: {
                fileName: optimisticId,
                waveform: waveformStr.split(',').map(Number),
                transcription: '',
                isProcessing: false,
                isError: false,
                hasTranscript: false,
                localUrl,
            },
        };
        setMessages((prev) => prev.some((m) => m.id === optimisticId)
            ? prev.map((m) => m.id === optimisticId ? optimisticVoice : m)
            : [...prev, optimisticVoice]);
        setReplyTo(null);

        const fileName = `${chat.id}/${currentUser.id}/voice_${Date.now()}_${crypto.randomUUID()}.bin`;
        let storageUploaded = false;

        try {
            const arrayBuffer = await audioBlob.arrayBuffer();
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const encrypted = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                chatKey,
                arrayBuffer
            );

            const payload = new Uint8Array(iv.length + encrypted.byteLength);
            payload.set(iv, 0);
            payload.set(new Uint8Array(encrypted), iv.length);

            // Upload encrypted audio
            const { error: uploadError } = await supabaseClient.storage
                .from('voice_messages')
                .upload(fileName, payload.buffer, { contentType: 'application/octet-stream' });

            if (uploadError) throw uploadError;
            storageUploaded = true;

            // Wrap voice text representation
            const isAutoWhisperOn = localStorage.getItem('synd_auto_whisper') !== 'off';
            const textMarker = isAutoWhisperOn
                ? `[VOICE]:${fileName}|WF:${waveformStr}|⏳ ИИ анализирует...`
                : `[VOICE]:${fileName}|WF:${waveformStr}`;

            const encryptedText = await encryptText(textMarker, chatKey, currentUser.id, reply);

            const { data: insertedMsg, error: insertError } = await supabaseClient
                .from('messages')
                .insert({
                    chat_id: chat.id,
                    sender_id: currentUser.id,
                    encrypted_text: encryptedText,
                })
                .select('id, chat_id, sender_id, encrypted_text, encrypted_vector, created_at')
                .single();

            if (insertError) throw insertError;

            const { error: attachmentError } = await supabaseClient
                .from('message_attachments')
                .insert({
                    message_id: insertedMsg.id,
                    chat_id: chat.id,
                    uploader_id: currentUser.id,
                    storage_path: fileName,
                    kind: 'voice',
                    size_bytes: payload.byteLength,
                });
            if (attachmentError) {
                await supabaseClient.from('messages').delete().eq('id', insertedMsg.id);
                throw attachmentError;
            }

            const parsed = await parseMessage(insertedMsg as Message, chatKey);
            parsed.deliveryStatus = 'sent';
            setMessages((prev) => [...prev.filter((m) => m.id !== optimisticId && m.id !== parsed.id), parsed]
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
            URL.revokeObjectURL(localUrl);

            // Trigger automatic Whisper transcription in separate thread if active
            if (isAutoWhisperOn) {
                handleVoiceTranslation(fileName, insertedMsg.id, waveformStr);
            }
            return true;
        } catch (err: any) {
            console.error('Voice message send failed', err);
            if (storageUploaded) {
                try {
                    await supabaseClient.storage.from('voice_messages').remove([fileName]);
                } catch {
                    // Best-effort orphan cleanup.
                }
            }
            setMessages((prev) => prev.map((m) => m.id === optimisticId
                ? { ...m, deliveryStatus: 'failed' as const }
                : m));
            hapticImpact('error');
            return false;
        }
    };

    const handleVoiceTranslation = async (fileName: string, msgId: string, waveformStr?: string) => {
        if (!worker || !chatKey) return;

        try {
            // 1. Download file
            const { data, error } = await supabaseClient.storage.from('voice_messages').download(fileName);

            if (error || !data) throw error || new Error('No data');

            // 2. Decrypt
            const arrayBuffer = await data.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            const iv = bytes.slice(0, 12);
            const encData = bytes.slice(12);

            const decrypted = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                chatKey,
                encData
            );

            // 3. Audio Context decoding into Float32Array (16kHz standard for Whisper)
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            const decoded = await audioCtx.decodeAudioData(decrypted);
            const float32 = decoded.getChannelData(0);

            // 4. Send to Web Worker
            const taskId = Date.now() + Math.random();
            worker.postMessage({ type: 'transcribe', id: taskId, audioData: float32 });

            const handleResponse = async (e: MessageEvent) => {
                const res = e.data;
                if (res.id === taskId) {
                    worker.removeEventListener('message', handleResponse);
                    if (res.type === 'result') {
                        const transText = res.text.trim();
                        const wfSuffix = waveformStr ? `|WF:${waveformStr}` : '';
                        const newMarker = `[VOICE]:${fileName}${wfSuffix}|${transText}`;
                        const newEncText = await encryptText(newMarker, chatKey, currentUser.id);

                        await supabaseClient.from('messages').update({ encrypted_text: newEncText }).eq('id', msgId);
                    } else if (res.type === 'error') {
                        throw new Error(res.error);
                    }
                }
            };

            worker.addEventListener('message', handleResponse);
        } catch (err: any) {
            console.warn('Voice translation failed', err);
            // Fail gracefully: update text to error marker
            const wfSuffix = waveformStr ? `|WF:${waveformStr}` : '';
            const newMarker = `[VOICE]:${fileName}${wfSuffix}|❌ Ошибка расшифровки`;
            try {
                const newEncText = await encryptText(newMarker, chatKey, currentUser.id);
                await supabaseClient.from('messages').update({ encrypted_text: newEncText }).eq('id', msgId);
            } catch (e) { }
        }
    };

    const handleManualTranscribe = async (fileName: string, msgId: string) => {
        const parentMsg = messages.find((m) => m.id === msgId);
        let wfStr = '';
        if (parentMsg && parentMsg.text.includes('|WF:')) {
            const parts = parentMsg.text.split('|');
            for (const p of parts) {
                if (p.startsWith('WF:')) wfStr = p.substring(3);
            }
        }
        await handleVoiceTranslation(fileName, msgId, wfStr);
    };

    const stopRecordingAndSend = () => {
        if (isRecordLocked && !isRecordPaused) return; // if locked and not paused, do nothing on mouse up
        if (mediaRecorderRef.current && (isRecording || isRecordPaused)) {
            mediaRecorderRef.current.stop();
        }
    };

    const forceStopRecordingAndSend = () => {
        if (mediaRecorderRef.current && (isRecording || isRecordPaused)) {
            mediaRecorderRef.current.stop();
        }
    };

    const pauseRecording = () => {
        if (mediaRecorderRef.current && isRecording && !isRecordPaused) {
            mediaRecorderRef.current.pause();
            recAccumulatedTimeRef.current += Date.now() - recStartTimeRef.current;
            setIsRecordPaused(true);
            // Generate preview
            try {
                mediaRecorderRef.current.requestData();
                setTimeout(() => {
                    if (audioChunksRef.current.length > 0) {
                        const tempBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                        const url = URL.createObjectURL(tempBlob);
                        setRecordPreviewUrl(url);
                    }
                }, 150);
            } catch (e) { }
        }
    };

    const resumeRecording = () => {
        if (mediaRecorderRef.current && isRecording && isRecordPaused) {
            if (previewAudioRef.current) {
                previewAudioRef.current.pause();
            }
            setRecordPreviewUrl(null);
            setIsRecordPlaying(false);
            recStartTimeRef.current = Date.now();
            mediaRecorderRef.current.resume();
            setIsRecordPaused(false);


        }
    };

    const cancelRecording = () => {
        hapticImpact("warning");
        audioChunksRef.current = [];
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.onstop = () => {
                clearInterval(recTimerRef.current);
                clearInterval(recordVolumeIntervalRef.current);
                if (audioCtxRef.current) {
                    audioCtxRef.current.close().catch(() => { });
                    audioCtxRef.current = null;
                    analyserRef.current = null;
                }
                setIsRecording(false);
                setIsRecordingLocked(false);
                setIsRecordPaused(false);
                setRecordPreviewUrl(null);
                setIsRecordPlaying(false);
                setRecordingDuration(0);
                setRecordWaveHistory([]);
                setMicPulseScale(1);
            };
            mediaRecorderRef.current.stop();
        } else {
            setIsRecording(false);
            setIsRecordingLocked(false);
            setIsRecordPaused(false);
            setRecordPreviewUrl(null);
            setIsRecordPlaying(false);
            setRecordingDuration(0);
            setRecordWaveHistory([]);
            setMicPulseScale(1);
        }
    };

    // Swipe-to-reply gesture handlers
    const handleTouchStart = (e: any, msgId: string) => {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
        swipingMsgId.current = msgId;
        setSwipeOffset(0);
    };

    const handleTouchMove = (e: any, msgId: string) => {
        if (swipingMsgId.current !== msgId) return;

        const deltaX = e.touches[0].clientX - touchStartX.current;
        const deltaY = e.touches[0].clientY - touchStartY.current;

        // Horizonal swipe verification
        if (deltaX < 0 && Math.abs(deltaX) > Math.abs(deltaY)) {
            setSwipeOffset(Math.max(deltaX, -80)); // Limit visual pull
            if (Math.abs(deltaX) > 50) {
                // Trigger reply UI preview
                const targetMsg = messages.find((m) => m.id === msgId);
                if (targetMsg) {
                    let cleanText = targetMsg.text;
                    if (cleanText.startsWith('[VOICE]:')) cleanText = '🎤 Голосовое сообщение';
                    if (cleanText.startsWith('[GROUP_INVITE]:')) cleanText = '🎫 Приглашение в группу';

                    setReplyTo({
                        id: targetMsg.id,
                        name: targetMsg.isMine ? 'Я' : getSenderName(targetMsg.sender_id),
                        text: cleanText,
                    });

                    hapticImpact("selection");

                    swipingMsgId.current = null;
                    setSwipeOffset(0);
                }
            }
        } else {
            setSwipeOffset(0);
        }
    };

    const handleMicTouchMove = (e: TouchEvent | any) => {
        if (!isRecording || isRecordLocked) return;
        const deltaX = e.touches[0].clientX - touchStartX.current;
        const deltaY = e.touches[0].clientY - touchStartY.current;

        if (deltaX < -100) {
            cancelRecording();
        } else if (deltaY < -100) {
            setIsRecordingLocked(true);
            hapticImpact("selection");
        }
    };

    const handleTouchEnd = () => {
        swipingMsgId.current = null;
        setSwipeOffset(0);
    };

    const handleScrollToMessage = (targetId: string) => {
        const el = document.getElementById(`msg-${targetId}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight-animation');
            setTimeout(() => el.classList.remove('highlight-animation'), 1500);
        }
    };

    // Group invitations accepting
    const handleAcceptGroupInvite = async (groupId: string, keysJSONBase64: string) => {
        try {
            const keysJSON = atob(keysJSONBase64);

            // Verify group membership duplication
            const { data: existing } = await supabaseClient
                .from('chat_keys')
                .select('id')
                .eq('chat_id', groupId)
                .eq('user_id', currentUser.id);

            if (existing && existing.length > 0) {
                alert('Вы уже вступили в эту группу!');
                return;
            }

            const { error } = await supabaseClient.from('chat_keys').insert({
                chat_id: groupId,
                user_id: currentUser.id,
                encrypted_key: keysJSON,
            });

            if (error) throw error;

            hapticImpact("success");
            alert('Вы успешно вступили в группу!');
            onBack(); // Refresh main lists
        } catch (err: any) {
            alert('Ошибка вступления: ' + err.message);
        }
    };

    // Load chat detailed information
    async function loadChatInfoDetails() {
        if (chat.type === 'group') {
            try {
                const { data: keys } = await supabaseClient
                    .from('chat_keys')
                    .select('user_id')
                    .eq('chat_id', chat.id);

                if (keys && keys.length > 0) {
                    const userIds = keys.map((k) => k.user_id);
                    const { data: users } = await supabaseClient
                        .from('users')
                        .select('tg_id, first_name, public_key, status, created_at')
                        .in('tg_id', userIds);

                    setGroupMembers(users || []);
                }
            } catch (e) {
                console.error(e);
            }
        }
    }

    const getSenderName = (senderId: number) => {
        if (senderId === currentUser.id) return 'Я';
        const member = groupMembers.find((m) => m.tg_id === senderId);
        return member ? member.first_name : 'Участник';
    };

    useEffect(() => {
        if (activeModal === 'info') {
            loadChatInfoDetails();
        } else if (activeModal === 'debts') {
            loadDebtsSummary();
        } else if (activeModal === 'add-debt') {
            loadAddDebtSettings();
        } else if (activeModal === 'invite-friend') {
            loadInviteFriendsList();
        }
    }, [activeModal]);

    const handleEditGroupName = async () => {
        const newName = prompt('Новое название группы:', groupName);
        if (!newName || !newName.trim() || newName === groupName) return;

        const trimmed = newName.trim();
        try {
            const { error } = await supabaseClient.from('chats').update({ name: trimmed }).eq('id', chat.id);
            if (error) throw error;
            setGroupName(trimmed);
            chat.name = trimmed;
            hapticImpact("success");
        } catch (e) {
            console.error(e);
        }
    };

    const handleLeaveGroup = async () => {
        if (!confirm('Выйти из группы? Вы потеряете доступ к переписке.')) return;

        try {
            await supabaseClient
                .from('chat_keys')
                .delete()
                .eq('chat_id', chat.id)
                .eq('user_id', currentUser.id);

            // Clean local cache
            await idbKeyval.del(`chat_hist_${chat.id}`);
            await idbKeyval.del(`aes_key_${chat.id}`);

            hapticImpact("warning");
            alert('Вы вышли из группы.');
            onBack();
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleDeleteGroupForEveryone = async () => {
        if (!confirm('УДАЛИТЬ ГРУППУ ДЛЯ ВСЕХ? Это сотрет ее из базы навсегда.')) return;

        try {
            const { error: deleteError } = await supabaseClient.from('chats').delete().eq('id', chat.id);
            if (deleteError) throw deleteError;
            await supabaseClient.functions.invoke('storage-cleanup', { body: {} });
            await idbKeyval.del(`chat_hist_${chat.id}`);
            await idbKeyval.del(`aes_key_${chat.id}`);

            hapticImpact("warning");
            alert('Группа удалена.');
            onBack();
        } catch (err: any) {
            alert(err.message);
        }
    };

    const loadInviteFriendsList = async () => {
        try {
            const { data: friendships } = await supabaseClient
                .from('friendships')
                .select('id, requester_id, addressee_id, status, created_at')
                .or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`);

            const friendIds = (friendships || [])
                .filter((r) => r.status === 'accepted')
                .map((r) => (r.requester_id === currentUser.id ? r.addressee_id : r.requester_id));

            if (friendIds.length > 0) {
                const { data: users } = await supabaseClient
                    .from('users')
                    .select('tg_id, first_name, public_key, status')
                    .in('tg_id', friendIds);

                setFriendsList(users || []);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleSendGroupInvite = async (friendId: number) => {
        if (!chatKey) return;
        try {
            const { data: friendData } = await supabaseClient
                .from('users')
                .select('public_key')
                .eq('tg_id', friendId)
                .maybeSingle();

            if (!friendData) return;

            let friendKeys = JSON.parse(friendData.public_key);
            if (friendKeys.kty) friendKeys = { legacy: friendKeys };

            const encGroupKeys: Record<string, string> = {};
            for (const [devId, pubJwk] of Object.entries(friendKeys)) {
                if (devId === 'vault' || typeof pubJwk !== 'object' || pubJwk === null) continue;
                encGroupKeys[devId] = await encryptChatKeyForFriend(chatKey, pubJwk);
            }

            // Format payload
            const invitePayload = `[GROUP_INVITE]:${chat.id}|${chat.name}|${JSON.stringify(encGroupKeys)}`;

            // Resolve pm chat ID with friend
            const { data: pmChatId } = await supabaseClient.rpc('get_private_chat', {
                user1_id: currentUser.id,
                user2_id: friendId,
            });

            if (!pmChatId) {
                alert('Сначала начните личный чат с этим другом, чтобы отправить инвайт.');
                return;
            }

            // Decrypt PM AES Key
            let pmAesKey = await idbKeyval.get<CryptoKey>(`aes_key_${pmChatId}`);
            if (!pmAesKey) {
                const { data: keyData } = await supabaseClient
                    .from('chat_keys')
                    .select('encrypted_key')
                    .eq('chat_id', pmChatId)
                    .eq('user_id', currentUser.id)
                    .maybeSingle();

                if (keyData) {
                    let decK = null;
                    try {
                        const keysDict = JSON.parse(keyData.encrypted_key);
                        for (const key of Object.values(keysDict)) {
                            if (typeof key === 'string') {
                                decK = await decryptChatKey(key, currentUser.id);
                                if (decK) break;
                            }
                        }
                    } catch (e) {
                        decK = await decryptChatKey(keyData.encrypted_key, currentUser.id);
                    }
                    pmAesKey = decK;
                }
            }

            if (!pmAesKey) {
                alert('Нет ключа расшифровки от личной переписки.');
                return;
            }

            const encryptedInvite = await encryptText(invitePayload, pmAesKey, currentUser.id);
            await supabaseClient.from('messages').insert({
                chat_id: pmChatId,
                sender_id: currentUser.id,
                encrypted_text: encryptedInvite,
            });

            hapticImpact("success");
            alert('Приглашение отправлено!');
            setActiveModal('none');
        } catch (err: any) {
            alert('Ошибка отправки: ' + err.message);
        }
    };

    const handleRemoveFriendship = async () => {
        if (!confirm('Удалить друга из списка? Личные переписки станут недоступны.')) return;

        try {
            const friendId = chat.friendId || 0;
            const { error } = await supabaseClient.rpc('remove_friend', { target_id: friendId });
            if (error) throw error;

            hapticImpact("warning");
            alert('Друг удален.');
            onBack();
        } catch (e: any) {
            alert(e.message);
        }
    };

    // Debts logic
    const loadDebtsSummary = async () => {
        if (chat.type !== 'private') return;
        const friendId = chat.friendId || 0;

        try {
            const { data, error } = await supabaseClient
                .from('debts')
                .select('id, creditor_id, debtor_id, amount, currency, status, created_by, settlement_requested_at, settled_at, created_at, updated_at')
                .in('status', ['active', 'payment_pending'])
                .or(`and(creditor_id.eq.${friendId},debtor_id.eq.${currentUser.id}),and(creditor_id.eq.${currentUser.id},debtor_id.eq.${friendId})`);

            if (error) throw error;
            setDebts(data || []);
        } catch (e) {
            console.error(e);
        }
    };

    const loadAddDebtSettings = async () => {
        if (chat.type !== 'private') return;
        const friendId = chat.friendId || 0;

        try {
            const { data } = await supabaseClient.from('currencies').select('id, owner_id, name, rub_value').in('owner_id', [friendId, currentUser.id]);
            setCurrencies(data || []);
            if (data && data.length > 0) {
                setSelectedCurrency(data[0]);
            } else {
                setSelectedCurrency({ id: 'rub', owner_id: friendId, name: 'Руб.', rub_value: 1 });
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleSaveDebt = async () => {
        const rubles = parseFloat(debtRubles);
        if (isNaN(rubles) || rubles <= 0) {
            alert('Введите корректную сумму!');
            return;
        }

        const friendId = chat.friendId || 0;
        const price = selectedCurrency ? selectedCurrency.rub_value : 1;
        const currencyName = selectedCurrency ? selectedCurrency.name : 'Руб.';

        const finalAmount = parseFloat((rubles / price).toFixed(2));

        try {
            const { error } = await supabaseClient.rpc('create_debt', {
                target_creditor: friendId,
                debt_amount: finalAmount,
                debt_currency: currencyName,
            });

            if (error) throw error;

            hapticImpact("success");
            setDebtRubles('');
            setActiveModal('debts');
            loadDebtsSummary();
        } catch (err: any) {
            alert('Ошибка добавления: ' + err.message);
        }
    };

    const handleDebtAction = async (debt: Debt, action: 'request' | 'accept' | 'reject' | 'forgive' | 'cancel') => {
        const prompts: Record<typeof action, string> = {
            request: 'Сообщить кредитору, что долг оплачен?',
            accept: 'Подтвердить получение оплаты?',
            reject: 'Отклонить подтверждение оплаты?',
            forgive: 'Простить этот долг?',
            cancel: 'Отменить ошибочно созданный долг?',
        };
        if (!confirm(prompts[action])) return;

        try {
            let error: any = null;
            if (action === 'request') {
                ({ error } = await supabaseClient.rpc('request_debt_settlement', { debt_id: debt.id }));
            } else if (action === 'accept' || action === 'reject') {
                ({ error } = await supabaseClient.rpc('respond_debt_settlement', {
                    debt_id: debt.id,
                    accept_payment: action === 'accept',
                }));
            } else if (action === 'forgive') {
                ({ error } = await supabaseClient.rpc('forgive_debt', { debt_id: debt.id }));
            } else {
                ({ error } = await supabaseClient.rpc('cancel_debt', { debt_id: debt.id }));
            }
            if (error) throw error;
            hapticImpact(action === 'reject' ? 'warning' : 'success');
            await loadDebtsSummary();
        } catch (e: any) {
            alert(e.message);
        }
    };

    const handleShowNameHistory = async () => {
        hapticImpact("selection");
        setHistoryLoading(true);
        setShowHistoryModal(true);
        try {
            // Find the first message timestamp to compute establishedAt
            const { data: firstMsg } = await supabaseClient
                .from('messages')
                .select('created_at')
                .eq('chat_id', chat.id)
                .order('created_at', { ascending: true })
                .limit(1)
                .maybeSingle();

            const establishedAt = firstMsg ? new Date(firstMsg.created_at).getTime() : Date.now();
            setHistoryEstablishedDate(firstMsg ? new Date(firstMsg.created_at).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            }) : 'С момента добавления');

            const { data: history, error: historyError } = await supabaseClient
                .from('user_name_history')
                .select('name, changed_at')
                .eq('user_id', chat.friendId)
                .lt('changed_at', new Date(establishedAt).toISOString())
                .order('changed_at', { ascending: true });
            if (historyError) throw historyError;
            setHistoryNames((history || []).map((item: any) => ({
                name: item.name,
                changed_at: new Date(item.changed_at).getTime(),
            })));
        } catch (err) {
            console.error(err);
            setHistoryNames([]);
        } finally {
            setHistoryLoading(false);
        }
    };

    const isGroup = chat.type === 'group';
    const failedMessageCount = messages.filter((message) => message.deliveryStatus === 'failed' && message.retryPayload).length;

    return (
        <div ref={viewportShellRef} className="chat-viewport-shell flex-1 min-h-0 w-full flex flex-col bg-slate-950 relative select-none animate-fade-in text-slate-100">
            {/* Top Header info */}
            <div className="flex items-center justify-between border-b border-slate-900 pb-3 p-4 bg-slate-900/40 relative z-10 flex-shrink-0">
                <button
                    onClick={onBack}
                    className="text-primary hover:text-primary-hover font-medium flex items-center focus:outline-none"
                >
                    <ChevronLeft className="w-6 h-6" />
                </button>

                <div
                    onClick={() => setActiveModal('info')}
                    className="flex flex-col items-center justify-center text-center cursor-pointer flex-grow mx-4 overflow-hidden"
                >
                    <span className="font-semibold text-slate-200 text-base truncate max-w-full">
                        {isGroup ? groupName : chat.name}
                    </span>
                    <span className="text-xs text-emerald-500 font-mono truncate max-w-full">
                        {chatFingerprint}
                    </span>
                </div>

                <div className="flex gap-2.5">
                    {chat.type === 'private' && (
                        <button
                            onClick={() => setActiveModal('debts')}
                            className="w-9 h-9 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-primary hover:text-primary-hover active:scale-95 transition focus:outline-none"
                        >
                            <Wallet className="w-4.5 h-4.5" />
                        </button>
                    )}
                    <button
                        onClick={() => setActiveModal('search')}
                        className="w-9 h-9 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-primary hover:text-primary-hover active:scale-95 transition focus:outline-none"
                    >
                        <Search className="w-4.5 h-4.5" />
                    </button>
                </div>
            </div>

            {/* Pinned message banner - full width below header */}
            {currentPinnedForBanner && (
                <div
                    onClick={handlePinnedBannerClick}
                    className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-amber-500/8 border-b border-amber-500/20 cursor-pointer hover:bg-amber-500/12 active:bg-amber-500/15 transition-all"
                >
                    <Pin className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
                    <span className="text-xs text-amber-200/80 truncate flex-1 font-medium">
                        {currentPinnedForBanner?.text || '🔗 Голосовое сообщение / вложение'}
                    </span>
                    {sortedPinnedMessages.length > 1 && (
                        <span className="text-[10px] text-amber-500/50 font-mono shrink-0">
                            {pinnedBannerIdx + 1}/{sortedPinnedMessages.length}
                        </span>
                    )}
                </div>
            )}

            {/* Messages area in reverse layout */}
            <div className="chat-container flex-grow overflow-hidden relative">
                <div
                    ref={messagesAreaRef}
                    onScroll={handleScroll}
                    onClick={() => setActiveMessageMenu(null)}
                    className="messages-area h-full overflow-y-auto p-4 flex flex-col-reverse gap-3.5 select-text"
                >
                    {isLoadingChat ? (
                        <div className="flex flex-col gap-4 opacity-50 pointer-events-none w-full">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className={`flex w-full ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`w-2/3 h-16 rounded-2xl animate-pulse ${i % 2 === 0 ? 'bg-primary/20' : 'bg-slate-800'}`} />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <>
                            {messages
                                .slice()
                                .reverse()
                                .slice(0, renderLimit)
                                .map((m) => {
                                    const msgDate = new Date(m.created_at);
                                    const timeStr = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                    const isSwiping = swipingMsgId.current === m.id;

                                    return (
                                        <div
                                            key={m.id}
                                            id={`msg-${m.id}`}
                                            onTouchStart={(e) => handleTouchStart(e, m.id)}
                                            onTouchMove={(e) => handleTouchMove(e, m.id)}
                                            onTouchEnd={handleTouchEnd}
                                            className={`flex w-full relative ${m.isMine ? 'justify-end' : 'justify-start'}`}
                                        >
                                            <div
                                                style={{
                                                    transform: isSwiping ? `translateX(${swipeOffset}px)` : 'translateX(0px)',
                                                    transition: isSwiping ? 'none' : 'transform 0.2s ease-out',
                                                }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (activeMessageMenu === m.id) {
                                                        setActiveMessageMenu(null);
                                                    } else {
                                                        // Determine if menu should open upward (near bottom of chat)
                                                        const msgEl = e.currentTarget as HTMLElement;
                                                        const areaEl = messagesAreaRef.current;
                                                        if (areaEl && msgEl) {
                                                            const areaRect = areaEl.getBoundingClientRect();
                                                            const msgRect = msgEl.getBoundingClientRect();
                                                            const distFromBottom = areaRect.bottom - msgRect.bottom;
                                                            setMenuOpenUp(distFromBottom < 120);
                                                        } else {
                                                            setMenuOpenUp(false);
                                                        }
                                                        setActiveMessageMenu(m.id);
                                                    }
                                                }}
                                                className={`msg-bubble flex flex-col px-4 py-3 relative max-w-[85%] break-words overflow-hidden ${m.isMine
                                                        ? 'msg-mine bg-primary text-white rounded-[18px] rounded-br-[4px] shadow-md shadow-primary/10'
                                                        : 'msg-other bg-slate-900 border border-slate-850 text-slate-100 rounded-[18px] rounded-bl-[4px]'
                                                    }`}
                                            >
                                                {pinnedMessageIds.has(m.id) && (
                                                    <div className={`mb-1 flex items-center gap-1 text-[10px] font-semibold ${m.isMine ? 'text-white/70' : 'text-amber-300'}`}>
                                                        <Pin className="w-3 h-3 fill-current" /> Закреплено
                                                    </div>
                                                )}

                                                {/* Sender Name in group */}
                                                {isGroup && !m.isMine && (
                                                    <div className="sender-name text-xs font-bold text-primary mb-1">
                                                        {getSenderName(m.sender_id)}
                                                    </div>
                                                )}

                                                {/* Reply block wrapper */}
                                                {m.reply && (
                                                    <div
                                                        onClick={() => handleScrollToMessage(m.reply!.id)}
                                                        className={`msg-reply-block cursor-pointer border-l-2 p-1.5 rounded mb-2.5 text-xs ${m.isMine
                                                                ? 'bg-white/10 border-white text-white/95'
                                                                : 'bg-black/10 border-primary text-slate-300'
                                                            }`}
                                                    >
                                                        <div className="font-bold mb-0.5">{m.reply.name}</div>
                                                        <div className="truncate">{m.reply.text}</div>
                                                    </div>
                                                )}

                                                {/* Message main bodies */}
                                                {m.voiceData ? (
                                                    <VoicePlayer
                                                        fileName={m.voiceData.fileName}
                                                        waveformString={m.voiceData.waveform.join(',')}
                                                        aesKey={chatKey}
                                                        transcription={m.voiceData.transcription}
                                                        isProcessing={m.voiceData.isProcessing}
                                                        isError={m.voiceData.isError}
                                                        hasTranscript={m.voiceData.hasTranscript}
                                                        msgId={m.id}
                                                        onTranscribe={handleManualTranscribe}
                                                        isMine={m.isMine}
                                                        localUrl={m.voiceData.localUrl}
                                                    />
                                                ) : m.inviteData ? (
                                                    <div className="flex flex-col gap-3 p-2 bg-black/15 rounded-xl border border-white/5">
                                                        <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                                                            Приглашение в группу
                                                        </span>
                                                        <span className="font-bold text-base text-slate-100">{m.inviteData.groupName}</span>
                                                        {!m.isMine && (
                                                            <button
                                                                onClick={() => handleAcceptGroupInvite(m.inviteData!.groupId, m.inviteData!.keysJSON)}
                                                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition"
                                                            >
                                                                Вступить в группу
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : m.isError ? (
                                                    <span className="text-rose-300 flex items-center gap-1.5 italic text-sm">
                                                        <Shield className="w-4 h-4 text-rose-500 flex-shrink-0" /> {m.text}
                                                    </span>
                                                ) : !m.isAuthentic ? (
                                                    <span className="text-rose-300 flex items-center gap-1.5 italic text-sm font-semibold">
                                                        <Shield className="w-4 h-4 text-rose-500 flex-shrink-0 animate-bounce" /> [ОТКЛОНЕНО: Подпись подделана!]
                                                    </span>
                                                ) : (
                                                    <div className="whitespace-pre-wrap select-text text-sm leading-relaxed">{m.text}</div>
                                                )}

                                                {/* Timestamps */}
                                                <span
                                                    className={`text-[10px] text-right mt-1 w-full block tracking-wide select-none ${m.isMine ? 'text-white/60' : 'text-slate-500'
                                                        }`}
                                                >
                                                    <span>{timeStr}</span>
                                                    {m.deliveryStatus === 'sending' && <span> · отправка…</span>}
                                                    {m.deliveryStatus === 'failed' && <span> · не отправлено</span>}
                                                    {m.isMine && m.deliveryStatus === 'sent' && (
                                                        <span
                                                            className="inline-flex items-center ml-1 align-[-2px] text-sky-300"
                                                            title="Принято сервером"
                                                            aria-label="Сообщение принято сервером"
                                                        >
                                                            <Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" />
                                                        </span>
                                                    )}
                                                </span>
                                                {m.deliveryStatus === 'failed' && (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); void retryMessage(m); }}
                                                        disabled={isRetryingFailed || !online}
                                                        className="mt-1 self-end text-[11px] font-semibold text-rose-200 underline underline-offset-2 disabled:opacity-50 disabled:no-underline"
                                                    >
                                                        Повторить
                                                    </button>
                                                )}
                                            </div>

                                            {/* Context Menu */}
                                            {activeMessageMenu === m.id && (
                                                <div className={`absolute ${menuOpenUp ? 'bottom-full mb-1' : 'top-full mt-1'} flex items-center gap-1 bg-slate-900 border border-slate-700 shadow-xl rounded-xl p-1 z-50 ${m.isMine ? 'right-0' : 'left-0'}`}>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            let cleanText = m.text;
                                                            if (cleanText.startsWith('[VOICE]:')) cleanText = '🎤 Голосовое сообщение';
                                                            if (cleanText.startsWith('[GROUP_INVITE]:')) cleanText = '🎫 Приглашение в группу';
                                                            setReplyTo({ id: m.id, name: m.isMine ? 'Я' : getSenderName(m.sender_id), text: cleanText });
                                                            setActiveMessageMenu(null);
                                                        }}
                                                        className="flex flex-col items-center justify-center gap-1 min-w-[70px] p-2 rounded-lg hover:bg-slate-800 transition"
                                                    >
                                                        <Reply className="w-5 h-5 text-slate-300" />
                                                        <span className="text-[10px] font-semibold text-slate-400">Ответить</span>
                                                    </button>

                                                    {!m.id.startsWith('pending-') && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                toggleMessagePin(m.id);
                                                                setActiveMessageMenu(null);
                                                            }}
                                                            className="flex flex-col items-center justify-center gap-1 min-w-[70px] p-2 rounded-lg hover:bg-slate-800 transition"
                                                        >
                                                            {pinnedMessageIds.has(m.id) ? (
                                                                <PinOff className="w-5 h-5 text-amber-400" />
                                                            ) : (
                                                                <Pin className="w-5 h-5 text-slate-300" />
                                                            )}
                                                            <span className={`text-[10px] font-semibold ${pinnedMessageIds.has(m.id) ? 'text-amber-400' : 'text-slate-400'}`}>
                                                                {pinnedMessageIds.has(m.id) ? 'Открепить' : 'Закрепить'}
                                                            </span>
                                                        </button>
                                                    )}

                                                    {m.isMine && m.deliveryStatus !== 'sending' && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                void handleDeleteMessage(m);
                                                                setActiveMessageMenu(null);
                                                            }}
                                                            className="flex flex-col items-center justify-center gap-1 min-w-[70px] p-2 rounded-lg hover:bg-rose-900/40 hover:text-rose-400 transition group"
                                                        >
                                                            <Trash className="w-5 h-5 text-rose-400/80 group-hover:text-rose-400" />
                                                            <span className="text-[10px] font-semibold text-rose-400/80 group-hover:text-rose-400">Удалить</span>
                                                        </button>
                                                    )}
                                                </div>
                                            )}

                                            {isSwiping && swipeOffset < 0 && (
                                                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-full bg-slate-800 text-slate-300 z-0">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                                    </svg>
                                                </div>
                                            )}

                                        </div>
                                    );
                                })}
                            {hasMoreInHistory && renderLimit >= messages.length && (
                                <button
                                    type="button"
                                    onClick={() => void loadOlderMessages()}
                                    disabled={isLoadingOlder}
                                    className="self-center mt-2 px-4 py-2 rounded-full border border-slate-700 bg-slate-900/90 text-xs text-slate-300 hover:text-white disabled:opacity-60"
                                >
                                    {isLoadingOlder ? 'Загрузка истории…' : 'Загрузить более старые сообщения'}
                                </button>
                            )}
                        </>
                    )}
                </div>

                {/* Scroll back bottom float button */}
                <button
                    onClick={handleScrollToBottom}
                    className={`absolute right-4 bottom-5 w-11 h-11 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-200 shadow-xl transition-all duration-300 focus:outline-none z-40 transform ${showScrollBottom ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-75 pointer-events-none'
                        }`}
                >
                    <ArrowDown className="w-5 h-5 animate-bounce" />
                </button>
            </div>

            {/* Input controller bar */}
            <div className="chat-input-area flex-shrink-0 flex flex-col bg-slate-900/80 backdrop-blur-xl border-t border-slate-900 px-4 py-2 relative z-10">
                {failedMessageCount > 0 && online && (
                    <div className="flex items-center justify-between gap-3 mb-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 animate-slide-up" role="status">
                        <div className="min-w-0">
                            <div className="text-xs font-semibold text-amber-200">Не отправлено: {failedMessageCount}</div>
                            <div className="text-[10px] text-amber-200/60 truncate">Соединение доступно — можно повторить отправку</div>
                        </div>
                        <button
                            type="button"
                            onClick={() => void retryAllFailedMessages()}
                            disabled={isRetryingFailed}
                            className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-400/15 px-3 py-2 text-[11px] font-bold text-amber-100 transition active:scale-95 disabled:opacity-60"
                        >
                            {isRetryingFailed && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            {isRetryingFailed ? 'ОТПРАВЛЯЕМ…' : 'ОТПРАВИТЬ ВСЕ'}
                        </button>
                    </div>
                )}
                {/* Reply Preview */}
                {replyTo && (
                    <div className="flex items-center gap-2 bg-slate-950/40 p-2.5 rounded-xl border border-slate-900/60 mb-2 select-none animate-slide-up">
                        <div className="flex-grow border-l-2 border-primary pl-3">
                            <div className="text-xs font-semibold text-primary">{replyTo.name}</div>
                            <div className="text-xs text-slate-400 truncate max-w-[260px]">{replyTo.text}</div>
                        </div>
                        <button
                            onClick={() => setReplyTo(null)}
                            className="text-slate-500 hover:text-slate-300 p-1"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {/* Form controls */}
                <div className="flex items-end gap-3 w-full relative">
                    {isRecording && (
                        <div className="absolute inset-y-0 left-0 right-[56px] bg-slate-900 z-20 flex items-center justify-between px-2 rounded-2xl">
                            <div className="flex items-center gap-3">
                                {!isRecordLocked ? (
                                    <>
                                        <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                                        <span className="text-slate-200 font-mono font-bold tracking-widest text-lg">
                                            {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:{(recordingDuration % 60).toString().padStart(2, '0')}
                                        </span>
                                    </>
                                ) : (
                                    <button onClick={cancelRecording} className="text-slate-400 p-2 hover:bg-slate-800 rounded-full transition">
                                        <Trash2 className="w-5 h-5" />
                                    </button>
                                )}
                            </div>

                            {!isRecordLocked ? (
                                <div className="flex flex-col items-end gap-1 select-none pointer-events-none mr-2">
                                    <span className="text-slate-400 text-[10px] uppercase font-bold flex items-center gap-1"><span className="text-lg leading-none">&larr;</span> Отмена</span>
                                    <span className="text-slate-400 text-[10px] uppercase font-bold flex items-center gap-1">Замок <span className="text-lg leading-none">&uarr;</span></span>
                                </div>
                            ) : (
                                <div className="flex items-center justify-center flex-grow min-w-0 overflow-hidden">
                                    {recordPreviewUrl && (
                                        <audio
                                            ref={previewAudioRef}
                                            src={recordPreviewUrl}
                                            onEnded={() => {
                                                setIsRecordPlaying(false);
                                                setRecordPreviewProgress(0);
                                            }}
                                            onTimeUpdate={(e) => {
                                                const target = e.target as HTMLAudioElement;
                                                if (target.duration) {
                                                    setRecordPreviewProgress(target.currentTime / target.duration);
                                                }
                                            }}
                                            className="hidden"
                                        />
                                    )}
                                    {isRecordPaused ? (
                                        <div className="flex items-center gap-2 bg-slate-800/50 py-1 px-3 rounded-full flex-grow mx-2 min-w-0">
                                            <button
                                                onClick={() => {
                                                    if (previewAudioRef.current) {
                                                        if (isRecordPlaying) {
                                                            previewAudioRef.current.pause();
                                                            setIsRecordPlaying(false);
                                                        } else {
                                                            previewAudioRef.current.play();
                                                            setIsRecordPlaying(true);
                                                        }
                                                    }
                                                }}
                                                className="text-primary hover:scale-105 transition flex-shrink-0"
                                            >
                                                {isRecordPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
                                            </button>

                                            <div className="flex items-center gap-0.5 h-6 flex-grow overflow-hidden justify-center opacity-70">
                                                {(function () {
                                                    const bars = 30;
                                                    let displayWave = [];
                                                    if (recordWaveHistory.length <= bars) {
                                                        displayWave = [...recordWaveHistory];
                                                    } else {
                                                        const step = recordWaveHistory.length / bars;
                                                        for (let i = 0; i < bars; i++) {
                                                            const start = Math.floor(i * step);
                                                            const end = Math.floor((i + 1) * step);
                                                            const chunk = recordWaveHistory.slice(start, end);
                                                            const avg = chunk.length > 0 ? chunk.reduce((a, b) => a + b, 0) / chunk.length : 0;
                                                            displayWave.push(avg);
                                                        }
                                                    }
                                                    const maxVol = Math.max(...displayWave, 50);

                                                    return displayWave.map((vol, idx) => {
                                                        const isActive = idx < Math.floor(recordPreviewProgress * displayWave.length);
                                                        return (
                                                            <div
                                                                key={idx}
                                                                className={`w-[3px] min-w-[3px] rounded-[2px] transition-all ${isActive ? 'bg-primary' : 'bg-slate-400'}`}
                                                                style={{ height: `${Math.max(10, Math.min(100, (vol / maxVol) * 100))}%` }}
                                                            />
                                                        );
                                                    });
                                                })()}
                                            </div>

                                            <span className="text-slate-300 font-mono font-bold tracking-widest text-sm flex-shrink-0">
                                                {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:{(recordingDuration % 60).toString().padStart(2, '0')}
                                            </span>
                                            <div className="w-px h-5 bg-slate-700 flex-shrink-0" />
                                            <button onClick={resumeRecording} className="text-slate-400 hover:text-red-400 transition flex items-center flex-shrink-0">
                                                <Mic className="w-5 h-5" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-3 w-full max-w-[150px] mx-auto">
                                            <button onClick={pauseRecording} className="text-red-400 hover:text-red-300 transition p-1 bg-red-400/10 rounded-full flex-shrink-0">
                                                <Pause className="w-5 h-5 fill-current" />
                                            </button>
                                            <span className="text-red-400 font-mono font-bold tracking-widest text-sm">
                                                {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:{(recordingDuration % 60).toString().padStart(2, '0')}
                                            </span>
                                            <div className="flex items-center gap-0.5 h-6 flex-grow overflow-hidden justify-end">
                                                {(function () {
                                                    const displayWave = recordWaveHistory.slice(-30);
                                                    const maxVol = Math.max(...recordWaveHistory, 50);
                                                    return displayWave.map((vol, idx) => (
                                                        <div
                                                            key={idx}
                                                            className="w-[3px] min-w-[3px] bg-red-400 rounded-[2px] transition-all"
                                                            style={{ height: `${Math.max(10, Math.min(100, (vol / maxVol) * 100))}%` }}
                                                        />
                                                    ));
                                                })()}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={inputText}
                        onChange={(e) => handleInputChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendMessage();
                            }
                        }}
                        placeholder="Сообщение..."
                        className="flex-grow bg-slate-950 border border-slate-850 text-slate-200 rounded-2xl px-4 py-2.5 text-base focus:border-primary outline-none max-h-[120px] resize-none overflow-y-auto leading-[20px] min-h-[42px]"
                    />

                    {inputText.trim() || isRecordLocked ? (
                        <button
                            onClick={() => isRecordLocked ? forceStopRecordingAndSend() : handleSendMessage()}
                            className="w-11 h-11 rounded-full bg-primary text-white flex items-center justify-center active:scale-95 transition-all shadow-lg shadow-primary/10 focus:outline-none z-30 flex-shrink-0"
                        >
                            <Send className="w-5 h-5 transform rotate-[-15deg] translate-x-[-1px] translate-y-[1px]" />
                        </button>
                    ) : (
                        <button
                            onMouseDown={startRecording}
                            onTouchStart={startRecording}
                            onMouseUp={stopRecordingAndSend}
                            onTouchEnd={stopRecordingAndSend}
                            onTouchMove={handleMicTouchMove}
                            onMouseMove={handleMicTouchMove}
                            style={{ transform: `scale(${micPulseScale})` }}
                            className={`w-11 h-11 rounded-full border text-slate-300 flex items-center justify-center transition shadow-lg focus:outline-none touch-none select-none z-30 flex-shrink-0 ${isRecording ? 'bg-red-500 border-red-500 text-white shadow-red-500/20' : 'bg-slate-900 border-slate-800 active:bg-slate-800'}`}
                        >
                            <Mic className="w-5 h-5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Info details screen */}
            {activeModal === 'info' && (
                <div className="fixed inset-0 z-[1000] bg-slate-950 p-5 overflow-y-auto flex flex-col font-sans animate-fade-in">
                    <div className="max-w-md mx-auto w-full flex flex-col h-full">
                        <div className="flex items-center justify-between pb-4 border-b border-slate-900 mb-8 shrink-0">
                            <button
                                onClick={() => setActiveModal('none')}
                                className="text-slate-400 hover:text-slate-200 bg-slate-900/50 border border-slate-900 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                            >
                                Закрыть
                            </button>
                            <span className="font-extrabold font-mono tracking-wider text-slate-300 text-xs uppercase">
                                {isGroup ? 'Инфо Группы' : 'Профиль'}
                            </span>
                            <div className="w-16" />
                        </div>

                        <div className="flex flex-col items-center mb-10 relative">
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

                            <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-800 flex items-center justify-center text-4xl font-bold font-mono text-primary shadow-xl shadow-black/50 mb-4 z-10">
                                {(isGroup ? groupName : chat.name).charAt(0).toUpperCase()}
                            </div>

                            <div className="flex items-center justify-center gap-2 mb-1.5 z-10 w-full px-4">
                                <h2 className="text-2xl font-black text-slate-100 tracking-tight truncate text-center">
                                    {isGroup ? groupName : chat.name}
                                </h2>
                                {isGroup && chat.created_by === currentUser.id && (
                                    <button onClick={handleEditGroupName} className="text-slate-500 hover:text-primary transition-colors flex-shrink-0" title="Изменить имя">
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                )}
                            </div>

                            <div className="flex items-center gap-2 z-10">
                                <span className="text-[10px] font-bold font-mono text-slate-600 uppercase tracking-widest">ID</span>
                                <span className="text-xs text-slate-400 font-mono select-text bg-slate-900/50 px-2.5 py-1 rounded-lg border border-slate-800/50">{chat.id}</span>
                            </div>
                        </div>

                        {isGroup ? (
                            <div className="flex flex-col gap-5 flex-grow z-10">
                                <button
                                    onClick={() => setActiveModal('invite-friend')}
                                    className="w-full bg-primary hover:bg-primary-hover active:bg-primary/90 text-white font-bold font-mono tracking-wide py-4 rounded-2xl flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] shadow-lg shadow-primary/20"
                                >
                                    <UserPlus className="w-5 h-5" /> ПОЗВАТЬ В ГРУППУ
                                </button>

                                <div className="bg-slate-900/30 border border-slate-900/80 p-5 rounded-3xl mt-2">
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="text-[10px] font-bold text-slate-500 font-mono uppercase tracking-widest">
                                            Участники
                                        </h4>
                                        <span className="text-[10px] font-bold text-primary font-mono bg-primary/10 px-2 py-0.5 rounded-md">
                                            {groupMembers.length}
                                        </span>
                                    </div>

                                    <div className="flex flex-col gap-3">
                                        {groupMembers.map((m) => (
                                            <div key={m.tg_id} className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-800/30 transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-slate-800/80 border border-slate-700/50 text-slate-300 flex items-center justify-center text-sm font-bold shadow-inner">
                                                        {m.first_name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="flex flex-col leading-none gap-1">
                                                        <span className="text-sm font-bold text-slate-200">
                                                            {m.first_name}
                                                        </span>
                                                        <span className="text-[9px] font-mono text-slate-500 uppercase">
                                                            ID: {m.tg_id}
                                                        </span>
                                                    </div>
                                                </div>
                                                {m.tg_id === currentUser.id && (
                                                    <span className="text-[9px] font-bold text-emerald-500 font-mono bg-emerald-500/10 px-2 py-1 rounded-md uppercase tracking-wider">
                                                        Вы
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex flex-col gap-3 mt-auto pt-6">
                                    <button
                                        onClick={handleLeaveGroup}
                                        className="w-full bg-slate-900/50 hover:bg-slate-800 text-rose-400 font-bold font-mono tracking-wide py-3.5 rounded-2xl flex items-center justify-center gap-2 transition border border-rose-500/20"
                                    >
                                        <LogOut className="w-4 h-4" /> ВЫЙТИ ИЗ ГРУППЫ
                                    </button>
                                    {chat.created_by === currentUser.id && (
                                        <button
                                            onClick={handleDeleteGroupForEveryone}
                                            className="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 font-bold font-mono tracking-wide py-3.5 rounded-2xl flex items-center justify-center gap-2 transition border border-rose-500/30"
                                        >
                                            <Trash className="w-4 h-4" /> УДАЛИТЬ ДЛЯ ВСЕХ
                                        </button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3 mt-auto pt-6 z-10">
                                {/* Pinned messages in profile */}
                                {sortedPinnedMessages.length > 0 && (
                                    <div className="bg-slate-900/30 border border-amber-500/15 p-4 rounded-2xl mb-2">
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="text-[10px] font-bold text-amber-400/70 font-mono uppercase tracking-widest flex items-center gap-1.5">
                                                <Pin className="w-3.5 h-3.5 fill-amber-400" /> Закреплённые
                                            </h4>
                                            <span className="text-[10px] font-bold text-amber-500 font-mono bg-amber-500/10 px-2 py-0.5 rounded-md">
                                                {sortedPinnedMessages.length}
                                            </span>
                                        </div>
                                        <div className="space-y-2 max-h-[35vh] overflow-y-auto pr-1">
                                            {sortedPinnedMessages.map((msg) => {
                                                const msgDate = new Date(msg.created_at);
                                                const dateStr = msgDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                                                return (
                                                    <div
                                                        key={msg.id}
                                                        onClick={() => {
                                                            hapticImpact('light');
                                                            setActiveModal('none');
                                                            setTimeout(() => handleScrollToMessage(msg.id), 300);
                                                        }}
                                                        className="flex flex-col gap-1 p-2.5 bg-slate-950/50 border border-slate-900 rounded-xl cursor-pointer hover:bg-amber-500/5 active:scale-[0.98] transition-all"
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[9px] font-bold text-amber-400/60 font-mono uppercase">
                                                                {msg.isMine ? 'Вы' : (msg.senderName || 'Собеседник')}
                                                            </span>
                                                            <span className="text-[9px] text-slate-600 font-mono">{dateStr}</span>
                                                        </div>
                                                        <span className="text-xs text-slate-300 leading-relaxed break-words line-clamp-2">
                                                            {msg.text || '🔗 Голосовое / вложение'}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                <button
                                    onClick={handleShowNameHistory}
                                    className="w-full bg-slate-900/50 hover:bg-slate-900 text-slate-300 font-bold font-mono tracking-wide py-4 rounded-2xl flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] border border-slate-800/80"
                                >
                                    <History className="w-5 h-5 text-primary" /> ИСТОРИЯ ИМЁН
                                </button>
                                <button
                                    onClick={handleRemoveFriendship}
                                    className="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 font-bold font-mono tracking-wide py-3.5 rounded-2xl flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] border border-rose-500/20"
                                >
                                    <UserMinus className="w-4.5 h-4.5" /> УДАЛИТЬ КОНТАКТ
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Name History Dialog Overlay */}
            {showHistoryModal && (
                <div className="fixed inset-0 z-[2000] bg-slate-950/90 backdrop-blur-md flex flex-col justify-center p-4 animate-fade-in font-sans">
                    <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/90 p-5 rounded-3xl flex flex-col gap-4 max-w-sm w-full mx-auto relative shadow-2xl overflow-y-auto max-h-[85vh] scrollbar-thin">
                        <h3 className="font-extrabold font-mono tracking-tight text-slate-100 text-base uppercase flex items-center gap-2">
                            <History className="w-5 h-5 text-primary" /> История имён
                        </h3>

                        <div className="text-xs text-slate-400 leading-relaxed mb-1">
                            Показаны только те имена собеседника, которые использовались <span className="text-primary font-semibold">ДО вашего первого контакта</span> с ним ({historyEstablishedDate}). Более новые изменения скрыты для защиты от шума и дублирования данных.
                        </div>

                        {historyLoading ? (
                            <div className="flex flex-col items-center justify-center py-8 gap-2 text-slate-500">
                                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                <span className="text-xs font-mono">Вычисление среза истории...</span>
                            </div>
                        ) : historyNames.length > 0 ? (
                            <div className="space-y-2.5 max-h-[40vh] overflow-y-auto pr-1">
                                {historyNames.map((item, index) => {
                                    const changeDate = new Date(item.changed_at);
                                    const dateStr = changeDate.toLocaleDateString('ru-RU', {
                                        day: 'numeric',
                                        month: 'short',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    });
                                    return (
                                        <div key={index} className="flex flex-col gap-1 p-3 bg-slate-950/60 border border-slate-900 rounded-xl">
                                            <span className="font-bold text-slate-200 text-sm">{item.name}</span>
                                            <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono">
                                                <Calendar className="w-3 h-3 text-slate-600" /> {dateStr}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-8 text-center bg-slate-950/40 border border-slate-900 rounded-2xl p-4">
                                <AlertTriangle className="w-7 h-7 text-amber-500/80 mb-2" />
                                <span className="text-xs font-bold text-slate-400 block">Нет более ранних имён</span>
                                <span className="text-[10px] text-slate-500 mt-1">До первого сообщения в этом чате собеседник не менял имя (или у вас актуальная версия).</span>
                            </div>
                        )}

                        <button
                            onClick={() => { hapticImpact("selection"); setShowHistoryModal(false); }}
                            className="w-full bg-primary hover:bg-primary-hover text-white font-bold font-mono py-3 rounded-2xl transition mt-2"
                        >
                            ПОНЯТНО
                        </button>
                    </div>
                </div>
            )}

            {/* Deep Search screen */}
            {activeModal === 'search' && (
                <div className="fixed inset-0 z-[1000] bg-slate-950 p-5 overflow-y-auto flex flex-col font-sans animate-fade-in">
                    <div className="flex items-center justify-between pb-4 border-b border-slate-900 mb-6 shrink-0 max-w-3xl mx-auto w-full">
                        <button
                            onClick={() => setActiveModal('none')}
                            className="text-slate-400 hover:text-slate-200 bg-slate-900/50 border border-slate-900 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                        >
                            <ChevronLeft className="w-4 h-4" /> Назад
                        </button>
                        <span className="font-extrabold font-mono tracking-wider text-slate-300 text-xs uppercase">
                            Глубокий поиск
                        </span>
                        <div className="w-16" />
                    </div>
                    <div className="flex-grow overflow-hidden max-w-3xl mx-auto w-full flex flex-col relative bg-slate-900/30 rounded-3xl border border-slate-800 shadow-xl overflow-hidden">
                        <div className="absolute top-0 inset-x-0 h-32 bg-primary/5 blur-3xl pointer-events-none" />
                        <DeepSearch chatId={chat.id} aesKey={chatKey} userId={currentUser.id} />
                    </div>
                </div>
            )}

            {/* Debt summary list screen */}
            {activeModal === 'debts' && (
                <div className="fixed inset-0 z-[1000] bg-slate-950 p-6 overflow-y-auto flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <button onClick={() => setActiveModal('none')} className="text-primary font-medium">
                            Закрыть
                        </button>
                        <span className="font-bold text-slate-200">Сводка долгов</span>
                        <div className="w-10" />
                    </div>

                    <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl mb-6">
                        {debts.length === 0 ? (
                            <div className="text-center py-10 flex flex-col items-center justify-center text-slate-500 text-sm">
                                <HelpCircle className="w-10 h-10 text-slate-700 mb-2" />
                                Никто никому не должен
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4 divide-y divide-slate-900">
                                {debts.map((d, idx) => {
                                    const amIDebtor = d.debtor_id === currentUser.id;
                                    const amICreditor = d.creditor_id === currentUser.id;
                                    const pending = d.status === 'payment_pending';

                                    return (
                                        <div
                                            key={d.id}
                                            className={`flex flex-col gap-3 ${idx > 0 ? 'pt-4' : ''}`}
                                        >
                                            <div className="flex justify-between items-center gap-3">
                                                <div className="flex flex-col">
                                                    <span className={`font-bold text-lg ${amIDebtor ? 'text-rose-500' : 'text-emerald-500'}`}>
                                                        {amIDebtor ? '-' : '+'} {d.amount} {d.currency}
                                                    </span>
                                                    <span className="text-xs text-slate-400 mt-1">
                                                        {pending
                                                            ? (amIDebtor ? 'Ожидает подтверждения кредитора' : 'Должник сообщил об оплате')
                                                            : (amIDebtor ? 'Вы должны' : 'Вам должны')}
                                                    </span>
                                                </div>
                                                {pending && (
                                                    <span className="text-[10px] uppercase tracking-wider font-mono text-amber-400 border border-amber-500/20 bg-amber-500/5 px-2 py-1 rounded-lg">
                                                        Проверка
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex flex-wrap gap-2">
                                                {amIDebtor && !pending && (
                                                    <button
                                                        onClick={() => handleDebtAction(d, 'request')}
                                                        className="bg-primary/10 border border-primary/20 text-primary font-semibold py-2 px-3 rounded-lg text-sm transition"
                                                    >
                                                        Я оплатил
                                                    </button>
                                                )}
                                                {amICreditor && pending && (
                                                    <>
                                                        <button
                                                            onClick={() => handleDebtAction(d, 'accept')}
                                                            className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold py-2 px-3 rounded-lg text-sm transition"
                                                        >
                                                            Подтвердить
                                                        </button>
                                                        <button
                                                            onClick={() => handleDebtAction(d, 'reject')}
                                                            className="bg-rose-500/10 border border-rose-500/20 text-rose-400 font-semibold py-2 px-3 rounded-lg text-sm transition"
                                                        >
                                                            Не получено
                                                        </button>
                                                    </>
                                                )}
                                                {amICreditor && (
                                                    <button
                                                        onClick={() => handleDebtAction(d, 'forgive')}
                                                        className="bg-slate-900 border border-slate-800 text-slate-300 font-semibold py-2 px-3 rounded-lg text-sm transition"
                                                    >
                                                        Простить
                                                    </button>
                                                )}
                                                {d.created_by === currentUser.id && d.status === 'active' && (
                                                    <button
                                                        onClick={() => handleDebtAction(d, 'cancel')}
                                                        className="bg-slate-900 border border-slate-800 text-slate-500 hover:text-slate-300 font-semibold py-2 px-3 rounded-lg text-sm transition"
                                                    >
                                                        Отменить
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => setActiveModal('add-debt')}
                        className="w-full bg-primary hover:bg-primary-hover text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-1.5 mt-auto transition"
                    >
                        <Plus className="w-5 h-5" /> Оформить долг
                    </button>
                </div>
            )}

            {/* Add Debt view screen */}
            {activeModal === 'add-debt' && (
                <div className="fixed inset-0 z-[1000] bg-slate-950 p-5 overflow-y-auto flex flex-col font-sans animate-fade-in">
                    <div className="max-w-md mx-auto w-full flex flex-col h-full">
                        <div className="flex items-center justify-between pb-4 border-b border-slate-900 mb-6 shrink-0">
                            <button
                                onClick={() => setActiveModal('debts')}
                                className="text-slate-400 hover:text-slate-200 bg-slate-900/50 border border-slate-900 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                            >
                                <ChevronLeft className="w-4 h-4" /> Назад
                            </button>
                            <span className="font-extrabold font-mono tracking-wider text-slate-300 text-xs uppercase">
                                Новый долг
                            </span>
                            <div className="w-16" />
                        </div>

                        <div className="bg-gradient-to-br from-slate-900/80 to-slate-950/80 border border-slate-900 p-5 rounded-3xl relative overflow-hidden shadow-xl flex flex-col gap-5">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />

                            <div className="flex flex-col gap-2 relative">
                                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest pl-1">
                                    Я должен (В рублях)
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={debtRubles}
                                        onChange={(e) => setDebtRubles(e.target.value)}
                                        placeholder="0"
                                        className="w-full bg-slate-950/50 border border-slate-800 focus:border-primary/50 text-slate-100 rounded-2xl px-5 py-4 text-2xl font-bold font-mono outline-none transition-colors"
                                    />
                                    <span className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 font-bold font-mono text-xl">₽</span>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2 relative">
                                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest pl-1">
                                    В чем принимает друг
                                </label>
                                <div className="relative w-full">
                                    <select
                                        onChange={(e) => {
                                            const selected = currencies.find((c) => c.id === e.target.value);
                                            setSelectedCurrency(selected || null);
                                        }}
                                        className="w-full bg-slate-950/50 border border-slate-800 focus:border-primary/50 text-slate-200 font-semibold rounded-2xl px-5 py-4 text-base outline-none appearance-none cursor-pointer transition-colors"
                                    >
                                        {currencies.length === 0 && <option value="">Загрузка...</option>}
                                        {currencies.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.name} (Курс: {c.rub_value} ₽)
                                            </option>
                                        ))}
                                    </select>
                                    <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-slate-400 bg-slate-950/50 pl-2">
                                        <ArrowDown className="w-5 h-5" />
                                    </div>
                                </div>
                            </div>

                            {selectedCurrency && debtRubles && parseFloat(debtRubles) > 0 ? (
                                <div className="text-center py-5 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 my-1 relative overflow-hidden animate-fade-in">
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500/5 to-transparent animate-shimmer" />
                                    <span className="text-[10px] text-emerald-500/70 font-bold font-mono tracking-widest uppercase">
                                        Итого к выплате
                                    </span>
                                    <div className="flex items-center justify-center gap-2 mt-1">
                                        <span className="text-3xl font-black text-emerald-400 font-mono tracking-tight">
                                            {(parseFloat(debtRubles) / selectedCurrency.rub_value).toFixed(2)}
                                        </span>
                                        <span className="text-xl font-bold text-emerald-500/80 mt-1">
                                            {selectedCurrency.name}
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-5 bg-slate-950/40 rounded-2xl border border-slate-900/60 my-1">
                                    <span className="text-[10px] text-slate-600 font-bold font-mono tracking-widest uppercase">
                                        Итого к выплате
                                    </span>
                                    <div className="flex items-center justify-center mt-1">
                                        <span className="text-xl font-bold text-slate-500 font-mono tracking-tight">
                                            0.00
                                        </span>
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={handleSaveDebt}
                                className="w-full bg-primary hover:bg-primary-hover active:bg-primary/90 text-white font-bold font-mono tracking-wide py-4 rounded-2xl flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] mt-2 shadow-lg shadow-primary/20"
                            >
                                ЗАФИКСИРОВАТЬ
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Invite friends list selection screen */}
            {activeModal === 'invite-friend' && (
                <div className="fixed inset-0 z-[1000] bg-slate-950 p-6 overflow-y-auto flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <button onClick={() => setActiveModal('info')} className="text-primary font-medium">
                            Назад
                        </button>
                        <span className="font-bold text-slate-200">Кого позвать?</span>
                        <div className="w-10" />
                    </div>

                    <div className="flex flex-col gap-3">
                        {friendsList.length === 0 ? (
                            <p className="text-slate-500 text-center py-10 text-sm">
                                Список друзей пуст
                            </p>
                        ) : (
                            friendsList.map((f) => (
                                <div
                                    key={f.tg_id}
                                    className="flex items-center justify-between p-4 bg-slate-900/40 border border-slate-900/60 rounded-xl"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center text-sm font-bold">
                                            {f.first_name.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="font-semibold text-slate-200 text-sm">{f.first_name}</span>
                                    </div>

                                    <button
                                        onClick={() => handleSendGroupInvite(f.tg_id)}
                                        className="bg-primary hover:bg-primary-hover text-white font-semibold py-2 px-4 rounded-lg text-xs transition"
                                    >
                                        Позвать
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }

        @keyframes slide-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }

        @keyframes highlight-msg {
          0% { background-color: rgba(10, 132, 255, 0.4); }
          100% { background-color: transparent; }
        }
        .highlight-animation {
          animation: highlight-msg 1.5s ease-out;
        }
      `}</style>
        </div>
    );
}
