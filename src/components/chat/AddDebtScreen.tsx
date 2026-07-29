import { ArrowDown, Plus } from 'lucide-react';
import { Currency } from '../../types';

export interface AddDebtScreenProps {
  debtRubles: string;
  onDebtRublesChange: (value: string) => void;
  currencies: Currency[];
  selectedCurrency: Currency | null;
  onCurrencyChange: (currency: Currency) => void;
  onBack: () => void;
  onSave: () => void;
}

export default function AddDebtScreen({
  debtRubles,
  onDebtRublesChange,
  currencies,
  selectedCurrency,
  onCurrencyChange,
  onBack,
  onSave,
}: AddDebtScreenProps) {
  const rubles = parseFloat(debtRubles);
  const isValid = !isNaN(rubles) && rubles > 0;

  return (
        <div className="fixed inset-0 z-[1000] bg-slate-950 px-5 pb-[calc(1.25rem+var(--sab,0px))] pt-[calc(1.25rem+var(--sat,0px))] overflow-y-auto flex flex-col font-sans animate-fade-in">
      <div className="max-w-md mx-auto w-full flex flex-col h-full">
        <div className="flex items-center justify-between pb-4 border-b border-slate-900 mb-6 shrink-0">
          <button onClick={onBack} className="text-slate-400 hover:text-slate-200 bg-slate-900/50 border border-slate-900 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer">
            <ArrowDown className="w-4 h-4" /> Назад
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
                onChange={(e) => onDebtRublesChange(e.target.value)}
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
                  if (selected) onCurrencyChange(selected);
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

          {selectedCurrency && isValid ? (
            <div className="text-center py-5 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 my-1 relative overflow-hidden animate-fade-in">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500/5 to-transparent animate-shimmer" />
              <span className="text-[10px] text-emerald-500/70 font-bold font-mono tracking-widest uppercase">
                Итого к выплате
              </span>
              <div className="flex items-center justify-center gap-2 mt-1">
                <span className="text-3xl font-black text-emerald-400 font-mono tracking-tight">
                  {(rubles / selectedCurrency.rub_value).toFixed(2)}
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
            onClick={onSave}
            className="w-full bg-primary hover:bg-primary-hover active:bg-primary/90 text-white font-bold font-mono tracking-wide py-4 rounded-2xl flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] mt-2 shadow-lg shadow-primary/20"
          >
            ЗАФИКСИРОВАТЬ
          </button>
        </div>
      </div>
    </div>
  );
}

