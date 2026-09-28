import { ARKIT_BLENDSHAPE_NAMES, applyMouthGain, createNeutralWeights } from '../../constants/arkit';
import { resampleTo16k } from './resample';
import { getSharedWav2ArkitEngine } from './inferenceEngine';
import type { Wav2ArkitEngineOptions } from './inferenceEngine';

// Audio window sent to the model per inference call. Smaller means less
// latency (both the wait for the next capture tick and the inference call
// itself scale with this), at the cost of less acoustic context per call.
// Tried 100ms to cut latency (200ms measurably lagged behind short opening
// words like "Hi" after a pause) — but the shorter window measurably hurt
// blendshape accuracy (less audio context per model call), so reverted to
// 200ms: correct mouth shapes matter more than shaving latency off the
// first word or two. Revisit only alongside a real accuracy check if you
// change this again.
const CHUNK_MS = 200;
const FRAME_MS = 1000 / 30; // pacing clock the decoded frames are drawn out at
// Caps how far the visible mouth can lag behind real audio. If inference
// falls behind, older undelivered frames are dropped rather than played
// back later — a fixed small lag beats an ever-growing one.
const MAX_QUEUED_FRAMES = 9; // ~300ms at 30fps
// Push-mode (see `pushAudio`) safety cap: if the caller hands us audio
// faster than we can infer on it, drop the oldest unprocessed samples
// instead of accumulating an unbounded backlog.
const MAX_PUSH_BUFFER_CHUNKS = 3;

function nextPowerOfTwo(n: number): number {
  let p = 32;
  while (p < n && p < 32768) p *= 2;
  return p;
}

// How many consecutive silent capture chunks (each CHUNK_MS) before
// considering the agent to have stopped speaking. Requires silence to
// persist briefly so natural micro-pauses within a sentence don't flicker
// the chat state.
const SILENCE_TO_IDLE_CHUNKS = 4; // ~800ms

// How many consecutive silent capture chunks before skipping inference
// entirely and forcing a true neutral frame. The model doesn't output
// exactly zero for silence — it has a small, slightly noisy "floor" that
// otherwise reads as visible mouth flicker with no audio driving it.
// Shorter than SILENCE_TO_IDLE_CHUNKS since a brief stop-consonant pause
// (<400ms) shouldn't visibly reset the mouth, but real silence should
// clear the flicker quickly.
const SILENCE_GATE_CHUNKS = 2; // ~400ms
const SILENCE_PEAK_THRESHOLD = 0.001;
const SILENCE_WARNING_CHUNKS = Math.round(3000 / CHUNK_MS); // 3s of captured silence

export interface Wav2ArkitLipsyncOptions extends Wav2ArkitEngineOptions {
  onFrame: (weights: Record<string, number>) => void;
  /** Called whenever the tapped audio transitions between speaking and silent. */
  onSpeakingChange?: (speaking: boolean) => void;
}

/**
 * Runs the shared wav2arkit ONNX engine on rolling ~200ms audio windows and
 * paces the decoded ARKit blendshape frames out at ~30fps via `onFrame`.
 * Two input modes, both feeding the same inference/pacing pipeline:
 *  - `start(stream)` taps a `MediaStream` via an AnalyserNode (OpenAI, Vapi,
 *    LiveKit).
 *  - `pushAudio(samples, sampleRate)` accepts already-decoded PCM directly,
 *    for adapters that never produce a MediaStream.
 * One instance per active session — safe to run several concurrently (e.g.
 * multiple avatars on one page), since only the underlying model session is
 * shared (and its `run()` calls are internally serialized).
 */
export class Wav2ArkitLipsync {
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private readonly engine: ReturnType<typeof getSharedWav2ArkitEngine>;

  private chunkSamples = 0;
  private timeDomainBuffer: Float32Array = new Float32Array(0);
  private frameQueue: Record<string, number>[] = [];
  private lastFrame: Record<string, number> | null = null;
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private paceTimer: ReturnType<typeof setInterval> | null = null;
  private inferInFlight = false;
  private warmedUp = false;
  private loggedRunError = false;
  private silentChunkStreak = 0;
  private loggedSilence = false;
  private isSpeaking = false;

  // Always holds only the MOST RECENTLY captured (not-yet-processed) audio
  // window. A new capture overwrites it — if inference is behind, we
  // process the freshest audio available rather than working through a
  // backlog of increasingly stale windows.
  private pendingChunk: Float32Array | null = null;
  private pendingSampleRate = 0;

