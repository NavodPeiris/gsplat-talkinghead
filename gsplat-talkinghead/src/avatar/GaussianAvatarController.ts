import * as GaussianSplats3D from '@myned-ai/gsplat-flame-avatar-renderer';
import { createNeutralWeights } from '../constants/arkit';
import type { ChatState } from '../types';
import { withTransparentCanvas } from './transparentCanvas';
import { EMOTION_BLENDSHAPES, type AvatarEmotion } from './emotions';

// Blink patterns matching wav2arkit's own reference blink shapes (7 frames each)
const BLINK_PATTERNS = [
  [0.1, 0.3, 0.7, 1.0, 0.7, 0.3, 0.1],
  [0.15, 0.4, 0.8, 1.0, 0.6, 0.25, 0.1],
  [0.1, 0.35, 0.75, 1.0, 0.75, 0.35, 0.1],
  [0.2, 0.5, 0.9, 1.0, 0.7, 0.3, 0.05],
];

// Blink intervals per state (min, max) in milliseconds
const BLINK_INTERVALS: Record<ChatState, [number, number]> = {
  Idle: [2000, 4000], // Relaxed: 2-4 seconds
  Responding: [1300, 3300], // Speaking: natural rate
};

// How quickly the face eases into a new emotion (fraction of the remaining
// gap closed per second, frame-rate independent). ~0.35 s to mostly settle.
const EMOTION_EASE_PER_SEC = 8;

// Subtle procedural head motion while speaking (radians). Layered sines at
// unrelated frequencies so it never visibly loops, plus a small nod that
// follows mouth openness. Fades in/out over ~0.5 s.
const DEG = Math.PI / 180;
const HEAD_SWAY = {
  yaw: 1.5 * DEG,
  pitch: 1.0 * DEG,
  roll: 0.8 * DEG,
  speechNod: 1.0 * DEG,
  easePerSec: 4,
};

// Where the bust sits in the bundle camera's default view, as fractions of
// the view height (vertical framing doesn't depend on canvas aspect).
const BUST_FRAME = { centerY: 0.47, height: 0.44 };

interface PerspectiveCameraLike {
  isPerspectiveCamera?: boolean;
  aspect: number;
  setViewOffset(fullWidth: number, fullHeight: number, x: number, y: number, width: number, height: number): void;
}

export interface Disposable {
  dispose(): void;
}

/**
 * Interface any avatar controller must implement to integrate with
 * `AvatarAgent` / `AvatarContainer`.
 */
export interface IAvatarController {
  updateBlendshapes(weights: Record<string, number>): void;
  setChatState(state: ChatState): void;
  getChatState(): ChatState;
  enableLiveBlendshapes(): void;
  disableLiveBlendshapes(): void;
  dispose(): void;
  pause?(): void;
  resume?(): void;
  /** Blend the face toward an emotion (0–1 intensity), on top of lipsync. */
  setEmotion?(emotion: AvatarEmotion, intensity?: number): void;
}

/**
 * GaussianAvatarController wraps `@myned-ai/gsplat-flame-avatar-renderer`.
 *
 * TWO animation systems work together:
 * 1. BODY ANIMATIONS — driven by ChatState ('Idle' | 'Responding'), handled
 *    internally by the renderer.
 * 2. FACIAL BLENDSHAPES — 52 ARKit blendshapes streamed in real time from
 *    the wav2arkit lipsync engine via `updateBlendshapes`.
 *
 * Blinking is owned entirely by the client (this class) and always
 * overrides any blink values present in incoming blendshape frames.
 */
export class GaussianAvatarController implements IAvatarController, Disposable {
  private _container: HTMLDivElement;
  private _assetsPath: string;
  private _backgroundColor?: string;
  private _onLoadProgress?: (progress: number) => void;
  public curState: ChatState = 'Idle';
  private _renderer: GaussianSplats3D.GaussianSplatRenderer | null = null;
  private forceEyesClosed = false;
  private liveBlendshapeData: Record<string, number> | null = null;
  private isPaused = false;
  private neutralBlendshapes: Record<string, number>;

  // Blink state (applies in every ChatState, not just idle)
  private lastBlinkTime = 0;
  private nextBlinkInterval = 2000;
  private blinkFrame = -1; // -1 = not blinking, 0-6 = blink frame
  private currentBlinkPattern: number[] = BLINK_PATTERNS[0];
  private blinkIntensity = 1.0;
  private lastBlinkFrameTime = 0;

  // Emotion: target offsets and the currently shown (eased) offsets.
  private emotionTarget: Record<string, number> = {};
  private emotionCurrent: Record<string, number> = {};
  private lastEmotionTime = 0;

  // Head sway while speaking.
  private swayAmount = 0; // 0–1 envelope
  private swayMouth = 0; // smoothed jawOpen, drives the speech nod
  private lastSwayTime = 0;
  private readonly swayPhase = [Math.random(), Math.random(), Math.random(), Math.random()].map((p) => p * Math.PI * 2);
  // Bone the sway rotates: resolved once from the rig ('neck' on FLAME, else 'head'); null = unsupported.
  private swayBone: string | null | undefined = undefined;

