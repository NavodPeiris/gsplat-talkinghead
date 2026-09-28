// Default source: the public, Apache-2.0-licensed wav2arkit_cpu ONNX model.
// https://huggingface.co/myned-ai/wav2arkit_cpu
const DEFAULT_MODEL_BASE_URL = 'https://huggingface.co/myned-ai/wav2arkit_cpu/resolve/main';
const CACHE_NAME = 'gsplat-talkinghead-wav2arkit-v1';

export interface Wav2ArkitModelBytes {
  /** The ONNX graph file (`wav2arkit_cpu.onnx`). */
  model: ArrayBuffer;
  /** The model's external tensor data file (`wav2arkit_cpu.onnx.data`). */
  externalData: ArrayBuffer;
}

async function fetchAndCache(url: string, onProgress?: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) return await cached.arrayBuffer();
    } catch {
      // Cache Storage unavailable (private browsing, disabled, etc.) — fall through to a plain fetch.
    }
  }

  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`[gsplat-talkinghead] Failed to download wav2arkit model asset: ${url} (${response.status})`);
  }

  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(url, response.clone());
    } catch {
      // Non-fatal — proceed without caching.
    }
  }

  if (!onProgress || !response.body) {
    return response.arrayBuffer();
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

export interface LoadWav2ArkitModelOptions {
  /** Base URL directory containing `wav2arkit_cpu.onnx` and `wav2arkit_cpu.onnx.data`. Override to self-host. */
  modelBaseUrl?: string;
  /** Called with overall 0-1 download progress across both files. */
  onModelDownloadProgress?: (progress: number) => void;
}

/** Downloads (or reads from the Cache Storage) the wav2arkit ONNX model and its external data file. */
export async function loadWav2ArkitModel(options: LoadWav2ArkitModelOptions = {}): Promise<Wav2ArkitModelBytes> {
  const baseUrl = options.modelBaseUrl ?? DEFAULT_MODEL_BASE_URL;
  const modelUrl = `${baseUrl}/wav2arkit_cpu.onnx`;
  const dataUrl = `${baseUrl}/wav2arkit_cpu.onnx.data`;

  let modelLoaded = 0;
  let dataLoaded = 0;
  let modelTotal = 0;
  let dataTotal = 0;
  const reportProgress = () => {
    const total = modelTotal + dataTotal;
    if (total <= 0) return;
    const progress = Math.min(1, (modelLoaded + dataLoaded) / total);

    options.onModelDownloadProgress?.(progress);
  };

  const [model, externalData] = await Promise.all([
    fetchAndCache(modelUrl, (loaded, total) => {
      modelLoaded = loaded;
      modelTotal = total;
      reportProgress();
    }),
    fetchAndCache(dataUrl, (loaded, total) => {
      dataLoaded = loaded;
      dataTotal = total;
      reportProgress();
    }),
  ]);

  return { model, externalData };
}