  // ── Push-mode state (see `pushAudio`) ──────────────────────────────────
  private pushBuffer: number[] = [];
  private pushSampleRate = 0;
  private pushChunkSamples = 0;

  // Cached, never-mutated fallback pushed during confirmed silence instead
  // of running inference (see SILENCE_GATE_CHUNKS).
  private readonly neutralFrame = createNeutralWeights();

  constructor(private readonly options: Wav2ArkitLipsyncOptions) {
    this.engine = getSharedWav2ArkitEngine(options);
  }

  private ensureWarmup(): void {
    if (this.warmedUp) return;
    this.warmedUp = true;
    // Fire-and-forget: kicks off the model download/session creation as
    // early as possible instead of waiting for the first real audio chunk.
    this.engine.warmup().catch(() => {
      // Surfaced (once) by the first real inference call instead.
    });
  }

  private ensurePaceTimer(): void {
    if (this.paceTimer) return;
    this.paceTimer = setInterval(() => this.tick(), FRAME_MS);
  }

  /** Taps a `MediaStream` via an AnalyserNode. */
  public start(stream: MediaStream): void {
    if (this.audioCtx) return; // already running

    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new AudioContextCtor({ latencyHint: 'interactive' });
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

    this.chunkSamples = Math.round((CHUNK_MS / 1000) * this.audioCtx.sampleRate);
    const fftSize = nextPowerOfTwo(this.chunkSamples);
    this.timeDomainBuffer = new Float32Array(fftSize);

    this.sourceNode = this.audioCtx.createMediaStreamSource(stream);
    this.analyserNode = this.audioCtx.createAnalyser();
    this.analyserNode.fftSize = fftSize;
    this.sourceNode.connect(this.analyserNode);

    // Always captures on a fixed cadence — never skipped, so a slow
    // inference doesn't cause audio windows to be missed entirely.
    this.captureTimer = setInterval(() => this.captureChunk(), CHUNK_MS);
    this.ensurePaceTimer();
    this.ensureWarmup();
  }

  private captureChunk(): void {
    if (!this.analyserNode) return;
    this.analyserNode.getFloatTimeDomainData(this.timeDomainBuffer as unknown as Float32Array<ArrayBuffer>);
    this.pendingChunk = this.timeDomainBuffer.slice(this.timeDomainBuffer.length - this.chunkSamples);
    this.pendingSampleRate = this.audioCtx?.sampleRate ?? 48000;

    // Diagnostic: if the tapped audio graph is producing only silence for
    // an extended stretch, the analyser likely isn't actually receiving
    // the agent's audio (e.g. a stale/disconnected MediaStream tap) —
    // surface that distinctly from "inference isn't running at all".
    let peak = 0;
    for (let i = 0; i < this.pendingChunk.length; i++) {
      const abs = Math.abs(this.pendingChunk[i]);
      if (abs > peak) peak = abs;
    }
    if (peak < SILENCE_PEAK_THRESHOLD) {
      this.silentChunkStreak++;
    } else {
      this.silentChunkStreak = 0;
      this.loggedSilence = false;
    }
    if (this.silentChunkStreak >= SILENCE_WARNING_CHUNKS && !this.loggedSilence) {
      this.loggedSilence = true;
      console.warn(
        '[gsplat-talkinghead] wav2arkit lipsync: captured audio has been silent for 3s+ — ' +
          'if the agent is actually speaking, the tapped MediaStream is likely stale or not carrying real audio.',
      );
    }

    // ChatState (body animation) tracks real audio activity, not just
    // "is a session connected" — otherwise it gets set once and never
    // reverts to Idle during natural pauses within a single long-lived
    // stream (e.g. Vapi keeps one MediaStream alive for the whole call).
    const shouldSpeak = this.silentChunkStreak === 0;
    const shouldIdle = this.silentChunkStreak >= SILENCE_TO_IDLE_CHUNKS;
    if (shouldSpeak && !this.isSpeaking) {
      this.isSpeaking = true;
      this.options.onSpeakingChange?.(true);
    } else if (shouldIdle && this.isSpeaking) {
      this.isSpeaking = false;
      this.options.onSpeakingChange?.(false);
    }

    // Noise gate: on confirmed silence, skip inference entirely (saving
    // compute) and push the true neutral pose instead of letting the
    // model's noisy near-silence "floor" flicker through.
    if (this.silentChunkStreak >= SILENCE_GATE_CHUNKS) {
      this.pendingChunk = null;
      this.frameQueue.push(this.neutralFrame);
      if (this.frameQueue.length > MAX_QUEUED_FRAMES) {
        this.frameQueue.splice(0, this.frameQueue.length - MAX_QUEUED_FRAMES);
      }
      return;
    }

    this.maybeProcessPending();
  }

