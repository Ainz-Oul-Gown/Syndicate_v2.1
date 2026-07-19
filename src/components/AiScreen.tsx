import { hapticImpact } from "../lib/haptics";
import React, { useState, useEffect } from 'react';
import { ChevronLeft, Brain, Cpu, ShieldAlert, Sparkles, Download, Trash, RefreshCw } from 'lucide-react';

interface AiScreenProps {
  onBack: () => void;
  worker: Worker | null;
}

export default function AiScreen({ onBack, worker }: AiScreenProps) {
  const [autoWhisper, setAutoWhisper] = useState(true);
  const [whisperModel, setWhisperModel] = useState('Xenova/whisper-tiny');
  const [searchSize, setSearchSize] = useState('0.00');
  const [whisperSize, setWhisperSize] = useState('0.00');
  const [totalSize, setTotalSize] = useState('0.00');

  const [searchLoading, setSearchLoading] = useState(false);
  const [whisperLoading, setWhisperLoading] = useState(false);
  const [searchProgress, setSearchProgress] = useState<number | null>(null);
  const [whisperProgress, setWhisperProgress] = useState<number | null>(null);

  const getModelSize = async (modelPath: string): Promise<number> => {
    let size = 0;
    try {
      const cache = await caches.open('transformers-cache');
      const requests = await cache.keys();
      for (const req of requests) {
        if (req.url.includes(modelPath)) {
          const response = await cache.match(req);
          if (response) {
            const blob = await response.blob();
            size += blob.size;
          }
        }
      }
    } catch (e) {}
    return size;
  };

  const deleteModel = async (modelPath: string) => {
    try {
      const cache = await caches.open('transformers-cache');
      const requests = await cache.keys();
      for (const req of requests) {
        if (req.url.includes(modelPath)) {
          await cache.delete(req);
        }
      }
    } catch (e) {}
  };

  const calculateSizes = async () => {
    const searchPath = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
    const searchBytes = await getModelSize(searchPath);
    const whisperBytes = await getModelSize(whisperModel);

    const sMB = (searchBytes / (1024 * 1024)).toFixed(2);
    const wMB = (whisperBytes / (1024 * 1024)).toFixed(2);
    const tMB = ((searchBytes + whisperBytes) / (1024 * 1024)).toFixed(2);

    setSearchSize(sMB);
    setWhisperSize(wMB);
    setTotalSize(tMB);
  };

  useEffect(() => {
    setAutoWhisper(localStorage.getItem('synd_auto_whisper') !== 'off');
    setWhisperModel(localStorage.getItem('synd_whisper_model') || 'Xenova/whisper-tiny');
  }, []);

  useEffect(() => {
    calculateSizes();
  }, [whisperModel]);

  // Set up listeners for worker feedback
  useEffect(() => {
    if (!worker) return;

    const handleWorkerMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setWhisperProgress(msg.percent);
      } else if (msg.type === 'ready') {
        setWhisperLoading(false);
        setWhisperProgress(null);
        calculateSizes();
hapticImpact("success");
      } else if (msg.type === 'error') {
        setWhisperLoading(false);
        setWhisperProgress(null);
        alert('Ошибка воркера: ' + msg.error);
      }
    };

    worker.addEventListener('message', handleWorkerMessage);
    return () => {
      worker.removeEventListener('message', handleWorkerMessage);
    };
  }, [worker]);

  const handleAutoWhisperToggle = (checked: boolean) => {
    setAutoWhisper(checked);
    localStorage.setItem('synd_auto_whisper', checked ? 'on' : 'off');
hapticImpact("selection");
  };

  const handleWhisperModelChange = (val: string) => {
    setWhisperModel(val);
    localStorage.setItem('synd_whisper_model', val);

    if (worker) {
      worker.postMessage({ type: 'change_model', model: val });
    }

hapticImpact("selection");
  };

  const handleDownloadSearch = async () => {
    setSearchLoading(true);
    setSearchProgress(0);

    try {
      const { pipeline } = await import('@xenova/transformers');
      await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
        quantized: true,
        progress_callback: (data: any) => {
          if (data.status === 'progress') {
            const percent = Math.round((data.loaded / data.total) * 100);
            setSearchProgress(percent);
          }
        },
      });

      setSearchProgress(null);
      calculateSizes();
