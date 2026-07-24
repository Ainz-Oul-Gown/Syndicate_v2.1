import { ChevronLeft, Search, Wallet } from 'lucide-react';
import { Chat } from '../../types';

export interface ChatHeaderProps {
  chat: Chat;
  chatFingerprint: string;
  groupName: string;
  isGroup: boolean;
  onBack: () => void;
  onOpenInfo: () => void;
  onOpenSearch: () => void;
  onOpenDebts: () => void;
}

export default function ChatHeader({ chat, chatFingerprint, groupName, isGroup, onBack, onOpenInfo, onOpenSearch, onOpenDebts }: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-slate-900 pb-3 p-4 bg-slate-900/40 relative z-10 flex-shrink-0">
      <button onClick={onBack} className="text-primary hover:text-primary-hover font-medium flex items-center focus:outline-none">
        <ChevronLeft className="w-6 h-6" />
      </button>
      <div onClick={onOpenInfo} className="flex flex-col items-center justify-center text-center cursor-pointer flex-grow mx-4 overflow-hidden">
        <span className="font-semibold text-slate-200 text-base truncate max-w-full">
          {isGroup ? groupName : chat.name}
        </span>
        <span className="text-xs text-emerald-500 font-mono truncate max-w-full">
          {chatFingerprint}
        </span>
      </div>
      <div className="flex gap-2.5">
        {chat.type === 'private' && (
          <button onClick={onOpenDebts} className="w-9 h-9 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-primary hover:text-primary-hover active:scale-95 transition focus:outline-none">
            <Wallet className="w-4.5 h-4.5" />
          </button>
        )}
        <button onClick={onOpenSearch} className="w-9 h-9 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-primary hover:text-primary-hover active:scale-95 transition focus:outline-none">
          <Search className="w-4.5 h-4.5" />
        </button>
      </div>
    </div>
  );
}

