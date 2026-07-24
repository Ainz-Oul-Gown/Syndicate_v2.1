import { useRef, useEffect } from 'react';
import { Mic, Send, X, Trash2, Play, Pause, Loader2 } from 'lucide-react';
import type { RefObject } from 'react';
import { TouchEvent, MouseEvent } from 'react';

export interface MessageComposerProps {
  inputText: string;
  onInputChange: (text: string) => void;
  onSend: () => void;
  replyTo: { id: string; name: string; text: string } | null;
  onClearReply: () => void;
  isRecording: boolean;
  recordingDuration: number;
  isRecordLocked: boolean;
  isRecordPaused: boolean;
  recordPreviewUrl: string | null;
  isRecordPlaying: boolean;
  recordPreviewProgress: number;
  recordWaveHistory: number[];
  micPulseScale: number;
  onStartRecording: (e?: TouchEvent | MouseEvent) => void;
  onStopRecording: () => void;
  onForceStop: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onCancelRecording: () => void;
  onPlayPreview: () => void;
  onMicTouchMove: (e: TouchEvent) => void;
  failedMessageCount: number;
  isRetryingFailed: boolean;
  online: boolean;
  onRetryAll: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  previewAudioRef: RefObject<HTMLAudioElement | null>;
}

export default function MessageComposer({
  inputText,
  onInputChange,
  onSend,
  replyTo,
  onClearReply,
  isRecording,
  recordingDuration,
  isRecordLocked,
  isRecordPaused,
  recordPreviewUrl,
  isRecordPlaying,
  recordPreviewProgress,
  recordWaveHistory,
  micPulseScale,
  onStartRecording,
  onStopRecording,
  onForceStop,
  onPauseRecording,
  onResumeRecording,
  onCancelRecording,
  onPlayPreview,
  onMicTouchMove,
  failedMessageCount,
  isRetryingFailed,
  online,
  onRetryAll,
  inputRef,
  previewAudioRef,
}: MessageComposerProps) {
  return (
    <div className="chat-input-area flex-shrink-0 flex flex-col bg-slate-900/80 backdrop-blur-xl border-t border-slate-900 px-4 py-2 relative z-10">
      {failedMessageCount > 0 && online && (
        <div className="flex items-center justify-between gap-3 mb-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 animate-slide-up" role="status">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-amber-200">Не отправлено: {failedMessageCount}</div>
            <div className="text-[10px] text-amber-200/60 truncate">Соединение доступно — можно повторить отправку</div>
          </div>
          <button
            type="button"
            onClick={() => onRetryAll()}
            disabled={isRetryingFailed}
            className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-400/15 px-3 py-2 text-[11px] font-bold text-amber-100 transition active:scale-95 disabled:opacity-60"
          >
            {isRetryingFailed && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isRetryingFailed ? 'ОТПРАВЛЯЕМ…' : 'ОТПРАВИТЬ ВСЕ'}
          </button>
        </div>
      )}

      {replyTo && (
        <div className="flex items-center gap-2 bg-slate-950/40 p-2.5 rounded-xl border border-slate-900/60 mb-2 select-none animate-slide-up">
          <div className="flex-grow border-l-2 border-primary pl-3">
            <div className="text-xs font-semibold text-primary">{replyTo.name}</div>
            <div className="text-xs text-slate-400 truncate max-w-[260px]">{replyTo.text}</div>
          </div>
          <button onClick={onClearReply} className="text-slate-500 hover:text-slate-300 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-3 w-full relative">
        {isRecording && (
          <div className="absolute inset-y-0 left-0 right-[56px] bg-slate-900 z-20 flex items-center justify-between px-2 rounded-2xl">
            <div className="flex items-center gap-3">
              {!isRecordLocked ? (
                <>
                  <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-slate-200 font-mono font-bold tracking-widest text-lg">
                    {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:{(recordingDuration % 60).toString().padStart(2, '0')}
                  </span>
                </>
              ) : (
                <button onClick={onCancelRecording} className="text-slate-400 p-2 hover:bg-slate-800 rounded-full transition">
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
            </div>

            {!isRecordLocked ? (
              <div className="flex flex-col items-end gap-1 select-none pointer-events-none mr-2">
                <span className="text-slate-400 text-[10px] uppercase font-bold flex items-center gap-1"><span className="text-lg leading-none">&larr;</span> Отмена</span>
                <span className="text-slate-400 text-[10px] uppercase font-bold flex items-center gap-1">Замок <span className="text-lg leading-none">&uarr;</span></span>
              </div>
            ) : (
              <div className="flex items-center justify-center flex-grow min-w-0 overflow-hidden">
                {recordPreviewUrl && (
                  <audio ref={previewAudioRef as any} src={recordPreviewUrl} onEnded={() => {}} className="hidden" />
                )}
                {isRecordPaused ? (
                  <div className="flex items-center gap-2 bg-slate-800/50 py-1 px-3 rounded-full flex-grow mx-2 min-w-0">
                    <button
                      onClick={onPlayPreview}
                      className="text-primary hover:scale-105 transition flex-shrink-0"
                    >
                      {isRecordPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
                    </button>

                    <div className="flex items-center gap-0.5 h-6 flex-grow overflow-hidden justify-center opacity-70">
                      {(function () {
                        const bars = 30;
                        let displayWave = [];
                        if (recordWaveHistory.length <= bars) {
                          displayWave = [...recordWaveHistory];
                        } else {
                          const step = recordWaveHistory.length / bars;
                          for (let i = 0; i < bars; i++) {
                            const start = Math.floor(i * step);
                            const end = Math.floor((i + 1) * step);
                            const chunk = recordWaveHistory.slice(start, end);
                            const avg = chunk.length > 0 ? chunk.reduce((a, b) => a + b, 0) / chunk.length : 0;
                            displayWave.push(avg);
                          }
                        }
                        const maxVol = Math.max(...displayWave, 50);

                        return displayWave.map((vol, idx) => {
                          const isActive = idx < Math.floor(recordPreviewProgress * displayWave.length);
                          return (
                            <div
                              key={idx}
                              className={'w-[3px] min-w-[3px] rounded-[2px] transition-all ' + (isActive ? 'bg-primary' : 'bg-slate-400')}
                              style={{ height: Math.max(10, Math.min(100, (vol / maxVol) * 100)) + '%' }}
                            />
                          );
                        });
                      })()}
                    </div>

                    <span className="text-slate-300 font-mono font-bold tracking-widest text-sm flex-shrink-0">
                      {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:{(recordingDuration % 60).toString().padStart(2, '0')}
                    </span>
                    <div className="w-px h-5 bg-slate-700 flex-shrink-0" />
                    <button onClick={onResumeRecording} className="text-slate-400 hover:text-red-400 transition flex items-center flex-shrink-0">
                      <Mic className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 w-full max-w-[150px] mx-auto">
                    <button onClick={onPauseRecording} className="text-red-400 hover:text-red-300 transition p-1 bg-red-400/10 rounded-full flex-shrink-0">
                      <Pause className="w-5 h-5 fill-current" />
                    </button>
                    <span className="text-red-400 font-mono font-bold tracking-widest text-sm">
                      {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:{(recordingDuration % 60).toString().padStart(2, '0')}
                    </span>
                    <div className="flex items-center gap-0.5 h-6 flex-grow overflow-hidden justify-end">
                      {(function () {
                        const displayWave = recordWaveHistory.slice(-30);
                        const maxVol = Math.max(...recordWaveHistory, 50);
                        return displayWave.map((vol, idx) => (
                          <div
                            key={idx}
                            className="w-[3px] min-w-[3px] bg-red-400 rounded-[2px] transition-all"
                            style={{ height: Math.max(10, Math.min(100, (vol / maxVol) * 100)) + '%' }}
                          />
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <textarea
          ref={inputRef}
          rows={1}
          value={inputText}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="Сообщение..."
          className="flex-grow bg-slate-950 border border-slate-850 text-slate-200 rounded-2xl px-4 py-2.5 text-base focus:border-primary outline-none max-h-[120px] resize-none overflow-y-auto leading-[20px] min-h-[42px]"
        />

        {inputText.trim() || isRecordLocked ? (
          <button
            onClick={() => isRecordLocked ? onForceStop() : onSend()}
            className="w-11 h-11 rounded-full bg-primary text-white flex items-center justify-center active:scale-95 transition-all shadow-lg shadow-primary/10 focus:outline-none z-30 flex-shrink-0"
          >
            <Send className="w-5 h-5 transform rotate-[-15deg] translate-x-[-1px] translate-y-[1px]" />
          </button>
        ) : (
          <button
            onMouseDown={onStartRecording as any}
            onTouchStart={onStartRecording as any}
            onMouseUp={onStopRecording}
            onTouchEnd={onStopRecording}
            onTouchMove={onMicTouchMove as any}
            onMouseMove={(e: any) => {}}
            style={{ transform: 'scale(' + micPulseScale + ')' }}
            className={'w-11 h-11 rounded-full border text-slate-300 flex items-center justify-center transition shadow-lg focus:outline-none touch-none select-none z-30 flex-shrink-0 ' + (isRecording ? 'bg-red-500 border-red-500 text-white shadow-red-500/20' : 'bg-slate-900 border-slate-800 active:bg-slate-800')}
          >
            <Mic className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}

