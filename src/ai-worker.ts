import { pipeline, env } from '@xenova/transformers';

// Configure transformers environment for browser execution
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;

let whisperModel: any = null;
let currentModelName = 'Xenova/whisper-tiny';
const downloadTracker: Record<string, { loaded: number; total: number }> = {};

async function initWhisper() {
  if (whisperModel) return;

  self.postMessage({ type: 'progress', percent: 0 });

  whisperModel = await pipeline('automatic-speech-recognition', currentModelName, {
    quantized: true,
    progress_callback: (data: any) => {
      if (data.status === 'progress') {
        downloadTracker[data.file] = { loaded: data.loaded, total: data.total };
        let totalLoaded = 0;
        let totalExpected = 0;
        for (const key in downloadTracker) {
          totalLoaded += downloadTracker[key].loaded || 0;
          totalExpected += downloadTracker[key].total || 0;
        }
        if (totalExpected > 0) {
          const percent = Math.round((totalLoaded / totalExpected) * 100);
          self.postMessage({ type: 'progress', percent: percent });
        }
      }
    },
  });

  self.postMessage({ type: 'ready' });
}

self.onmessage = async (event) => {
  const msg = event.data;

  if (msg.type === 'init') {
    if (msg.model) currentModelName = msg.model;
    initWhisper().catch((e) => self.postMessage({ type: 'error', error: e.message }));
  } else if (msg.type === 'change_model') {
    if (currentModelName !== msg.model) {
      currentModelName = msg.model;
      whisperModel = null;
    }
  } else if (msg.type === 'force_download') {
    whisperModel = null;
    for (const prop of Object.getOwnPropertyNames(downloadTracker)) {
      delete downloadTracker[prop];
    }
    initWhisper().catch((e) => self.postMessage({ type: 'error', error: e.message }));
  } else if (msg.type === 'transcribe') {
    try {
      if (!whisperModel) await initWhisper();
      const output = await whisperModel(msg.audioData, { language: 'russian', task: 'transcribe' });
      self.postMessage({ type: 'result', text: output.text, id: msg.id });
    } catch (e: any) {
      self.postMessage({ type: 'error', error: e.message, id: msg.id });
    }
  }
};
