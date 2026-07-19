let embeddingPipeline: any = null;

export async function getEmbeddingPipeline(progressCallback?: (percent: number) => void) {
  if (embeddingPipeline) return embeddingPipeline;

  const { pipeline, env } = await import('@xenova/transformers');
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  const modelName = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

  embeddingPipeline = await pipeline('feature-extraction', modelName, {
    quantized: true,
    progress_callback: (data: any) => {
      if (data.status === 'progress' && progressCallback) {
        const percent = Math.round((data.loaded / data.total) * 100);
        progressCallback(percent);
      }
    },
  });

  return embeddingPipeline;
}

export function getCachedEmbeddingPipeline() {
  return embeddingPipeline;
}
