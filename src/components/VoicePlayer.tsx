import { hapticImpact } from "../lib/haptics";
import { useState, useEffect, useRef, PointerEvent } from 'react';
import { Play, Pause, Loader2, Wand2, ChevronDown, ChevronUp } from 'lucide-react';
import { supabaseClient } from '../lib/supabase';
import { base64ToArrayBuffer } from '../lib/crypto';

interface VoicePlayerProps {
  fileName: string;
  waveformString?: string;
  aesKey: CryptoKey | null;
  transcription?: string;
  isProcessing?: boolean;
  isError?: boolean;
  hasTranscript?: boolean;
  msgId: string;
  onTranscribe?: (fileName: string, msgId: string) => Promise<void>;
  isMine?: boolean;
  localUrl?: string;
}

// Global cache to share audio and avoid multiple voice notes playing at once
let globalCurrentAudio: HTMLAudioElement | null = null;
let globalCurrentSetPlaying: ((playing: boolean) => void) | null = null;

export default function VoicePlayer({
  fileName,
  waveformString = '',
  aesKey,
  transcription = '',
  isProcessing = false,
  isError = false,
  hasTranscript = false,
  msgId,
  onTranscribe,
  isMine = false,
  localUrl,
}: VoicePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0); // 0 to 1
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcribeLoading, setTranscribeLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);

  // Parse waveform data
  const bars = useRef<number[]>([]);
  if (bars.current.length === 0) {
    if (waveformString) {
      bars.current = waveformString.split(',').map(Number);
    } else {
      // Dummy waveform if not present
      bars.current = Array.from({ length: 30 }, (_, index) => 25 + ((index * 37 + fileName.length * 11) % 65));
    }
  }

  useEffect(() => {
    return () => {
      // Clean up audio on unmount if this player owns the global instance
      if (audioRef.current) {
        if (globalCurrentAudio === audioRef.current) {
          globalCurrentAudio.pause();
          globalCurrentAudio = null;
          globalCurrentSetPlaying = null;
        }
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, []);

  const handlePlayPause = async () => {
    if (isLoading) return;

    if (audioRef.current) {
      const audio = audioRef.current;
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
        if (globalCurrentAudio === audio) {
          globalCurrentAudio = null;
          globalCurrentSetPlaying = null;
        }
      } else {
        // Pause any currently playing E2EE voice note
        if (globalCurrentAudio) {
          globalCurrentAudio.pause();
          if (globalCurrentSetPlaying) globalCurrentSetPlaying(false);
        }

        audio.play();
        setIsPlaying(true);
        globalCurrentAudio = audio;
        globalCurrentSetPlaying = setIsPlaying;
      }
      return;
    }

    // Load and decrypt file
    setIsLoading(true);
    try {
      if (localUrl) {
        const audio = new Audio(localUrl);
        audioRef.current = audio;
        audio.addEventListener('timeupdate', () => {
          if (!audio.duration || isScrubbing) return;
          setProgress(audio.currentTime / audio.duration);
        });
        audio.addEventListener('ended', () => {
          setIsPlaying(false);
          setProgress(0);
        });
        if (globalCurrentAudio) {
          globalCurrentAudio.pause();
          globalCurrentSetPlaying?.(false);
        }
        await audio.play();
        setIsPlaying(true);
        globalCurrentAudio = audio;
        globalCurrentSetPlaying = setIsPlaying;
        return;
      }

      let arrayBuffer: ArrayBuffer;

      // Try reading from cache API first
      const cache = await caches.open('syndicate-media-cache');
      const cacheReq = new Request(`/voice/${fileName}`);
      const cachedRes = await cache.match(cacheReq);

      if (cachedRes) {
        arrayBuffer = await cachedRes.arrayBuffer();
      } else {
        const { data, error } = await supabaseClient.storage.from('voice_messages').download(fileName);
        if (error) throw error;
        arrayBuffer = await data.arrayBuffer();

        // Save to cache (encrypted)
        await cache.put(cacheReq, new Response(arrayBuffer));
      }

      if (!aesKey) throw new Error('No AES Key for decryption');

      // Decrypt arrayBuffer
      const bytes = new Uint8Array(arrayBuffer);
      const iv = bytes.slice(0, 12);
      const encryptedData = bytes.slice(12);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        aesKey,
        encryptedData
      );

      const audioBlob = new Blob([decryptedBuffer], { type: 'audio/ogg; codecs=opus' });
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const audioUrl = URL.createObjectURL(audioBlob);
      audioUrlRef.current = audioUrl;

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.addEventListener('timeupdate', () => {
        if (!audio.duration || isScrubbing) return;
        setProgress(audio.currentTime / audio.duration);
      });

      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        setProgress(0);
        if (globalCurrentAudio === audio) {
          globalCurrentAudio = null;
          globalCurrentSetPlaying = null;
        }
      });

      // Pause any playing audio before starting
      if (globalCurrentAudio) {
        globalCurrentAudio.pause();
        if (globalCurrentSetPlaying) globalCurrentSetPlaying(false);
      }

      await audio.play();
      setIsPlaying(true);
      globalCurrentAudio = audio;
      globalCurrentSetPlaying = setIsPlaying;
    } catch (e) {
      console.error('Failed to load/play E2EE voice message', e);
hapticImpact("error");
    } finally {
      setIsLoading(false);
    }
  };

  const updateScrubProgress = (clientX: number) => {
    if (!waveformRef.current) return 0;
    const rect = waveformRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(x, rect.width)) / rect.width;
    setProgress(pct);
    return pct;
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!audioRef.current) {
      // Load and play on tap if not loaded yet
      handlePlayPause();
      return;
    }

    try {
      waveformRef.current?.setPointerCapture(e.pointerId);
    } catch (err) {}

    setIsScrubbing(true);
    const pct = updateScrubProgress(e.clientX);

