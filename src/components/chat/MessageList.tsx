import { UIEvent, useRef } from 'react';
import type { RefObject } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';
import { DecryptedMessage } from '../../types';
import MessageBubble from './MessageBubble';

export interface MessageListProps {
  messages: DecryptedMessage[];
  isLoadingChat: boolean;
  hasMoreInHistory: boolean;
  isLoadingOlder: boolean;
  renderLimit: number;
  showScrollBottom: boolean;
  isGroup: boolean;
  chatKey: CryptoKey | null;
  getSenderName: (senderId: number) => string;
  pinnedMessageIds: Set<string>;
  activeMessageMenu: string | null;
  menuOpenUp: boolean;
  swipeOffset: number;
  swipingMsgId: string | null;
  onLoadOlder: () => void;
  onScrollToBottom: () => void;
  onTogglePin: (id: string) => void;
  onDelete: (msg: DecryptedMessage) => void;
  onReply: (msg: { id: string; name: string; text: string }) => void;
  onScrollToMessage: (id: string) => void;
  onMenuStateChange: (id: string | null) => void;
  onMenuDirectionChange: (up: boolean) => void;
  onManualTranscribe: (fileName: string, msgId: string) => Promise<void>;
  onRetry: (msg: DecryptedMessage) => void;
  isRetryingFailed: boolean;
  online: boolean;
  messagesAreaRef: RefObject<HTMLDivElement | null>;
  onScroll: (e: UIEvent<HTMLDivElement>) => void;
}

export default function MessageList({
  messages,
  isLoadingChat,
  hasMoreInHistory,
  isLoadingOlder,
  renderLimit,
  showScrollBottom,
  isGroup,
  chatKey,
  getSenderName,
  pinnedMessageIds,
  activeMessageMenu,
  menuOpenUp,
  swipeOffset,
  swipingMsgId,
  onLoadOlder,
  onScrollToBottom,
  onTogglePin,
  onDelete,
  onReply,
  onScrollToMessage,
  onMenuStateChange,
  onMenuDirectionChange,
  onManualTranscribe,
  onRetry,
  isRetryingFailed,
  online,
  messagesAreaRef,
  onScroll,
}: MessageListProps) {
  return (
    <div className="chat-container flex-grow overflow-hidden relative">
      <div
        ref={messagesAreaRef}
        onScroll={onScroll}
        onClick={() => onMenuStateChange(null)}
        className="messages-area h-full overflow-y-auto p-4 flex flex-col-reverse gap-3.5 select-text"
      >
        {isLoadingChat ? (
          <div className="flex flex-col gap-4 opacity-50 pointer-events-none w-full">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={'flex w-full ' + (i % 2 === 0 ? 'justify-end' : 'justify-start')}>
                <div className={'w-2/3 h-16 rounded-2xl animate-pulse ' + (i % 2 === 0 ? 'bg-primary/20' : 'bg-slate-800')} />
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
                const isSwiping = swipingMsgId === m.id;
                return (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    isGroup={isGroup}
                    getSenderName={getSenderName}
                    pinnedMessageIds={pinnedMessageIds}
                    activeMessageMenu={activeMessageMenu}
                    menuOpenUp={menuOpenUp}
                    swipeOffset={swipeOffset}
                    isSwiping={isSwiping}
                    onTogglePin={onTogglePin}
                    onDelete={onDelete}
                    onReply={onReply}
                    onScrollToMessage={onScrollToMessage}
                    onMenuStateChange={onMenuStateChange}
                    onMenuDirectionChange={onMenuDirectionChange}
                    chatKey={chatKey}
                    onManualTranscribe={onManualTranscribe}
                    onRetry={onRetry}
                    isRetryingFailed={isRetryingFailed}
                    online={online}
                  />
                );
              })}
            {hasMoreInHistory && renderLimit >= messages.length && (
              <button
                type="button"
                onClick={() => onLoadOlder()}
                disabled={isLoadingOlder}
                className="self-center mt-2 px-4 py-2 rounded-full border border-slate-700 bg-slate-900/90 text-xs text-slate-300 hover:text-white disabled:opacity-60"
              >
                {isLoadingOlder ? 'Загрузка истории…' : 'Загрузить более старые сообщения'}
              </button>
            )}
          </>
        )}
      </div>

      <button
        onClick={onScrollToBottom}
        className={'absolute right-4 bottom-5 w-11 h-11 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-200 shadow-xl transition-all duration-300 focus:outline-none z-40 transform ' + (showScrollBottom ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-75 pointer-events-none')}
      >
        <ArrowDown className="w-5 h-5 animate-bounce" />
      </button>
    </div>
  );
}

