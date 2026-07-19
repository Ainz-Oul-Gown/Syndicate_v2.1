import { hapticImpact } from "../lib/haptics";
import { useState, useEffect } from 'react';
import { Search, Loader2, Sliders, Shield, Brain, Check, Calendar, HelpCircle } from 'lucide-react';
import { supabaseClient } from '../lib/supabase';
import { decryptText } from '../lib/crypto';
import { Message, DecryptedMessage } from '../types';
import { getEmbeddingPipeline } from '../lib/ai';

interface DeepSearchProps {
  chatId: string;
  aesKey: CryptoKey | null;
  userId: number;
}

export default function DeepSearch({ chatId, aesKey, userId }: DeepSearchProps) {
  const [query, setQuery] = useState('');
  const [isSemantic, setIsSemantic] = useState(false);
  const [threshold, setThreshold] = useState(0.4);
  const [isLoading, setIsLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [statusText, setStatusText] = useState('');
  const [results, setResults] = useState<any[]>([]);

  const initAI = async () => {
    setStatusText('Запуск ИИ-модели...');
    return await getEmbeddingPipeline((percent) => {
      setDownloadProgress(percent);
    });
  };

  const cosineSimilarity = (vecA: number[] | Float32Array, vecB: number[] | Float32Array) => {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  };

  const handleSearch = async () => {
    if (!query.trim() || !aesKey) return;
    setIsLoading(true);
    setResults([]);

    try {
      // Fetch entire chat history from DB
      const { data: messages, error } = await supabaseClient
        .from('messages')
        .select('id, chat_id, sender_id, encrypted_text, encrypted_vector, created_at')
        .eq('chat_id', chatId);

      if (error || !messages || messages.length === 0) {
        setResults([]);
        return;
      }

      let queryVector: Float32Array | null = null;

      if (isSemantic) {
        setStatusText('Подгружаем ИИ-модель (до 117 МБ)...');
        try {
          const ai = await initAI();
          setStatusText('Анализ смысла...');
          const output = await ai(query, { pooling: 'mean', normalize: true });
          queryVector = output.data;
        } catch (e: any) {
          console.error(e);
          alert('Ошибка ИИ-поиска: ' + e.message);
          setIsLoading(false);
          return;
        }
      }

      const found: any[] = [];

      for (const msg of messages) {
        try {
          // Decrypt text
          const decrypted = await decryptText(msg.encrypted_text, aesKey, userId, msg.sender_id);
          let plainText = decrypted.text;

          // Pretty formatting for special markers
          let displayText = plainText;
          if (plainText.startsWith('[VOICE]:')) {
            const parts = plainText.replace('[VOICE]:', '').split('|');
            let transText = 'Голосовое сообщение';
            for (let i = 1; i < parts.length; i++) {
              if (!parts[i].startsWith('WF:')) {
                transText = parts[i];
              }
            }
            displayText = `🎤 ${transText}`;
          } else if (plainText.startsWith('[GROUP_INVITE]:')) {
            const parts = plainText.replace('[GROUP_INVITE]:', '').split('|');
            const groupName = parts[1] || 'Неизвестная группа';
            displayText = `🎫 Приглашение в: ${groupName}`;
          }

          if (isSemantic && msg.encrypted_vector && queryVector) {
            // Decrypt encrypted vector
            const vecRaw = atob(msg.encrypted_vector);
            const vecBytes = new Uint8Array(vecRaw.length);
            for (let i = 0; i < vecRaw.length; i++) {
              vecBytes[i] = vecRaw.charCodeAt(i);
            }

            const decryptedVecBuffer = await window.crypto.subtle.decrypt(
              { name: 'AES-GCM', iv: vecBytes.slice(0, 12) },
              aesKey,
              vecBytes.slice(12)
            );

            const msgVector = new Float32Array(decryptedVecBuffer);
            const score = cosineSimilarity(queryVector, msgVector);

            if (score >= threshold) {
              found.push({
                text: displayText,
                score,
                time: msg.created_at,
              });
            }
          } else if (!isSemantic) {
            if (displayText.toLowerCase().includes(query.toLowerCase())) {
              found.push({
                text: displayText,
                score: 1.0,
                time: msg.created_at,
              });
            }
          }
        } catch (err) {
          // Skip corrupt or un-decryptable messages
        }
      }

      if (isSemantic) {
        found.sort((a, b) => b.score - a.score);
      } else {
        found.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      }

      setResults(found);
    } catch (err: any) {
      alert('Ошибка поиска: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full text-slate-100 p-2 font-sans relative">
      
      {/* Search Input Box */}
      <div className="flex gap-2.5 mb-5 relative z-10">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
          placeholder="Что ищем?"
          className="flex-grow bg-slate-950/60 backdrop-blur border border-slate-800 text-slate-100 rounded-2xl px-5 py-4 text-base focus:border-primary/50 outline-none transition-colors shadow-inner"
        />
        <button
          onClick={handleSearch}
          disabled={isLoading}
          className="bg-primary hover:bg-primary-hover active:bg-primary/90 disabled:opacity-50 text-white rounded-2xl px-6 flex items-center justify-center transition-all shadow-lg shadow-primary/20 transform active:scale-95"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Search className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Semantic toggles and settings */}
      <div className="flex flex-col gap-3.5 bg-slate-900/40 backdrop-blur-md border border-slate-800/80 p-4 rounded-3xl mb-5 z-10 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent pointer-events-none" />
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
          <label className="flex items-start gap-3 cursor-pointer text-slate-200 select-none group">
            <div className="relative flex items-center justify-center mt-0.5">
              <input
                type="checkbox"
                checked={isSemantic}
                onChange={(e) => {
                  setIsSemantic(e.target.checked);
                  hapticImpact("selection");
                }}
                className="peer sr-only"
              />
              <div className="w-5 h-5 border-2 border-slate-700 rounded bg-slate-950 peer-checked:bg-primary peer-checked:border-primary transition-all flex items-center justify-center">
                <Check className="w-3.5 h-3.5 text-slate-950 opacity-0 peer-checked:opacity-100 font-bold transition-opacity" />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-sm tracking-wide uppercase font-mono group-hover:text-primary transition-colors">Нейро-поиск</span>
              <span className="text-[10px] text-slate-400 font-semibold leading-tight">Находит по смыслу, а не по словам</span>
            </div>
          </label>

          {isSemantic && (
            <div className="flex items-center gap-3 text-slate-400 bg-slate-950/50 p-2.5 px-4 rounded-xl border border-slate-800/50 self-stretch sm:self-auto w-full sm:w-auto">
              <Sliders className="w-4 h-4 text-primary shrink-0" />
              <input
                type="range"
                min="0.3"
                max="0.8"
                step="0.05"
                value={threshold}
                onChange={(e) => {
                  setThreshold(parseFloat(e.target.value));
                  hapticImpact("selection");
                }}
                className="w-full sm:w-24 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <span className="text-[11px] font-mono font-bold text-primary w-8 text-right shrink-0 bg-primary/10 px-1.5 py-0.5 rounded">
                {Math.round(threshold * 100)}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Results Area */}
      <div className="flex-grow overflow-y-auto min-h-[200px] z-10 scrollbar-hide pr-1 pb-10">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400 animate-fade-in">
            {downloadProgress !== null ? (
              <div className="flex flex-col items-center max-w-[240px]">
                <div className="relative mb-5">
                  <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse" />
                  <Brain className="w-14 h-14 text-primary relative z-10 animate-bounce" />
                </div>
                <span className="font-bold font-mono tracking-widest text-slate-200 mb-1.5 uppercase text-sm">Нейросеть грузится</span>
                <span className="text-[10px] text-slate-400 mb-4 font-semibold">Загрузка происходит один раз в кэш</span>
                <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden mb-2 border border-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-emerald-400 transition-all duration-300 relative overflow-hidden"
                    style={{ width: `${downloadProgress}%` }}
                  >
                    <div className="absolute inset-0 bg-white/20 animate-shimmer" />
                  </div>
                </div>
                <span className="text-[11px] font-mono font-black text-primary bg-primary/10 px-3 py-1 rounded-lg">
                  {downloadProgress}%
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
                <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-widest">{statusText}</span>
              </div>
            )}
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-slate-500/50 animate-fade-in">
            <Search className="w-12 h-12 mb-3 opacity-20" />
            <span className="text-xs font-mono font-bold tracking-widest uppercase">Пустота</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3 animate-fade-in">
            {results.map((r, idx) => (
              <div
                key={idx}
                className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/60 p-4 rounded-2xl hover:border-slate-700 hover:bg-slate-800/40 transition-all cursor-pointer group"
              >
                <div className="text-slate-200 text-sm mb-3 select-text whitespace-pre-wrap font-medium leading-relaxed">
                  {r.text}
                </div>
                <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono font-bold tracking-wider uppercase border-t border-slate-800/50 pt-3">
                  <span className="flex items-center gap-1.5 bg-slate-950/50 px-2 py-1 rounded-md">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {new Date(r.time).toLocaleDateString()} {new Date(r.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isSemantic && (
                    <span className="text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md flex items-center gap-1.5">
                      <Brain className="w-3.5 h-3.5" />
                      {Math.round(r.score * 100)}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