hapticImpact("selection");

    const handlePointerMove = (ev: globalThis.PointerEvent) => {
      updateScrubProgress(ev.clientX);
    };

    const handlePointerUp = (ev: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);

      const finalPct = updateScrubProgress(ev.clientX);
      if (audioRef.current && audioRef.current.duration) {
        audioRef.current.currentTime = finalPct * audioRef.current.duration;
      }
      setIsScrubbing(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const handleManualTranscribe = async () => {
    if (!onTranscribe) return;
    setTranscribeLoading(true);
    try {
      await onTranscribe(fileName, msgId);
    } catch (e) {
      console.error(e);
    } finally {
      setTranscribeLoading(false);
    }
  };

  const activeCount = Math.floor(progress * bars.current.length);

  return (
    <div className="flex flex-col w-full text-slate-100 select-none font-sans">
      <div className="flex items-center gap-3 w-full">
        {/* Play/Pause Button */}
        <button
          onClick={handlePlayPause}
          disabled={isLoading}
          className={
            isMine
              ? "w-10 h-10 rounded-full bg-white text-primary flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition flex-shrink-0 disabled:opacity-80 cursor-pointer"
              : "w-10 h-10 rounded-full bg-primary/10 border border-primary/30 hover:bg-primary text-primary hover:text-white flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition flex-shrink-0 disabled:opacity-80 cursor-pointer glow-primary"
          }
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current translate-x-0.5" />
          )}
        </button>

        {/* Waveform wrapper */}
        <div
          ref={waveformRef}
          onPointerDown={handlePointerDown}
          className="flex items-center gap-[3px] flex-grow h-8 cursor-pointer touch-none"
        >
          {bars.current.map((val, idx) => {
            const isActive = idx < activeCount;
            return (
              <div
                key={idx}
                className="w-[3px] min-w-[3px] rounded-full transition-all duration-150"
                style={{
                  height: `${Math.max(12, val)}%`,
                  backgroundColor: isActive
                    ? (isMine ? '#ffffff' : 'var(--primary)')
                    : (isMine ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.15)'),
                  boxShadow: isActive
                    ? (isMine ? '0 0 6px rgba(255, 255, 255, 0.6)' : '0 0 6px var(--primary)')
                    : 'none',
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Transcription toggle */}
      {hasTranscript ? (
        <div className={`mt-3 pt-2.5 border-t w-full ${isMine ? 'border-white/10' : 'border-slate-900'}`}>
          <button
            onClick={() => {
              setShowTranscript(!showTranscript);
              hapticImpact("selection");
            }}
            className={`text-[11px] font-bold font-mono tracking-wider uppercase flex items-center gap-1.5 focus:outline-none transition ${
              isMine ? 'text-white/80 hover:text-white' : 'text-slate-400 hover:text-primary'
            }`}
          >
            {showTranscript ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" /> Скрыть перевод
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" /> Показать перевод
              </>
            )}
          </button>
          {showTranscript && (
            <div className={`mt-2 text-xs leading-relaxed font-mono p-3 rounded-xl border whitespace-pre-wrap select-text ${
              isMine
                ? 'bg-black/15 border-white/10 text-white/95'
                : 'bg-slate-900/40 border-slate-900/80 text-slate-300'
            }`}>
              {transcription}
            </div>
          )}
        </div>
      ) : isProcessing ? (
        <div className={`mt-3 pt-2.5 border-t text-[11px] font-mono flex items-center gap-1.5 uppercase tracking-wider ${
          isMine ? 'border-white/10 text-white/75' : 'border-slate-900 text-slate-500'
        }`}>
          <Loader2 className={`w-3 h-3 animate-spin ${isMine ? 'text-white' : 'text-primary'}`} /> {transcription || 'ИИ расшифровывает...'}
        </div>
      ) : isError ? (
        <div className={`mt-3 pt-2.5 border-t text-[11px] font-mono flex items-center gap-1.5 uppercase tracking-wider ${
          isMine ? 'border-white/10 text-rose-200' : 'border-slate-900 text-rose-400'
        }`}>
          {transcription || 'Ошибка декодирования'}
        </div>
      ) : (
        onTranscribe && (
          <div className={`mt-3 pt-2.5 border-t w-full ${isMine ? 'border-white/10' : 'border-slate-900'}`}>
            <button
              onClick={handleManualTranscribe}
              disabled={transcribeLoading}
              className={`text-[11px] font-bold font-mono tracking-wider uppercase flex items-center gap-1.5 focus:outline-none active:opacity-75 disabled:opacity-50 transition ${
                isMine ? 'text-white/80 hover:text-white' : 'text-slate-400 hover:text-primary'
              }`}
            >
              {transcribeLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Слушаю...
                </>
              ) : (
                <>
                  <Wand2 className={`w-3.5 h-3.5 ${isMine ? 'text-white' : 'text-primary'}`} /> Расшифровать текст
                </>
              )}
            </button>
          </div>
        )
      )}
    </div>
  );
}