  constructor(
    container: HTMLDivElement,
    assetsPath: string,
    options: { backgroundColor?: string; onLoadProgress?: (progress: number) => void } = {},
  ) {
    if (!container || !assetsPath) {
      throw new Error('GaussianAvatarController requires a container element and an assetsPath');
    }
    this._container = container;
    this._assetsPath = assetsPath;
    this._backgroundColor = options.backgroundColor;
    this._onLoadProgress = options.onLoadProgress;
    this.neutralBlendshapes = createNeutralWeights();
  }

  public async start(): Promise<void> {
    const create = () =>
      GaussianSplats3D.GaussianSplatRenderer.getInstance(this._container, this._assetsPath, {
        getChatState: this.getRendererBodyState.bind(this),
        getExpressionData: this.getArkitFaceFrame.bind(this),
        getNeckPose: this.getHeadSway.bind(this),
        backgroundColor: this._backgroundColor,
        loadProgress: this._onLoadProgress,
      });
    // No explicit color → render transparently so `backgroundImages` (or
    // whatever the host page has behind the avatar) shows through.
    this._renderer = this._backgroundColor ? await create() : await withTransparentCanvas(this._container, create);
    this.frameBust();
  }

  /**
   * The bundle's camera leaves a lot of empty scene around the head and
   * shoulders. Crop the camera's view to just the bust (via a view offset,
   * so the splat focal length follows) so it fills the window.
   */
  private frameBust(): void {
    const camera = this._renderer?.viewer?.camera as unknown as PerspectiveCameraLike | undefined;
    if (!camera?.isPerspectiveCamera) return;
    const zoom = 1 / BUST_FRAME.height;
    const aspect = camera.aspect;
    // Units are arbitrary — three.js only uses these as ratios, so the crop
    // survives the viewer's own aspect updates on resize.
    camera.setViewOffset(
      aspect * zoom,
      zoom,
      (aspect * zoom - aspect) / 2,
      BUST_FRAME.centerY * zoom - 0.5,
      aspect,
      1,
    );
  }

  /** Forces the avatar's eyes closed, overriding blink logic. */
  public closeEyes(): void {
    this.forceEyesClosed = true;
  }

