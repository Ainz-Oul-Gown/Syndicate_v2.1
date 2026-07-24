import { useRef, useEffect } from 'react';
import {
  Pin,
  PinOff,
  Reply,
  Trash,
  Shield,
  Play,
  Pause,
  Loader2,
  Check,
  CheckCheck,
  Mic,
  UserPlus,
} from 'lucide-react';
import VoicePlayer from '../VoicePlayer';
import { DecryptedMessage, ReplyData } from '../../types';

export interface MessageBubbleProps {
  message: DecryptedMessage;
  isGroup: boolean;
  getSenderName: (senderId: number) => string;
  pinnedMessageIds: Set<string>;
  activeMessageMenu: string | null;
  menuOpenUp: boolean;
  swipeOffset: number;
  isSwiping: boolean;
  onTogglePin: (id: string) => void;
  onDelete: (msg: DecryptedMessage) => void;
  onReply: (msg: { id: string; name: string; text: string }) => void;
  onScrollToMessage: (id: string) => void;
  onMenuStateChange: (id: string | null) => void;
  onMenuDirectionChange: (up: boolean) => void;
  chatKey: CryptoKey | null;
  onManualTranscribe: (fileName: string, msgId: string) => Promise<void>;
  onRetry: (msg: DecryptedMessage) => void;
  isRetryingFailed: boolean;
  online: boolean;
  key?: string | number;
}