hapticImpact("success");
    } catch (err: any) {
      alert('Ошибка загрузки: ' + err.message);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleDeleteSearch = async () => {
    if (!confirm('Удалить модель поиска?')) return;
    await deleteModel('Xenova/paraphrase-multilingual-MiniLM-L12-v2');
    calculateSizes();
hapticImpact("success");
  };

  const handleDownloadWhisper = () => {
    if (!worker) return;
    setWhisperLoading(true);
    setWhisperProgress(0);
    worker.postMessage({ type: 'force_download' });
  };

  const handleDeleteWhisper = async () => {
    if (!confirm('Удалить модель Whisper?')) return;
    await deleteModel(whisperModel);
    calculateSizes();
hapticImpact("success");
  };

  const isSearchDownloaded = parseFloat(searchSize) > 0;
  const isWhisperDownloaded = parseFloat(whisperSize) > 0;

  return (
    <div className="flex flex-col min-h-full bg-slate-950 text-slate-100 select-none animate-fade-in font-sans">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-900 pb-4 mb-6 px-1">
        <button
          onClick={onBack}
          className="text-primary hover:text-primary-hover font-semibold flex items-center gap-1 focus:outline-none transition active:scale-95"
        >
          <ChevronLeft className="w-5 h-5" /> Назад
        </button>
        <span className="font-bold font-display text-slate-200 tracking-tight text-base">Нейро-модуль</span>
        <button 
          onClick={calculateSizes} 
          className="text-primary hover:text-primary-hover p-1 transition active:scale-95"
        >
          <RefreshCw className="w-4.5 h-4.5" />
        </button>
      </div>

      {/* Main card */}
      <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-6 flex flex-col items-center justify-center text-center mb-6 relative overflow-hidden shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4 glow-primary" style={{ '--primary-border': 'rgba(244,63,94,0.3)' } as React.CSSProperties}>
          <Brain className="w-8 h-8 text-rose-500 animate-pulse" />
        </div>
        <h3 className="text-4xl font-extrabold font-display text-slate-100 mb-1.5 tracking-tight">
          {totalSize} <span className="text-xl text-rose-500 font-bold">МБ</span>
        </h3>
        <span className="text-[11px] text-slate-400 font-mono uppercase tracking-wider">
          ЛОКАЛЬНЫЙ НЕЙРОСЕТЕВОЙ КЭШ
        </span>
      </div>

      {/* Embedded Search Settings */}
      <h3 className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest mb-3 px-1">
        СЕМАНТИЧЕСКИЙ ПОИСК
      </h3>

      <div className="bg-slate-900/30 border border-slate-900 p-5 rounded-2xl mb-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-2 text-[8px] text-slate-600 font-mono tracking-widest pointer-events-none select-none uppercase">
          MODEL: L12-V2
        </div>
        <div className="flex justify-between items-start gap-4">
          <div>
            <div className="font-bold text-slate-200 text-sm">Multilingual MiniLM</div>
            <div className="text-xs text-slate-400 mt-1 leading-relaxed">
              Продвинутое понимание смысла и контекста сообщений (Ru/En)
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center border-t border-slate-900/60 mt-4 pt-4 text-xs">
          <span className="text-slate-500 font-mono">Занято: {searchSize} МБ</span>
          <span className={`font-semibold ${isSearchDownloaded ? 'text-emerald-400' : 'text-primary'}`}>
            {isSearchDownloaded ? 'Установлена' : 'Не загружена'}
          </span>
        </div>

        {searchProgress !== null ? (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-slate-400 mb-2">
              <span className="font-mono text-[11px]">Загрузка весов...</span>
              <span className="font-mono">{searchProgress}%</span>
            </div>
            <div className="w-full h-1 bg-slate-950 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${searchProgress}%` }}
              />
            </div>
          </div>
        ) : isSearchDownloaded ? (
          <button
            onClick={handleDeleteSearch}
            className="mt-4 w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold py-3 rounded-xl flex items-center justify-center gap-1.5 transition active:scale-98"
          >
            <Trash className="w-4 h-4" /> Удалить модель поиска
          </button>
        ) : (
          <button
            onClick={handleDownloadSearch}
            disabled={searchLoading}
            className="mt-4 w-full bg-primary/10 hover:bg-primary text-primary hover:text-white border border-primary/20 hover:border-transparent text-xs font-semibold py-3 rounded-xl flex items-center justify-center gap-1.5 transition duration-300 active:scale-98 glow-primary"
          >
            <Download className="w-4 h-4" /> Скачать модель (~117 МБ)
          </button>
        )}
      </div>

      {/* Speech transcription Whisper model */}
      <h3 className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest mb-3.5 px-1">
        РАСПОЗНАВАНИЕ РЕЧИ (WHISPER)
      </h3>

      {/* Auto transcription toggle */}
      <div className="flex items-center justify-between p-4 bg-slate-900/20 border border-slate-900/60 rounded-2xl mb-4 transition duration-200">
        <div>
          <div className="font-bold text-slate-200 text-sm">Авто-расшифровка</div>
          <div className="text-xs text-slate-400 mt-0.5">Переводить новые ГС в текст</div>
        </div>

        <label className="relative inline-flex items-center cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoWhisper}
            onChange={(e) => handleAutoWhisperToggle(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-10 h-5.5 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-slate-200 after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-emerald-500 peer-checked:after:bg-white" />
        </label>
      </div>

      <div className="bg-slate-900/30 border border-slate-900 p-5 rounded-2xl mb-4 relative overflow-hidden">
        <label className="text-[10px] font-bold font-mono text-slate-400 mb-2.5 block">
          ВЫБРАТЬ МОДЕЛЬ WHISPER (КАЧЕСТВО):
        </label>
        <div className="relative w-full mb-3">
          <select
            value={whisperModel}
            onChange={(e) => handleWhisperModelChange(e.target.value)}
            className="w-full bg-slate-950 border border-slate-900 text-slate-200 rounded-xl px-4 py-3 text-xs font-mono focus:border-primary outline-none appearance-none cursor-pointer"
          >
            <option value="Xenova/whisper-tiny">Tiny (Самая быстрая, ~40 МБ)</option>
            <option value="Xenova/whisper-base">Base (Средняя, ~75 МБ)</option>
            <option value="Xenova/whisper-small">Small (Точная, ~240 МБ)</option>
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        <div className="flex justify-between items-center border-t border-slate-900/60 mt-4 pt-4 text-xs">
          <span className="text-slate-500 font-mono">Занято: {whisperSize} МБ</span>
          <span className={`font-semibold ${isWhisperDownloaded ? 'text-emerald-400' : 'text-primary'}`}>
            {isWhisperDownloaded ? 'Установлена' : 'Не загружена'}
          </span>
        </div>

        {whisperProgress !== null ? (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-slate-400 mb-2">
              <span className="font-mono text-[11px]">Загрузка весов...</span>
              <span className="font-mono">{whisperProgress}%</span>
            </div>
            <div className="w-full h-1 bg-slate-950 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${whisperProgress}%` }}
              />
            </div>
          </div>
        ) : isWhisperDownloaded ? (
          <button
            onClick={handleDeleteWhisper}
            className="mt-4 w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold py-3 rounded-xl flex items-center justify-center gap-1.5 transition active:scale-98"
          >
            <Trash className="w-4 h-4" /> Удалить модель Whisper
          </button>
        ) : (
          <button
            onClick={handleDownloadWhisper}
            disabled={whisperLoading}
            className="mt-4 w-full bg-primary/10 hover:bg-primary text-primary hover:text-white border border-primary/20 hover:border-transparent text-xs font-semibold py-3 rounded-xl flex items-center justify-center gap-1.5 transition duration-300 active:scale-98 glow-primary"
          >
            <Download className="w-4 h-4" /> Скачать выбранную модель
          </button>
        )}
      </div>
    </div>
  );
}