  /** Pause animation — returns the neutral pose. */
  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    this.isPaused = false;
  }

  public getChatState(): ChatState {
    return this.curState;
  }

  /**
   * Body-animation state reported to the renderer. Always `Idle`: in
   * `Responding` the renderer cycles the bundle's full-body "speak" gesture
   * clips, which sway the whole avatar while it talks. Speech is conveyed by
   * the lipsync-driven face alone; `curState` still tracks speaking so
   * blinking keeps its speaking rhythm.
   */
  private getRendererBodyState(): ChatState {
    return 'Idle';
  }

  /**
   * Per-frame head rotation delta (on top of the idle clip) for a very small
   * sway while speaking — the body stays still. Returns null when there's
   * nothing to add, so the baked animation is untouched.
   */
  private getHeadSway(): Record<string, [number, number, number]> | null {
    const bone = this.resolveSwayBone();
    if (!bone) return null;

    const now = performance.now();
    const dt = this.lastSwayTime ? Math.min(0.1, (now - this.lastSwayTime) / 1000) : 0;
    this.lastSwayTime = now;

    const speaking = this.curState === 'Responding' && !this.isPaused;
    const ease = 1 - Math.exp(-HEAD_SWAY.easePerSec * dt);
    this.swayAmount += ((speaking ? 1 : 0) - this.swayAmount) * ease;
    const jaw = this.liveBlendshapeData?.jawOpen ?? 0;
    this.swayMouth += (jaw - this.swayMouth) * (1 - Math.exp(-10 * dt));
    if (this.swayAmount < 0.002) return null;

    const t = now / 1000;
    const [p0, p1, p2, p3] = this.swayPhase;
    const a = this.swayAmount;
    const yaw = HEAD_SWAY.yaw * a * (0.6 * Math.sin(2 * Math.PI * 0.31 * t + p0) + 0.4 * Math.sin(2 * Math.PI * 0.53 * t + p1));
    const roll = HEAD_SWAY.roll * a * Math.sin(2 * Math.PI * 0.23 * t + p2);
    // jawOpen tops out around MOUTH_MAX (0.4) after gain, so /0.4 maps speech to 0–1.
    const nod = HEAD_SWAY.speechNod * a * Math.min(1, this.swayMouth / 0.4);
    const pitch = HEAD_SWAY.pitch * a * Math.sin(2 * Math.PI * 0.41 * t + p3) + nod;
    // Euler order is YXZ: [x = pitch, y = yaw, z = roll].
    return { [bone]: [pitch, yaw, roll] };
  }

  private resolveSwayBone(): string | null {
    if (this.swayBone !== undefined) return this.swayBone;
    // The renderer builds its bone map lazily from the loaded rig.
    const bones = (this._renderer as unknown as { _getOverridableBones?: () => Record<string, unknown> | null } | null)
      ?._getOverridableBones?.();
    if (!bones) return null; // rig not ready yet — try again next frame
    this.swayBone = 'neck' in bones ? 'neck' : 'head' in bones ? 'head' : null;
    return this.swayBone;
  }

  public setChatState(state: ChatState): void {
    this.curState = state;
  }

  public setEmotion(emotion: AvatarEmotion, intensity = 1): void {
    const offsets = EMOTION_BLENDSHAPES[emotion] ?? {};
    const k = Math.max(0, Math.min(1, intensity));
    this.emotionTarget = Object.fromEntries(Object.entries(offsets).map(([name, v]) => [name, (v ?? 0) * k]));
  }

  /** Kept for IAvatarController compatibility — blendshapes always stream once available. */
  public enableLiveBlendshapes(): void {
    // no-op: this controller always applies the latest pushed blendshapes.
  }

  public disableLiveBlendshapes(): void {
    this.liveBlendshapeData = null;
  }

  /** Push the latest blendshape frame from the wav2arkit lipsync engine. */
  public updateBlendshapes(weights: Record<string, number>): void {
    this.liveBlendshapeData = weights;
  }

  /**
   * Pulled by the renderer once per render frame.
   * Client-owned blinking always overrides any blink values in `weights`.
   */
  public getArkitFaceFrame(): Record<string, number> {
    if (this.isPaused) {
      return this.neutralBlendshapes;
    }

    const result: Record<string, number> = this.liveBlendshapeData
      ? { ...this.liveBlendshapeData }
      : { ...this.neutralBlendshapes };

    this.applyEmotion(result);

    if (this.forceEyesClosed) {
      result['eyeBlinkLeft'] = 1.0;
      result['eyeBlinkRight'] = 1.0;
      return result;
    }

    this.applyBlink(result);
    return result;
  }

  /** Eases the shown emotion toward its target and adds it to the frame. */
  private applyEmotion(blendshapes: Record<string, number>): void {
    const now = performance.now();
    const dt = this.lastEmotionTime ? Math.min(0.1, (now - this.lastEmotionTime) / 1000) : 0;
    this.lastEmotionTime = now;
    const t = 1 - Math.exp(-EMOTION_EASE_PER_SEC * dt);

    const names = new Set([...Object.keys(this.emotionTarget), ...Object.keys(this.emotionCurrent)]);
    for (const name of names) {
      const target = this.emotionTarget[name] ?? 0;
      const current = (this.emotionCurrent[name] ?? 0) + (target - (this.emotionCurrent[name] ?? 0)) * t;
      if (target === 0 && Math.abs(current) < 0.001) {
        delete this.emotionCurrent[name];
        continue;
      }
      this.emotionCurrent[name] = current;
      blendshapes[name] = Math.max(0, Math.min(1, (blendshapes[name] ?? 0) + current));
    }
  }

  private applyBlink(blendshapes: Record<string, number>): void {
    const now = performance.now();
    const [minInterval, maxInterval] = BLINK_INTERVALS[this.curState] ?? BLINK_INTERVALS.Idle;

    if (this.blinkFrame === -1) {
      if (now - this.lastBlinkTime >= this.nextBlinkInterval) {
        this.blinkFrame = 0;
        this.lastBlinkFrameTime = now;
        this.currentBlinkPattern = BLINK_PATTERNS[Math.floor(Math.random() * BLINK_PATTERNS.length)];
        this.blinkIntensity = 0.8 + Math.random() * 0.2;
        this.nextBlinkInterval = minInterval + Math.random() * (maxInterval - minInterval);
      }
    }

    if (this.blinkFrame >= 0 && this.blinkFrame < 7) {
      const blinkValue = this.currentBlinkPattern[this.blinkFrame] * this.blinkIntensity;
      blendshapes['eyeBlinkLeft'] = blinkValue;
      blendshapes['eyeBlinkRight'] = blinkValue;

      if (now - this.lastBlinkFrameTime >= 33) {
        this.blinkFrame++;
        this.lastBlinkFrameTime = now;

        if (this.blinkFrame >= 7) {
          this.blinkFrame = -1;
          this.lastBlinkTime = now;
        }
      }
    } else {
      blendshapes['eyeBlinkLeft'] = 0;
      blendshapes['eyeBlinkRight'] = 0;
    }
  }

  public dispose(): void {
    this.liveBlendshapeData = null;
    // Actually tear down the renderer (canvas, WebGL context, its own
    // internal render loop) — without this, disposing this wrapper left
    // the underlying GaussianSplatRenderer running indefinitely, which
    // (combined with React StrictMode's mount→cleanup→remount in dev)
    // could leave TWO renderer instances alive in the same container:
    // one frozen at whatever it last saw, another correctly receiving
    // updates but invisible behind/replaced by the frozen one.
    this._renderer?.dispose();
    this._renderer = null;
  }
}
