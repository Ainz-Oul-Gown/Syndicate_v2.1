import { hapticImpact } from "../lib/haptics";
import { useState, useEffect, useRef, FormEvent, UIEvent, TouchEvent, MouseEvent } from 'react';
import { ChevronLeft } from 'lucide-react';
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
import DeepSearch from './DeepSearch';
import { getCachedEmbeddingPipeline } from '../lib/ai';
import { isOnline, NETWORK_STATE_EVENT, type NetworkStateDetail } from '../lib/network';
import { notify } from '../lib/notifications';
import ChatHeader from './chat/ChatHeader';
import ChatPinnedBanner from './chat/ChatPinnedBanner';
import MessageList from './chat/MessageList';
import MessageComposer from './chat/MessageComposer';
import ChatInfoScreen from './chat/ChatInfoScreen';
import NameHistoryModal from './chat/NameHistoryModal';
import DebtsPanel from './chat/DebtsPanel';
import AddDebtScreen from './chat/AddDebtScreen';
import InviteFriendScreen from './chat/InviteFriendScreen';

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

    const pinnedMessagesStorageKey = `synd_pinned_messages_${currentUser.id}_${chat.id}`;

    // Sorted pinned messages: newest first (like Telegram pinned banner)
    const sortedPinnedMessages = (() => {
        const pinned = messages.filter((m) => pinnedMessageIds.has(m.id));
        pinned.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return pinned;
    })();

    // Current pinned message shown in banner (clamped safely)
    const currentPinnedForBanner = sortedPinnedMessages.length > 0
        ? sortedPinnedMessages[Math.min(pinnedBannerIdx, sortedPinnedMessages.length - 1)]
        : null;

    // Reset banner index when pinned set changes (by IDs, not just size)
    useEffect(() => {
        setPinnedBannerIdx(0);
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

    // Banner click: scroll to current pinned, then advance (newest→oldest)
    const handlePinnedBannerClick = () => {
        if (sortedPinnedMessages.length === 0) return;
        hapticImpact('light');
        const target = sortedPinnedMessages[pinnedBannerIdx];
        if (target) handleScrollToMessage(target.id);
        // Advance toward older messages (wrap around)
        setPinnedBannerIdx((prev) => (prev + 1) % sortedPinnedMessages.length);
    };

    // Reply states
    const [replyTo, setReplyTo] = useState<ReplyData | null>(null);
    const legacyVoiceMigrationRef = useRef<Set<string>>(new Set());

    // Swipe gesture tracking
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const swipingMsgId = useRef<string | null>(null);
    const [swipeOffset, setSwipeOffset] = useState<number>(0);

    // Ref to track recording gesture independently of async state
    const recordingGestureActive = useRef(false);

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

        let deliveryStatus: DecryptedMessage['deliveryStatus'];
        if (isMine) {
            deliveryStatus = msg.read_at ? 'read' : 'sent';
        }

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
            deliveryStatus,
        };
    };

    // Mark all incoming messages in this chat as read (server-side).
    const markMessagesRead = async () => {
        try {
            await supabaseClient.rpc('mark_messages_read', { p_chat_id: chat.id });
        } catch (e) {
            console.warn('mark_messages_read failed', e);
        }
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
                .select('id, chat_id, sender_id, encrypted_text, encrypted_vector, created_at, read_at')
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
                .select('id, chat_id, sender_id, encrypted_text, encrypted_vector, created_at, read_at')
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

            // Mark incoming messages as read on the server.
            // The resulting UPDATE events will be picked up by the Realtime
            // subscription below, so senders will see double-checkmarks.
            void markMessagesRead();

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
                .select('id, chat_id, sender_id, encrypted_text, encrypted_vector, created_at, read_at')
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
        // Smart scroll-based pinned trigger: when a pinned message crosses 5px above center
        if (sortedPinnedMessages.length > 1) {
            const areaRect = area.getBoundingClientRect();
            const triggerY = areaRect.top + areaRect.height / 2 - 5; // 5px above center
            for (let i = 0; i < sortedPinnedMessages.length; i++) {
                const el = document.getElementById(`msg-${sortedPinnedMessages[i].id}`);
                if (!el) continue;
                const elRect = el.getBoundingClientRect();
                // This pinned message just crossed above the trigger line
                if (elRect.top < triggerY && elRect.bottom > areaRect.top) {
                    // Show the NEXT pinned message (or wrap to first if at the end)
                    const nextIdx = (i + 1) % sortedPinnedMessages.length;
                    setPinnedBannerIdx(nextIdx);
                    break;
                }
            }
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

        // Mark gesture active synchronously (before any async work)
        recordingGestureActive.current = true;

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
                .select('id, chat_id, sender_id, encrypted_text, encrypted_vector, created_at, read_at')
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
        recordingGestureActive.current = false;
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
        recordingGestureActive.current = false;
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

    const togglePreviewPlay = () => {
        if (!previewAudioRef.current) return;
        if (isRecordPlaying) {
            previewAudioRef.current.pause();
            setIsRecordPlaying(false);
        } else {
            previewAudioRef.current.play();
            setIsRecordPlaying(true);
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
        if (!recordingGestureActive.current || isRecordLocked) return;
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
            <ChatHeader
                chat={chat}
                chatFingerprint={chatFingerprint}
                groupName={groupName}
                isGroup={isGroup}
                onBack={onBack}
                onOpenInfo={() => setActiveModal('info')}
                onOpenSearch={() => setActiveModal('search')}
                onOpenDebts={() => setActiveModal('debts')}
            />
            {currentPinnedForBanner && (
                <ChatPinnedBanner
                    message={currentPinnedForBanner}
                    index={pinnedBannerIdx}
                    total={sortedPinnedMessages.length}
                    onClick={handlePinnedBannerClick}
                />
            )}

            <MessageList
                messages={messages}
                isLoadingChat={isLoadingChat}
                hasMoreInHistory={hasMoreInHistory}
                isLoadingOlder={isLoadingOlder}
                renderLimit={renderLimit}
                showScrollBottom={showScrollBottom}
                isGroup={isGroup}
                chatKey={chatKey}
                getSenderName={getSenderName}
                pinnedMessageIds={pinnedMessageIds}
                activeMessageMenu={activeMessageMenu}
                menuOpenUp={menuOpenUp}
                swipeOffset={swipeOffset}
                swipingMsgId={swipingMsgId.current}
                onLoadOlder={loadOlderMessages}
                onScrollToBottom={handleScrollToBottom}
                onTogglePin={toggleMessagePin}
                onDelete={handleDeleteMessage}
                onReply={(msg) => setReplyTo({ id: msg.id, name: msg.name, text: msg.text })}
                onScrollToMessage={handleScrollToMessage}
                onMenuStateChange={setActiveMessageMenu}
                onMenuDirectionChange={setMenuOpenUp}
                onSwipeStart={(msgId) => {
                    swipingMsgId.current = msgId;
                    setSwipeOffset(0);
                }}
                onSwipeMove={(msgId, deltaX) => {
                    if (swipingMsgId.current !== msgId) return;
                    if (deltaX < 0) {
                        setSwipeOffset(Math.max(deltaX, -80));
                        if (Math.abs(deltaX) > 50) {
                            swipingMsgId.current = null;
                            setSwipeOffset(0);
                        }
                    } else {
                        setSwipeOffset(0);
                    }
                }}
                onManualTranscribe={handleManualTranscribe}
                onRetry={retryMessage}
                isRetryingFailed={isRetryingFailed}
                online={online}
                messagesAreaRef={messagesAreaRef}
                onScroll={handleScroll}
            />

            <MessageComposer
                inputText={inputText}
                onInputChange={handleInputChange}
                onSend={handleSendMessage}
                replyTo={replyTo}
                onClearReply={() => setReplyTo(null)}
                isRecording={isRecording}
                recordingDuration={recordingDuration}
                isRecordLocked={isRecordLocked}
                isRecordPaused={isRecordPaused}
                recordPreviewUrl={recordPreviewUrl}
                isRecordPlaying={isRecordPlaying}
                recordPreviewProgress={recordPreviewProgress}
                recordWaveHistory={recordWaveHistory}
                micPulseScale={micPulseScale}
                onStartRecording={startRecording}
                onStopRecording={stopRecordingAndSend}
                onForceStop={forceStopRecordingAndSend}
                onPauseRecording={pauseRecording}
                onResumeRecording={resumeRecording}
                onCancelRecording={cancelRecording}
                onPlayPreview={togglePreviewPlay}
                onMicTouchMove={handleMicTouchMove}
                failedMessageCount={failedMessageCount}
                isRetryingFailed={isRetryingFailed}
                online={online}
                onRetryAll={retryAllFailedMessages}
                inputRef={inputRef}
            />

            {activeModal === 'info' && (
                <ChatInfoScreen
                    chat={chat}
                    isGroup={isGroup}
                    groupName={groupName}
                    groupMembers={groupMembers}
                    chatFingerprint={chatFingerprint}
                    sortedPinnedMessages={sortedPinnedMessages}
                    currentUser={currentUser}
                    onClose={() => setActiveModal('none')}
                    onEditGroupName={handleEditGroupName}
                    onLeaveGroup={handleLeaveGroup}
                    onDeleteGroup={handleDeleteGroupForEveryone}
                    onRemoveFriend={handleRemoveFriendship}
                    onShowNameHistory={() => { handleShowNameHistory(); }}
                    onOpenInvite={() => setActiveModal('invite-friend')}
                    onScrollToMessage={handleScrollToMessage}
                />
            )}

            {/* Name History Dialog Overlay */}
            {showHistoryModal && (
                <NameHistoryModal
                    show={showHistoryModal}
                    historyNames={historyNames}
                    historyLoading={historyLoading}
                    historyEstablishedDate={historyEstablishedDate}
                    onClose={() => setShowHistoryModal(false)}
                />
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
                <DebtsPanel
                    debts={debts}
                    currentUser={currentUser}
                    onClose={() => setActiveModal('none')}
                    onAddDebt={() => setActiveModal('add-debt')}
                    onDebtAction={handleDebtAction}
                />
            )}

            {/* Add Debt view screen */}
            {activeModal === 'add-debt' && (
                <AddDebtScreen
                    debtRubles={debtRubles}
                    onDebtRublesChange={setDebtRubles}
                    currencies={currencies}
                    selectedCurrency={selectedCurrency}
                    onCurrencyChange={setSelectedCurrency}
                    onBack={() => setActiveModal('debts')}
                    onSave={handleSaveDebt}
                />
            )}

            {/* Invite friends list selection screen */}
            {activeModal === 'invite-friend' && (
                <InviteFriendScreen
                    friendsList={friendsList}
                    onBack={() => setActiveModal('info')}
                    onInvite={handleSendGroupInvite}
                />
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
