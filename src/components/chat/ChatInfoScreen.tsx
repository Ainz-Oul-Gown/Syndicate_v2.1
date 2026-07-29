import { UserPlus, Edit2, Trash, LogOut, UserMinus, Pin, History, Loader2 } from 'lucide-react';
import { Chat, DecryptedMessage } from '../../types';

export interface ChatInfoScreenProps {
  chat: Chat;
  isGroup: boolean;
  groupName: string;
  groupMembers: any[];
  chatFingerprint: string;
  sortedPinnedMessages: DecryptedMessage[];
  currentUser: { id: number; first_name: string };
  onClose: () => void;
  onEditGroupName: () => void;
  onLeaveGroup: () => void;
  onDeleteGroup: () => void;
  onRemoveFriend: () => void;
  onShowNameHistory: () => void;
  onOpenInvite: () => void;
  onScrollToMessage: (id: string) => void;
}

export default function ChatInfoScreen({
  chat,
  isGroup,
  groupName,
  groupMembers,
  chatFingerprint,
  sortedPinnedMessages,
  currentUser,
  onClose,
  onEditGroupName,
  onLeaveGroup,
  onDeleteGroup,
  onRemoveFriend,
  onShowNameHistory,
  onOpenInvite,
  onScrollToMessage,
}: ChatInfoScreenProps) {
  return (
    <div className="fixed inset-0 z-[1000] bg-slate-950 px-5 pb-5 pt-[calc(1.25rem+var(--sat,0px))] flex flex-col font-sans animate-fade-in">
      <div className="max-w-md mx-auto w-full flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between pb-4 border-b border-slate-900 mb-8 shrink-0">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 bg-slate-900/50 border border-slate-900 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer">
            Закрыть
          </button>
          <span className="font-extrabold font-mono tracking-wider text-slate-300 text-xs uppercase">
            {isGroup ? 'Инфо Группы' : 'Профиль'}
          </span>
          <div className="w-16" />
        </div>

        <div className="flex flex-col items-center mb-4 relative flex-shrink-0">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-800 flex items-center justify-center text-4xl font-bold font-mono text-primary shadow-xl shadow-black/50 mb-4 z-10">
            {(isGroup ? groupName : chat.name).charAt(0).toUpperCase()}
          </div>

          <div className="flex items-center justify-center gap-2 mb-1.5 z-10 w-full px-4">
            <h2 className="text-2xl font-black text-slate-100 tracking-tight truncate text-center">
              {isGroup ? groupName : chat.name}
            </h2>
            {isGroup && chat.created_by === currentUser.id && (
              <button onClick={onEditGroupName} className="text-slate-500 hover:text-primary transition-colors flex-shrink-0" title="Изменить имя">
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
          <div className="flex flex-col gap-3 flex-grow z-10 overflow-hidden">
            <button
              onClick={onOpenInvite}
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

            <div className="flex flex-col gap-2 mt-auto pt-2 flex-shrink-0">
              <button
                onClick={onLeaveGroup}
                className="w-full bg-slate-900/50 hover:bg-slate-800 text-rose-400 font-bold font-mono tracking-wide py-3.5 rounded-2xl flex items-center justify-center gap-2 transition border border-rose-500/20"
              >
                <LogOut className="w-4 h-4" /> ВЫЙТИ ИЗ ГРУППЫ
              </button>
              {chat.created_by === currentUser.id && (
                <button
                  onClick={onDeleteGroup}
                  className="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 font-bold font-mono tracking-wide py-3.5 rounded-2xl flex items-center justify-center gap-2 transition border border-rose-500/30"
                >
                  <Trash className="w-4 h-4" /> УДАЛИТЬ ДЛЯ ВСЕХ
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 mt-auto pt-2 z-10 flex-shrink-0">
            {sortedPinnedMessages.length > 0 && (
              <div className="bg-slate-900/30 border border-primary/15 p-3 rounded-2xl mb-1">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[10px] font-bold text-primary/70 font-mono uppercase tracking-widest flex items-center gap-1.5">
                    <Pin className="w-3.5 h-3.5 fill-primary" /> Закреплённые
                  </h4>
                  <span className="text-[10px] font-bold text-primary font-mono bg-primary/10 px-2 py-0.5 rounded-md">
                    {sortedPinnedMessages.length}
                  </span>
                </div>
                <div className="space-y-1.5 max-h-[25vh] overflow-y-auto pr-1">
                  {sortedPinnedMessages.map((msg) => {
                    const msgDate = new Date(msg.created_at);
                    const dateStr = msgDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                    return (
                      <div
                        key={msg.id}
                        onClick={() => {
                          onScrollToMessage(msg.id);
                          onClose();
                        }}
                        className="flex flex-col gap-1 p-2.5 bg-slate-950/50 border border-slate-900 rounded-xl cursor-pointer hover:bg-primary/5 active:scale-[0.98] transition-all"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold text-primary/60 font-mono uppercase">
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
              onClick={onShowNameHistory}
              className="w-full bg-slate-900/50 hover:bg-slate-900 text-slate-300 font-bold font-mono tracking-wide py-4 rounded-2xl flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] border border-slate-800/80"
            >
              <History className="w-5 h-5 text-primary" /> ИСТОРИЯ ИМЁН
            </button>
            <button
              onClick={onRemoveFriend}
              className="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 font-bold font-mono tracking-wide py-3.5 rounded-2xl flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] border border-rose-500/20"
            >
              <UserMinus className="w-4.5 h-4.5" /> УДАЛИТЬ КОНТАКТ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

