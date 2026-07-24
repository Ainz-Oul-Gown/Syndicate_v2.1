import { Pin } from 'lucide-react';
import { DecryptedMessage } from '../../types';

export interface ChatPinnedBannerProps {
  message: DecryptedMessage;
  index: number;
  total: number;
  onClick: () => void;
}

export default function ChatPinnedBanner({ message, index, total, onClick }: ChatPinnedBannerProps) {
  return (
    <div
      onClick={onClick}
      className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-primary/8 border-b border-primary/20 cursor-pointer hover:bg-primary/12 active:bg-primary/15 transition-all"
    >
      <Pin className="w-3.5 h-3.5 text-primary fill-primary shrink-0" />
      <span className="text-xs text-primary/80 truncate flex-1 font-medium">
        {message.text || '🔗 Голосовое сообщение / вложение'}
      </span>
      {total > 1 && (
        <span className="text-[10px] text-primary/50 font-mono shrink-0">
          {index + 1}/{total}
        </span>
      )}
    </div>
  );
}