  /** Starts inference on the freshest captured/pushed audio, if the engine is free. */
  private maybeProcessPending(): void {
    if (this.inferInFlight || !this.pendingChunk) return;
    const chunk = this.pendingChunk;
    const sampleRate = this.pendingSampleRate;
    this.pendingChunk = null;
    void this.runInference(chunk, sampleRate);
  }

  /**
   * Feeds already-decoded PCM samples directly into the pipeline, for
   * adapters that decode raw audio themselves and never produce a
   * MediaStream. Safe to call repeatedly with irregularly-sized chunks.
   */
  public pushAudio(samples: Float32Array, sampleRate: number): void {
    if (this.pushSampleRate !== sampleRate) {
      this.pushSampleRate = sampleRate;
      this.pushChunkSamples = Math.max(1, Math.round((CHUNK_MS / 1000) * sampleRate));
      this.pushBuffer = [];
    }
    for (let i = 0; i < samples.length; i++) this.pushBuffer.push(samples[i]);

    // Bound the backlog: if audio arrives faster than we can process it,
    // drop the oldest excess rather than falling further and further behind.
    const maxBuffered = this.pushChunkSamples * MAX_PUSH_BUFFER_CHUNKS;
    if (this.pushBuffer.length > maxBuffered) {
      this.pushBuffer.splice(0, this.pushBuffer.length - maxBuffered);
    }

    if (!this.inferInFlight && this.pushBuffer.length >= this.pushChunkSamples) {
      this.pendingChunk = new Float32Array(this.pushBuffer.splice(0, this.pushChunkSamples));
      this.pendingSampleRate = sampleRate;
      this.maybeProcessPending();
    }

    this.ensurePaceTimer();
    this.ensureWarmup();
  }

  private async runInference(chunk: Float32Array, sampleRate: number): Promise<void> {
    this.inferInFlight = true;
    try {
      const resampled = await resampleTo16k(chunk, sampleRate);
      const frames = await this.engine.run(resampled);
      for (const frame of frames) {
        const weights: Record<string, number> = {};
        for (let i = 0; i < ARKIT_BLENDSHAPE_NAMES.length; i++) {
          weights[ARKIT_BLENDSHAPE_NAMES[i]] = frame[i] ?? 0;
        }
        // The model's raw mouth/jaw output is empirically too subtle to
        // read as visible movement (verified: real speech peaks around
        // jawOpen≈0.13) — amplify before handing off to the renderer.
        const gained = applyMouthGain(weights);
        this.frameQueue.push(gained);
      }
      // Trim from the front so we always play back the most recent frames —
      // an unbounded queue is exactly what turns transient slowness into
      // ever-growing lag.
      if (this.frameQueue.length > MAX_QUEUED_FRAMES) {
        this.frameQueue.splice(0, this.frameQueue.length - MAX_QUEUED_FRAMES);
      }
    } catch (err) {
      // Drop this window on inference failure; the pacing clock holds the
      // last good frame (or neutral pose, if none has arrived yet) and the
      // next chunk will retry. Log only once — this loop can run every
      // ~200ms and a persistent failure (e.g. model load error) would
      // otherwise spam the console indefinitely.
      if (!this.loggedRunError) {
        this.loggedRunError = true;
        console.warn('[gsplat-talkinghead] wav2arkit lipsync inference failed — mouth will stay in neutral pose:', err);
      }
    } finally {
      this.inferInFlight = false;
      // Pick up any newer audio captured/pushed while we were busy,
      // immediately rather than waiting for the next timer tick.
      this.maybeProcessPending();
    }
  }

  private tick(): void {
    const next = this.frameQueue.shift();
    if (next) {
      this.lastFrame = next;
      this.options.onFrame(next);
    } else if (this.lastFrame) {
      this.options.onFrame(this.lastFrame);
    }
  }

  public stop(): void {
    if (this.captureTimer) clearInterval(this.captureTimer);
    if (this.paceTimer) clearInterval(this.paceTimer);
    this.captureTimer = null;
    this.paceTimer = null;

    this.sourceNode?.disconnect();
    this.analyserNode?.disconnect();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close();
    }
    this.audioCtx = null;
    this.sourceNode = null;
    this.analyserNode = null;
    this.frameQueue = [];
    this.lastFrame = null;
    this.pendingChunk = null;
    this.pushBuffer = [];
    this.pushSampleRate = 0;
  }
}
