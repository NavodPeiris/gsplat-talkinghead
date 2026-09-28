import * as ort from 'onnxruntime-web';
import { loadWav2ArkitModel } from './modelLoader';
import type { LoadWav2ArkitModelOptions } from './modelLoader';

// Must match the installed onnxruntime-web version so the WASM binaries
// fetched from the CDN match the JS glue bundled into this package.
const ONNXRUNTIME_WEB_VERSION = '1.29.0';

let wasmConfigured = false;
function ensureWasmConfigured(): void {
  if (wasmConfigured) return;
  // Load WASM binaries from a CDN rather than requiring downstream bundlers
  // to copy onnxruntime-web's static assets — keeps this a zero-config peer.
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNXRUNTIME_WEB_VERSION}/dist/`;
  ort.env.wasm.numThreads = 1; // avoids requiring cross-origin-isolation headers for multi-threaded WASM
  // Without this, every session.run() call blocks the main JS thread for
  // its full duration — verified directly: 0 requestAnimationFrame callbacks
  // fired during ~650ms of inference without proxy, vs. a full ~60fps with
  // it. That's exactly what stalls the Gaussian-splat renderer's own render
  // loop and makes both body animation and lipsync look like slow motion.
  // Runs the WASM computation in a dedicated Worker instead.
  ort.env.wasm.proxy = true;
  wasmConfigured = true;
}

/** Model load state, for showing download progress in the UI. */
export interface Wav2ArkitLoadState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** 0–1 download progress; stays 0 when the model comes from the browser cache. */
  progress: number;
}

export interface Wav2ArkitEngineOptions extends LoadWav2ArkitModelOptions {
  /** Output frame rate the model was trained/exported at. Defaults to 30. */
  fps?: number;
}

/** Client-side wav2arkit inference: raw mono audio (16kHz) -> ARKit blendshape frames. */
export class Wav2ArkitEngine {
  private sessionPromise: Promise<ort.InferenceSession> | null = null;
  private inputName = '';
  private outputName = '';
  private fps: number;
  private options: Wav2ArkitEngineOptions;
  // onnxruntime-web's WASM session handler isn't reentrant — a second
  // `session.run()` call while one is still in flight throws "Session
  // already started". All run() calls (including from multiple
  // Wav2ArkitLipsync instances sharing this engine) are serialized through
  // this queue instead of relying on callers to coordinate.
  private runQueue: Promise<unknown> = Promise.resolve();
  private load: Wav2ArkitLoadState = { status: 'idle', progress: 0 };
  private loadListeners = new Set<(state: Wav2ArkitLoadState) => void>();

  constructor(options: Wav2ArkitEngineOptions = {}) {
    this.options = options;
    this.fps = options.fps ?? 30;
  }

  /** Current model load state. */
  public get loadState(): Wav2ArkitLoadState {
    return this.load;
  }

  /** Calls `listener` now and on every load-state change; returns an unsubscribe function. */
  public subscribeToLoadState(listener: (state: Wav2ArkitLoadState) => void): () => void {
    this.loadListeners.add(listener);
    listener(this.load);
    return () => {
      this.loadListeners.delete(listener);
    };
  }

  private setLoad(state: Wav2ArkitLoadState): void {
    this.load = state;
    this.loadListeners.forEach((l) => l(state));
  }

  private getSession(): Promise<ort.InferenceSession> {
    if (!this.sessionPromise) {
      ensureWasmConfigured();
      this.setLoad({ status: 'loading', progress: 0 });
      this.sessionPromise = (async () => {
        const { model, externalData } = await loadWav2ArkitModel({
          ...this.options,
          onModelDownloadProgress: (progress) => {
            this.setLoad({ status: 'loading', progress });
            this.options.onModelDownloadProgress?.(progress);
          },
        });
        const session = await ort.InferenceSession.create(model, {
          executionProviders: ['wasm'],
          externalData: [{ path: 'wav2arkit_cpu.onnx.data', data: externalData }],
        });
        this.inputName = session.inputNames[0];
        this.outputName = session.outputNames[0];
        this.setLoad({ status: 'ready', progress: 1 });
        return session;
      })().catch((err) => {
        // Deliberately NOT reset to null: this is hit from a ~200ms polling
        // loop (see liveLipsync.ts), and retrying a failed multi-hundred-MB
        // download every chunk would hammer the network. Caching the
        // rejection means callers fail fast instead. Reload the page (or
        // construct a new engine) to retry.
        console.error('[gsplat-talkinghead] Failed to load wav2arkit lipsync model:', err);
        this.setLoad({ status: 'error', progress: this.load.progress });
        throw err;
      });
    }
    return this.sessionPromise;
  }

  /**
   * Triggers the (large, one-time) model download and session creation,
   * then runs one throwaway inference to pay WASM JIT/compilation cost
   * ahead of the first real audio chunk — this used to race with the first
   * real `run()` call and crash ("Session already started"); now safe
   * since all `run()` calls are serialized through `runQueue`, so this
   * queues ahead of it instead of racing it.
   */
  public async warmup(): Promise<void> {
    await this.getSession();
    try {
      await this.run(new Float32Array(16000)); // 1s of silence @ 16kHz
    } catch {
      // A real failure here will be surfaced properly by the first real call.
    }
  }

  /** Runs inference on a chunk of mono float32 audio already resampled to 16kHz. */
  public async run(audio16k: Float32Array): Promise<Float32Array[]> {
    const session = await this.getSession();
    // Chain onto the queue regardless of the previous entry's outcome, so
    // one failed run doesn't permanently jam the queue for later chunks.
    const result = this.runQueue.then(
      () => this.runRaw(session, audio16k),
      () => this.runRaw(session, audio16k),
    );
    this.runQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async runRaw(session: ort.InferenceSession, audio16k: Float32Array): Promise<Float32Array[]> {
    const tensor = new ort.Tensor('float32', audio16k, [1, audio16k.length]);
    const outputs = await session.run({ [this.inputName]: tensor });
    const output = outputs[this.outputName];
    const dims = output.dims;
    const seqLen = dims[dims.length - 2];
    const numBlendshapes = dims[dims.length - 1];
    const data = output.data as Float32Array;

    const expectedFrames = Math.round((audio16k.length / 16000) * this.fps);
    const frameCount = Math.min(seqLen, expectedFrames || seqLen);

    const frames: Float32Array[] = [];
    for (let i = 0; i < frameCount; i++) {
      frames.push(data.subarray(i * numBlendshapes, (i + 1) * numBlendshapes));
    }
    return frames;
  }
}

let sharedEngine: Wav2ArkitEngine | null = null;

/** Returns a shared engine instance so the (large) model is only fetched/initialized once per page. */
export function getSharedWav2ArkitEngine(options: Wav2ArkitEngineOptions = {}): Wav2ArkitEngine {
  if (!sharedEngine) sharedEngine = new Wav2ArkitEngine(options);
  return sharedEngine;
}
