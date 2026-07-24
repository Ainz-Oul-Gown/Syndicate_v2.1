import { HelpCircle, Plus } from 'lucide-react';
import { Debt } from '../../types';

export interface DebtsPanelProps {
  debts: Debt[];
  currentUser: { id: number; first_name: string };
  onClose: () => void;
  onAddDebt: () => void;
  onDebtAction: (debt: Debt, action: 'request' | 'accept' | 'reject' | 'forgive' | 'cancel') => void;
}

export default function DebtsPanel({ debts, currentUser, onClose, onAddDebt, onDebtAction }: DebtsPanelProps) {
  return (
    <div className="fixed inset-0 z-[1000] bg-slate-950 p-6 overflow-y-auto flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <button onClick={onClose} className="text-primary font-medium">Закрыть</button>
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
                <div key={d.id} className={'flex flex-col gap-3 ' + (idx > 0 ? 'pt-4' : '')}>
                  <div className="flex justify-between items-center gap-3">
                    <div className="flex flex-col">
                      <span className={'font-bold text-lg ' + (amIDebtor ? 'text-rose-500' : 'text-emerald-500')}>
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
                      <button onClick={() => onDebtAction(d, 'request')} className="bg-primary/10 border border-primary/20 text-primary font-semibold py-2 px-3 rounded-lg text-sm transition">
                        Я оплатил
                      </button>
                    )}
                    {amICreditor && pending && (
                      <>
                        <button onClick={() => onDebtAction(d, 'accept')} className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold py-2 px-3 rounded-lg text-sm transition">
                          Подтвердить
                        </button>
                        <button onClick={() => onDebtAction(d, 'reject')} className="bg-rose-500/10 border border-rose-500/20 text-rose-400 font-semibold py-2 px-3 rounded-lg text-sm transition">
                          Не получено
                        </button>
                      </>
                    )}
                    {amICreditor && (
                      <button onClick={() => onDebtAction(d, 'forgive')} className="bg-slate-900 border border-slate-800 text-slate-300 font-semibold py-2 px-3 rounded-lg text-sm transition">
                        Простить
                      </button>
                    )}
                    {d.created_by === currentUser.id && d.status === 'active' && (
                      <button onClick={() => onDebtAction(d, 'cancel')} className="bg-slate-900 border border-slate-800 text-slate-500 hover:text-slate-300 font-semibold py-2 px-3 rounded-lg text-sm transition">
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

      <button onClick={onAddDebt} className="w-full bg-primary hover:bg-primary-hover text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-1.5 mt-auto transition">
        <Plus className="w-5 h-5" /> Оформить долг
      </button>
    </div>
  );
}

