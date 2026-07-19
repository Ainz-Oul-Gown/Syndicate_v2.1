import { hapticImpact } from "../lib/haptics";
import React, { useState, useEffect, FormEvent } from 'react';
import { supabaseClient } from '../lib/supabase';
import { Currency } from '../types';
import { ChevronLeft, Plus, Trash2, Coins, Loader2, DollarSign, Wallet, ArrowRightLeft } from 'lucide-react';

interface CurrenciesScreenProps {
  userId: number;
  onBack: () => void;
}

export default function CurrenciesScreen({ userId, onBack }: CurrenciesScreenProps) {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchCurrencies = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabaseClient
        .from('currencies')
        .select('id, owner_id, name, rub_value')
        .eq('owner_id', userId);

      if (error) throw error;
      setCurrencies(data || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrencies();
  }, [userId]);

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setFeedbackMsg({ type, text });
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const handleAddCurrency = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !price || parseFloat(price) <= 0) {
      showFeedback('error', 'Заполните все поля корректно!');
      hapticImpact("error");
      return;
    }

    setSubmitLoading(true);
    try {
      const { error } = await supabaseClient.from('currencies').insert({
        owner_id: userId,
        name: name.trim(),
        rub_value: parseFloat(price),
      });

      if (error) throw error;

      setName('');
      setPrice('');
      fetchCurrencies();
      showFeedback('success', 'Валюта успешно добавлена!');
      hapticImpact("success");
    } catch (err: any) {
      showFeedback('error', 'Ошибка добавления: ' + err.message);
      hapticImpact("error");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDeleteCurrency = async (id: string) => {
    hapticImpact("selection");
    try {
      const { error } = await supabaseClient
        .from('currencies')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setCurrencies((prev) => prev.filter((c) => c.id !== id));
      showFeedback('success', 'Ассет успешно аннигилирован!');
      hapticImpact("success");
    } catch (err: any) {
      showFeedback('error', 'Ошибка удаления: ' + err.message);
      hapticImpact("error");
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 select-none animate-fade-in font-sans max-w-lg mx-auto w-full px-2">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-900 pb-4 mb-5 px-1 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-slate-400 hover:text-slate-200 bg-slate-900/50 border border-slate-900 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" /> Назад
        </button>
        <span className="font-extrabold font-mono tracking-wider text-slate-300 text-xs uppercase">
          Эмиссионный Пульт
        </span>
        <div className="w-16" />
      </div>

      {/* Dynamic Feedback Toast */}
      {feedbackMsg && (
        <div className={`p-3 rounded-xl text-xs font-semibold mb-4 border transition-all duration-200 ${
          feedbackMsg.type === 'success'
            ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
            : 'bg-rose-500/5 border-rose-500/20 text-rose-400'
        }`}>
          {feedbackMsg.text}
        </div>
      )}

      <div className="flex-grow overflow-y-auto pr-1 space-y-6 pb-24">
        {/* Form Card */}
        <form
          onSubmit={handleAddCurrency}
          className="bg-slate-900/10 border border-slate-900 p-5 rounded-2xl flex flex-col gap-4 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-2 text-[8px] text-slate-600 font-mono tracking-widest pointer-events-none select-none uppercase">
            REGISTRY: OFF-GRID
          </div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Coins className="w-4.5 h-4.5 text-primary" />
            </div>
            <div className="flex flex-col">
              <h3 className="font-bold text-slate-200 text-sm">Создать актив</h3>
              <span className="text-[10px] text-slate-500">Эмиссия локального платежного средства</span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold font-mono uppercase tracking-wider pl-1">
                Название токена
              </label>
              <input
                type="text"
                placeholder="Напр. Патроны, Сатоши, USDX"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950/60 border border-slate-900 text-slate-200 rounded-xl px-4 py-3 text-xs focus:border-primary/50 outline-none transition"
              />
            </div>
            
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold font-mono uppercase tracking-wider pl-1">
                Курс в Рублях
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full bg-slate-950/60 border border-slate-900 text-slate-200 rounded-xl pl-4 pr-12 py-3 text-xs focus:border-primary/50 outline-none transition font-mono"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-slate-500">
                  RUB
                </span>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitLoading}
            className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl w-full flex items-center justify-center gap-2 transition-all active:scale-98 text-xs cursor-pointer shadow-lg shadow-primary/15 mt-1"
          >
            {submitLoading ? (
              <Loader2 className="w-4.5 h-4.5 animate-spin" />
            ) : (
              <>
                <Plus className="w-4 h-4" /> Авторизовать эмиссию
              </>
            )}
          </button>
        </form>

        {/* List section */}
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest">
              Собственные Резервы
            </h3>
            <span className="text-[10px] text-slate-500 font-mono font-bold">
              Всего: {currencies.length}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              </div>
            ) : currencies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-slate-900 rounded-2xl p-6 bg-slate-900/5">
                <Wallet className="w-8 h-8 text-slate-700 mb-2.5" />
                <p className="text-slate-500 text-xs">
                  Вы еще не создали ни одной локальной валюты
                </p>
              </div>
            ) : (
              currencies.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between p-4 bg-slate-900/20 border border-slate-900 hover:border-slate-850 rounded-xl transition duration-150 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-primary group-hover:scale-105 transition-transform duration-200">
                      <DollarSign className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                        {c.name}
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 font-mono flex items-center gap-1">
                        <ArrowRightLeft className="w-3 h-3 text-slate-500" />
                        1 {c.name.split(' ')[0]} = <span className="text-emerald-400 font-bold font-mono">{c.rub_value} ₽</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDeleteCurrency(c.id)}
                    className="p-2 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition active:scale-95 cursor-pointer"
                    title="Аннигилировать актив"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
