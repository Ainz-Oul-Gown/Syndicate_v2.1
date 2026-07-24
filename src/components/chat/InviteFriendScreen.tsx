import { UserPlus } from 'lucide-react';
import { User } from '../../types';

export interface InviteFriendScreenProps {
  friendsList: User[];
  onBack: () => void;
  onInvite: (friendId: number) => void;
}

export default function InviteFriendScreen({ friendsList, onBack, onInvite }: InviteFriendScreenProps) {
  return (
    <div className="fixed inset-0 z-[1000] bg-slate-950 p-6 overflow-y-auto flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <button onClick={onBack} className="text-primary font-medium">Назад</button>
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
                onClick={() => onInvite(f.tg_id)}
                className="bg-primary hover:bg-primary-hover text-white font-semibold py-2 px-4 rounded-lg text-xs transition"
              >
                Позвать
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

