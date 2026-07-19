import { hapticImpact } from "../lib/haptics";
import { useState, useEffect } from 'react';
import * as idbKeyval from 'idb-keyval';
import { ChevronLeft, Database, Trash, HardDrive, RefreshCw, AlertCircle, Check, X, Info } from 'lucide-react';

interface StorageScreenProps {
  onBack: () => void;
}

export default function StorageScreen({ onBack }: StorageScreenProps) {
  const [chatSize, setChatSize] = useState('0.00');
  const [mediaSize, setMediaSize] = useState('0.00');
  const [totalSize, setTotalSize] = useState('0.00');
  const [cacheLimit, setCacheLimit] = useState(50); // MB
  const [loading, setLoading] = useState(false);
  
  // Custom Confirmation States
  const [confirmClearChats, setConfirmClearChats] = useState(false);
  const [confirmClearMedia, setConfirmClearMedia] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showInfoLimit, setShowInfoLimit] = useState(false);

  const calculateStorage = async () => {
    setLoading(true);
    try {
      // 1. Calculate Chat history size in IDB
      const keys = await idbKeyval.keys();
      const chatKeys = keys.filter((k) => k.toString().startsWith('chat_hist_'));
      let chatBytes = 0;
      for (const k of chatKeys) {
        const data: any = await idbKeyval.get(k);
        if (data && data.history) {
          chatBytes += JSON.stringify(data.history).length * 2; // ~2 bytes per char
        }
      }

      // 2. Calculate Media cache size (syndicate-media-cache)
      let mediaBytes = 0;
      try {
        const hasMediaCache = await caches.has('syndicate-media-cache');
        if (hasMediaCache) {
          const cache = await caches.open('syndicate-media-cache');
          const requests = await cache.keys();
          for (const req of requests) {
            const response = await cache.match(req);
            if (response) {
              const blob = await response.blob();
              mediaBytes += blob.size;
            }
          }
        }
      } catch (e) {
        console.warn(e);
      }

      const chatMB = (chatBytes / (1024 * 1024)).toFixed(2);
      const mediaMB = (mediaBytes / (1024 * 1024)).toFixed(2);
      const totalMB = ((chatBytes + mediaBytes) / (1024 * 1024)).toFixed(2);

      setChatSize(chatMB);
      setMediaSize(mediaMB);
      setTotalSize(totalMB);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getCacheLimit = () => {
    const saved = localStorage.getItem('synd_cache_limit_mb');
    return saved ? parseInt(saved, 10) : 50;
  };

  useEffect(() => {
    setCacheLimit(getCacheLimit());
    calculateStorage();
  }, []);

  const enforceCacheLimit = async (limitMB: number) => {
    const limitBytes = limitMB * 1024 * 1024;
    const keys = await idbKeyval.keys();
    const chatKeys = keys.filter((k) => k.toString().startsWith('chat_hist_'));

    let totalBytes = 0;
    const cachesArr: { key: IDBValidKey; size: number; updated_at: number }[] = [];

    for (const k of chatKeys) {
      const data: any = await idbKeyval.get(k);
      if (data && data.history) {
        const size = JSON.stringify(data.history).length * 2;
        totalBytes += size;
        cachesArr.push({ key: k, size, updated_at: data.updated_at || Date.now() });
      }
    }

    if (totalBytes > limitBytes) {
      // Sort oldest caches first
      cachesArr.sort((a, b) => a.updated_at - b.updated_at);
      while (totalBytes > limitBytes && cachesArr.length > 0) {
        const oldest = cachesArr.shift();
        if (oldest) {
          await idbKeyval.del(oldest.key);
          totalBytes -= oldest.size;
        }
      }
    }
  };

  const handleLimitChange = async (val: number) => {
    setCacheLimit(val);
    localStorage.setItem('synd_cache_limit_mb', val.toString());
    await enforceCacheLimit(val);
    calculateStorage();
    hapticImpact("selection");
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleClearChats = async () => {
    const keys = await idbKeyval.keys();
    const chatKeys = keys.filter((k) => k.toString().startsWith('chat_hist_'));
    for (const k of chatKeys) {
      await idbKeyval.del(k);
    }

    setConfirmClearChats(false);
    showToast('Кэш текстовых сообщений успешно удален');
    hapticImpact("success");
    calculateStorage();
  };

  const handleClearMedia = async () => {
    try {
      await caches.delete('syndicate-media-cache');
    } catch (e) {
      console.error(e);
    }

    setConfirmClearMedia(false);
    showToast('Кэш медиафайлов и аудио успешно удален');
    hapticImpact("success");
    calculateStorage();
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
          Данные и Память
        </span>
        <button
          onClick={calculateStorage}
          disabled={loading}
          className="text-slate-400 hover:text-primary p-2 transition-all cursor-pointer active:scale-95"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-primary' : ''}`} />
        </button>
      </div>

      {/* Dynamic Feedback Toast */}
      {toastMsg && (
        <div className="p-3 rounded-xl text-xs font-semibold mb-4 border bg-emerald-500/5 border-emerald-500/20 text-emerald-400 animate-fade-in">
          {toastMsg}
        </div>
      )}

      <div className="flex-grow overflow-y-auto pr-1 space-y-6 pb-24">
        {/* Premium Spacious Storage Card */}
        <div className="bg-gradient-to-br from-slate-900/40 to-slate-950/40 border border-slate-900 rounded-2xl p-6 flex flex-col items-center justify-center text-center relative shadow-xl">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-[1px] bg-gradient-to-r from-transparent via-primary/30 to-transparent blur-xs" />
          
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center mb-3">
            <Database className="w-5 h-5 text-primary" />
          </div>
          
          <div className="flex flex-col gap-1 items-center justify-center">
            <div className="text-4xl font-extrabold font-mono text-slate-100 tracking-tight leading-none py-1 flex items-baseline gap-1.5 select-all">
              {totalSize}
              <span className="text-sm text-primary font-bold tracking-normal font-sans">МБ</span>
            </div>
            <span className="text-[9px] text-slate-500 font-bold font-mono uppercase tracking-widest mt-1">
              Локальные данные на этом устройстве
            </span>
          </div>
        </div>

        {/* Cache limits */}
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest">
              ЛИМИТ КЭШИРОВАНИЯ
            </h3>
            <button
              onClick={() => { hapticImpact("selection"); setShowInfoLimit(!showInfoLimit); }}
              className={`p-1.5 rounded-lg border transition active:scale-95 cursor-pointer flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider ${
                showInfoLimit
                  ? 'bg-primary/10 border-primary/25 text-primary'
                  : 'bg-slate-900/40 border-slate-900 text-slate-400 hover:text-slate-200'
              }`}
              title="Показать справку"
            >
              <Info className="w-3 h-3" />
              <span>{showInfoLimit ? 'Скрыть' : 'Инфо'}</span>
            </button>
          </div>

          <div className="bg-slate-900/10 border border-slate-900 p-5 rounded-2xl relative">
            <div className="flex justify-between items-center mb-4">
              <span className="font-semibold text-xs text-slate-300">Максимальный размер</span>
              <span className="font-bold font-mono text-primary text-sm">{cacheLimit} МБ</span>
            </div>

            <input
              type="range"
              min="10"
              max="500"
              step="10"
              value={cacheLimit}
              onChange={(e) => handleLimitChange(parseInt(e.target.value, 10))}
              className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-primary mb-4"
            />

            <div className="flex justify-between text-[9px] text-slate-500 font-mono">
              <span>10 МБ</span>
              <span>500 МБ</span>
            </div>

            {showInfoLimit && (
              <div className="flex gap-3 text-[11px] leading-relaxed text-slate-400 bg-slate-950/40 border border-slate-900/80 p-4 rounded-xl mt-4 animate-fade-in">
                <AlertCircle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                <span>
                  При превышении лимита старые сообщения удаляются из памяти устройства. Они
                  остаются на сервере в зашифрованном виде и подгружаются при скролле.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Manual cleaner list */}
        <div>
          <h3 className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest mb-3 px-1">
            РУЧНАЯ ОЧИСТКА КЭША
          </h3>

          <div className="flex flex-col gap-2.5">
            {/* Chat Cache Cleaner */}
            <div className="flex flex-col bg-slate-900/10 border border-slate-900 rounded-2xl overflow-hidden transition duration-150">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 text-primary flex items-center justify-center">
                    <HardDrive className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-200 text-xs">Кэш переписки</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">{chatSize} МБ</div>
                  </div>
                </div>

                {!confirmClearChats ? (
                  <button
                    onClick={() => { hapticImpact("selection"); setConfirmClearChats(true); }}
                    className="p-2 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition active:scale-95 cursor-pointer"
                    title="Очистить"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 animate-fade-in">
                    <button
                      onClick={handleClearChats}
                      className="px-2.5 py-1.5 bg-rose-600/15 border border-rose-500/30 text-rose-400 text-[10px] font-bold rounded-lg flex items-center gap-1 hover:bg-rose-600 hover:text-white transition cursor-pointer"
                    >
                      <Check className="w-3 h-3" /> Очистить
                    </button>
                    <button
                      onClick={() => setConfirmClearChats(false)}
                      className="p-1.5 bg-slate-900 border border-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              {confirmClearChats && (
                <div className="px-4 pb-4 pt-1 border-t border-slate-950 bg-slate-950/20 text-[10px] text-slate-400/90 leading-relaxed">
                  Будет очищен кэш локальных сообщений. Сами чаты не пропадут и загрузятся с сервера при открытии.
                </div>
              )}
            </div>

            {/* Media Cache Cleaner */}
            <div className="flex flex-col bg-slate-900/10 border border-slate-900 rounded-2xl overflow-hidden transition duration-150">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 text-purple-400 flex items-center justify-center">
                    <Database className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-200 text-xs">Голосовые и медиа</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">{mediaSize} МБ</div>
                  </div>
                </div>

                {!confirmClearMedia ? (
                  <button
                    onClick={() => { hapticImpact("selection"); setConfirmClearMedia(true); }}
                    className="p-2 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition active:scale-95 cursor-pointer"
                    title="Очистить"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 animate-fade-in">
                    <button
                      onClick={handleClearMedia}
                      className="px-2.5 py-1.5 bg-rose-600/15 border border-rose-500/30 text-rose-400 text-[10px] font-bold rounded-lg flex items-center gap-1 hover:bg-rose-600 hover:text-white transition cursor-pointer"
                    >
                      <Check className="w-3 h-3" /> Очистить
                    </button>
                    <button
                      onClick={() => setConfirmClearMedia(false)}
                      className="p-1.5 bg-slate-900 border border-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              {confirmClearMedia && (
                <div className="px-4 pb-4 pt-1 border-t border-slate-950 bg-slate-950/20 text-[10px] text-slate-400/90 leading-relaxed">
                  Будут удалены локально загруженные голосовые сообщения и превью медиафайлов. При повторном воспроизведении они скачаются заново.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
