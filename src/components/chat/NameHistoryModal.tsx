import { Loader2, History, Calendar, AlertTriangle } from 'lucide-react';

export interface NameHistoryModalProps {
  show: boolean;
  historyNames: Array<{ name: string; changed_at: number }>;
  historyLoading: boolean;
  historyEstablishedDate: string;
  onClose: () => void;
}

export default function NameHistoryModal({ show, historyNames, historyLoading, historyEstablishedDate, onClose }: NameHistoryModalProps) {
  if (!show) return null;

  return (
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
          onClick={() => { onClose(); }}
          className="w-full bg-primary hover:bg-primary-hover text-white font-bold font-mono py-3 rounded-2xl transition mt-2"
        >
          ПОНЯТНО
        </button>
      </div>
    </div>
  );
}