export default function MessageBubble({
  message,
  isGroup,
  getSenderName,
  pinnedMessageIds,
  activeMessageMenu,
  menuOpenUp,
  swipeOffset,
  isSwiping,
  onTogglePin,
  onDelete,
  onReply,
  onScrollToMessage,
  onMenuStateChange,
  onMenuDirectionChange,
  chatKey,
  onManualTranscribe,
  onRetry,
  isRetryingFailed,
  online,
}: MessageBubbleProps) {
  const msgDate = new Date(message.created_at);
  const timeStr = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = document.getElementById('msg-' + message.id);
    if (!el || activeMessageMenu !== message.id) return;
    const rect = el.getBoundingClientRect();
    const areaEl = el.parentElement;
    if (!areaEl) return;
    const areaRect = areaEl.getBoundingClientRect();
    const distFromBottom = areaRect.bottom - rect.bottom;
    onMenuDirectionChange(distFromBottom < 120);
  }, [activeMessageMenu, message.id, onMenuDirectionChange]);

  return (
    <div
      id={'msg-' + message.id}
      onTouchStart={(e) => {
        const touch = e.touches[0];
        (bubbleRef.current as any).__touchStartX = touch.clientX;
        (bubbleRef.current as any).__touchStartY = touch.clientY;
        (bubbleRef.current as any).__swipingMsgId = message.id;
      }}
      onTouchMove={(e) => {
        const touch = e.touches[0];
        const startX = (bubbleRef.current as any).__touchStartX ?? touch.clientX;
        const startY = (bubbleRef.current as any).__touchStartY ?? touch.clientY;
        const deltaX = touch.clientX - startX;
        const deltaY = touch.clientY - startY;
        if (deltaX < 0 && Math.abs(deltaX) > Math.abs(deltaY)) {
          if (Math.abs(deltaX) > 50) {
            let cleanText = message.text;
            if (cleanText.startsWith('[VOICE]:')) cleanText = '🎤 Голосовое сообщение';
            if (cleanText.startsWith('[GROUP_INVITE]:')) cleanText = '🎫 Приглашение в группу';
            onReply({ id: message.id, name: message.isMine ? 'Я' : getSenderName(message.sender_id), text: cleanText } as ReplyData);
            (bubbleRef.current as any).__swipingMsgId = null;
          }
        }
      }}
      onTouchEnd={() => {
        (bubbleRef.current as any).__swipingMsgId = null;
      }}
      className={'flex w-full relative ' + (message.isMine ? 'justify-end' : 'justify-start')}
    >
      <div
        ref={bubbleRef}
        style={{
          transform: isSwiping ? 'translateX(' + swipeOffset + 'px)' : 'translateX(0px)',
          transition: isSwiping ? 'none' : 'transform 0.2s ease-out',
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (activeMessageMenu === message.id) {
            onMenuStateChange(null);
          } else {
            const msgEl = e.currentTarget as HTMLElement;
            const areaEl = msgEl.parentElement;
            if (areaEl) {
              const areaRect = areaEl.getBoundingClientRect();
              const msgRect = msgEl.getBoundingClientRect();
              const distFromBottom = areaRect.bottom - msgRect.bottom;
              onMenuDirectionChange(distFromBottom < 120);
            } else {
              onMenuDirectionChange(false);
            }
            onMenuStateChange(message.id);
          }
        }}
        className={'msg-bubble flex flex-col px-4 py-3 relative max-w-[85%] break-words overflow-hidden ' + (message.isMine
          ? 'msg-mine bg-primary text-white rounded-[18px] rounded-br-[4px] shadow-md shadow-primary/10'
          : 'msg-other bg-slate-900 border border-slate-850 text-slate-100 rounded-[18px] rounded-bl-[4px]'
        )}
      >
        {pinnedMessageIds.has(message.id) && (
          <div className={'mb-1 flex items-center gap-1 text-[10px] font-semibold ' + (message.isMine ? 'text-white/70' : 'text-primary')}>
            <Pin className="w-3 h-3 fill-current" /> Закреплено
          </div>
        )}

        {isGroup && !message.isMine && (
          <div className="sender-name text-xs font-bold text-primary mb-1">
            {getSenderName(message.sender_id)}
          </div>
        )}

        {message.reply && (
          <div
            onClick={() => onScrollToMessage(message.reply!.id)}
            className={'msg-reply-block cursor-pointer border-l-2 p-1.5 rounded mb-2.5 text-xs ' + (message.isMine
              ? 'bg-white/10 border-white text-white/95'
              : 'bg-black/10 border-primary text-slate-300'
            )}
          >
            <div className="font-bold mb-0.5">{message.reply.name}</div>
            <div className="truncate">{message.reply.text}</div>
          </div>
        )}

        {message.voiceData ? (
          <VoicePlayer
            fileName={message.voiceData.fileName}
            waveformString={message.voiceData.waveform.join(',')}
            aesKey={chatKey}
            transcription={message.voiceData.transcription}
            isProcessing={message.voiceData.isProcessing}
            isError={message.voiceData.isError}
            hasTranscript={message.voiceData.hasTranscript}
            msgId={message.id}
            onTranscribe={onManualTranscribe}
            isMine={message.isMine}
            localUrl={message.voiceData.localUrl}
          />
        ) : message.inviteData ? (
          <div className="flex flex-col gap-3 p-2 bg-black/15 rounded-xl border border-white/5">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              Приглашение в группу
            </span>
            <span className="font-bold text-base text-slate-100">{message.inviteData.groupName}</span>
            {!message.isMine && (
              <button
                onClick={() => onScrollToMessage(message.id)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition"
              >
                Вступить в группу
              </button>
            )}
          </div>
        ) : message.isError ? (
          <span className="text-rose-300 flex items-center gap-1.5 italic text-sm">
            <Shield className="w-4 h-4 text-rose-500 flex-shrink-0" /> {message.text}
          </span>
        ) : !message.isAuthentic ? (
          <span className="text-rose-300 flex items-center gap-1.5 italic text-sm font-semibold">
            <Shield className="w-4 h-4 text-rose-500 flex-shrink-0 animate-bounce" /> [ОТКЛОНЕНО: Подпись подделана!]
          </span>
        ) : (
          <div className="whitespace-pre-wrap select-text text-sm leading-relaxed">{message.text}</div>
        )}

        <span
          className={'text-[10px] text-right mt-1 w-full block tracking-wide select-none ' + (message.isMine ? 'text-white/60' : 'text-slate-500')}
        >
          <span>{timeStr}</span>
          {message.deliveryStatus === 'sending' && <span> · отправка…</span>}
          {message.deliveryStatus === 'failed' && <span> · не отправлено</span>}
          {message.isMine && message.deliveryStatus === 'read' && (
            <span
              className="inline-flex items-center ml-1 align-[-2px] text-emerald-400"
              title="Прочитано"
              aria-label="Сообщение прочитано"
            >
              <CheckCheck className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" />
            </span>
          )}
          {message.isMine && message.deliveryStatus === 'sent' && (
            <span
              className="inline-flex items-center ml-1 align-[-2px] text-sky-300"
              title="Принято сервером"
              aria-label="Сообщение принято сервером"
            >
              <Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" />
            </span>
          )}
        </span>
        {message.deliveryStatus === 'failed' && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRetry(message); }}
            disabled={isRetryingFailed || !online}
            className="mt-1 self-end text-[11px] font-semibold text-rose-200 underline underline-offset-2 disabled:opacity-50 disabled:no-underline"
          >
            Повторить
          </button>
        )}

        {activeMessageMenu === message.id && (
          <div className={'absolute ' + (menuOpenUp ? 'bottom-full mb-1' : 'top-full mt-1') + ' flex items-center gap-1 bg-slate-900 border border-slate-700 shadow-xl rounded-xl p-1 z-50 ' + (message.isMine ? 'right-0' : 'left-0')}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                let cleanText = message.text;
                if (cleanText.startsWith('[VOICE]:')) cleanText = '🎤 Голосовое сообщение';
                if (cleanText.startsWith('[GROUP_INVITE]:')) cleanText = '🎫 Приглашение в группу';
                onReply({ id: message.id, name: message.isMine ? 'Я' : getSenderName(message.sender_id), text: cleanText });
                onMenuStateChange(null);
              }}
              className="flex flex-col items-center justify-center gap-1 min-w-[70px] p-2 rounded-lg hover:bg-slate-800 transition"
            >
              <Reply className="w-5 h-5 text-slate-300" />
              <span className="text-[10px] font-semibold text-slate-400">Ответить</span>
            </button>

            {!message.id.startsWith('pending-') && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(message.id);
                  onMenuStateChange(null);
                }}
                className="flex flex-col items-center justify-center gap-1 min-w-[70px] p-2 rounded-lg hover:bg-slate-800 transition"
              >
                {pinnedMessageIds.has(message.id) ? (
                  <PinOff className="w-5 h-5 text-primary" />
                ) : (
                  <Pin className="w-5 h-5 text-slate-300" />
                )}
                <span className={'text-[10px] font-semibold ' + (pinnedMessageIds.has(message.id) ? 'text-primary' : 'text-slate-400')}>
                  {pinnedMessageIds.has(message.id) ? 'Открепить' : 'Закрепить'}
                </span>
              </button>
            )}

            {message.isMine && message.deliveryStatus !== 'sending' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(message);
                  onMenuStateChange(null);
                }}
                className="flex flex-col items-center justify-center gap-1 min-w-[70px] p-2 rounded-lg hover:bg-rose-900/40 hover:text-rose-400 transition group"
              >
                <Trash className="w-5 h-5 text-rose-400/80 group-hover:text-rose-400" />
                <span className="text-[10px] font-semibold text-rose-400/80 group-hover:text-rose-400">Удалить</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

