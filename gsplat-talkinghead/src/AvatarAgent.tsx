import { useCallback, useEffect, useRef, useState } from 'react';
import { useAvatarController, AvatarContainer } from './avatar/AvatarContainer';
import { resolveAvatarAssets } from './avatar/presets';
import type { AvatarPreset } from './avatar/presets';
import type { AvatarEmotion } from './avatar/emotions';
import { createNeutralWeights } from './constants/arkit';
import { Toolbar } from './ui/Toolbar';
import { StatusBadge } from './ui/StatusBadge';
import { AssetsLoader } from './ui/AssetsLoader';
import { useAvatarLipsync } from './audio/useAvatarLipsync';
import { usePushAudioLipsync } from './audio/usePushAudioLipsync';
import { useVolumeFallbackLipsync } from './audio/useVolumeFallbackLipsync';
import { useAudio } from './audio/useAudio';
import { getAgentAudioLevel } from './audio/wav2arkit/agentLevelMeter';
import { getSharedWav2ArkitEngine, type Wav2ArkitLoadState } from './audio/wav2arkit/inferenceEngine';
import { cn } from './utils/cn';
import type { SessionAdapter } from './adapters/SessionAdapter';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_END_PHRASE = 'this is the end';

export interface AvatarAgentProps {
  /** Platform adapter created by one of the useXxxAdapter hooks. */
  adapter: SessionAdapter;

  /**
   * Built-in avatar to show: `'Jack' | 'Jane' | 'John' | 'Sasha'`.
   * Defaults to `'Jane'`. Ignored when `assetsPath` is set.
   */
  avatar?: AvatarPreset;

  /**
   * Facial emotion layered on top of lipsync: `'neutral' | 'happy' | 'sad' |
   * 'excited' | 'thinking'`. Changes blend in smoothly. Drive it from your
   * app state, or let the model set it via `createEmotionTool`.
   */
  emotion?: AvatarEmotion;

  /**
   * URL or path to a custom Gaussian-splat avatar asset bundle, compatible
   * with `@myned-ai/gsplat-flame-avatar-renderer`. Takes precedence over
   * `avatar`.
   */
  assetsPath?: string;

  /** Array of background image URLs. One is chosen at random each mount. */
  backgroundImages?: string[];

  /** Called when the session ends (timeout, end phrase, or adapter-triggered). */
  onSessionEnd?: () => void;

  /**
   * Phrase the agent says to signal the session should end.
   * Case-insensitive substring match against the transcript.
   * Defaults to `"this is the end"`.
   */
  endSessionPhrase?: string;

  /** Session hard-timeout in milliseconds. Defaults to 10 minutes. */
  sessionTimeout?: number;

  /** Extra class names applied to the outer container div. */
  className?: string;
}

/**
 * Platform-agnostic avatar component.
 * Accepts any SessionAdapter and handles all rendering, lipsync, and
 * session lifecycle logic that is common across platforms.
 */
export function AvatarAgent({
  adapter,
  avatar,
  emotion = 'neutral',
  assetsPath,
  backgroundImages = [],
  onSessionEnd,
  endSessionPhrase = DEFAULT_END_PHRASE,
  sessionTimeout = DEFAULT_TIMEOUT_MS,
  className,
}: AvatarAgentProps) {
  const [isMuted, setIsMuted] = useState(false);

  // Destructure stable references so effects don't depend on the adapter object
  const { status, connect, disconnect, mute, remoteStream, getRemoteAudioLevel, subscribeToRemoteAudio, subscribeToTranscript } =
    adapter;

  // Stable refs for callbacks used inside long-lived effects
  const onSessionEndRef = useRef(onSessionEnd);
  onSessionEndRef.current = onSessionEnd;
  const endPhraseRef = useRef(endSessionPhrase);
  endPhraseRef.current = endSessionPhrase;

  // ── Avatar rendering ─────────────────────────────────────────────────

  const {
    containerRef,
    controllerRef,
    ready: avatarReady,
    error: avatarError,
  } = useAvatarController(resolveAvatarAssets(avatar, assetsPath));

  // Re-applied when the avatar finishes loading too (a new controller starts neutral).
  useEffect(() => {
    controllerRef.current?.setEmotion?.(emotion);
  }, [emotion, controllerRef, avatarReady]);

  // Start downloading the (large, one-time) wav2arkit model as soon as the
  // avatar mounts, rather than waiting for a call to connect. Without
  // this, if the agent's opening greeting starts before the ~385MB
  // download + session init finishes, the mouth can't move at all until
  // it's ready — a one-time "cold start" gap on the very first session.
  // Mounting gives this a head start of however long the user takes to
  // click "Start" plus the connection handshake, on top of it being
  // Cache Storage-backed so this is instant on every later visit anyway.
  const [modelLoad, setModelLoad] = useState<Wav2ArkitLoadState>(() => getSharedWav2ArkitEngine().loadState);
  useEffect(() => {
    const engine = getSharedWav2ArkitEngine();
    const unsubscribe = engine.subscribeToLoadState(setModelLoad);
    engine.warmup().catch(() => {
      // Surfaced properly once a real audio chunk actually needs the model.
    });
    return unsubscribe;
  }, []);

  // Hide the avatar and block Start until both downloads finish. A failed
  // load also ends the wait, so the user is never stuck behind the loader
  // (the avatar shows its error state; lipsync falls back to a neutral mouth).
  const modelSettled = modelLoad.status === 'ready' || modelLoad.status === 'error';
  const avatarSettled = avatarReady || !!avatarError;
  const assetsReady = modelSettled && avatarSettled;
  // The lipsync model is ~400 MB of the download, so its progress is the meaningful one.
  const loadProgress = modelSettled ? null : modelLoad.progress > 0 ? modelLoad.progress : null;

  // ── Audio / lipsync ───────────────────────────────────────────────────

  const { startRecording, stopRecording, getMicLevel, startMicMonitoring, stopMicMonitoring } = useAudio();

  // Start mic level monitoring as soon as connected so the audio bars
  // reflect the user's voice even before agent audio arrives.
  useEffect(() => {
    if (status === 'CONNECTED') {
      startMicMonitoring();
    } else {
      stopMicMonitoring();
    }
  }, [status, startMicMonitoring, stopMicMonitoring]);

  const onStartRecording = useCallback(
    (stream: MediaStream) => {
      startRecording(stream);
      controllerRef.current?.setChatState('Responding');
    },
    [startRecording, controllerRef],
  );

  const onStopRecording = useCallback(() => {
    stopRecording();
    controllerRef.current?.setChatState('Idle');
  }, [stopRecording, controllerRef]);

  useAvatarLipsync({
    remoteStream,
    controllerRef,
    onStartRecording,
    onStopRecording,
  });

  // Adapters that decode raw PCM themselves push samples directly into
  // full wav2arkit neural lipsync, bypassing the MediaStream tap.
  usePushAudioLipsync({
    subscribeToRemoteAudio,
    controllerRef,
  });

  // Adapters with neither a MediaStream nor raw audio access (e.g.
  // ElevenLabs) fall back to coarse, volume-driven mouth movement.
  useVolumeFallbackLipsync({
    getRemoteAudioLevel,
    active: status === 'CONNECTED' && !remoteStream && !subscribeToRemoteAudio,
    controllerRef,
  });

  // `setChatState('Idle')` (called by each lipsync hook's cleanup once the
  // stream/subscription/fallback tears down) only flips a state label — the
  // mouth itself only changes on the next `updateBlendshapes` call. If the
  // session ends mid-speech, the last spoken frame would otherwise stay
  // frozen on the avatar's face indefinitely. Explicitly reset to neutral
  // whenever the session isn't connected (manual disconnect, timeout, or
  // end-phrase all funnel through `status` eventually going non-CONNECTED).
  useEffect(() => {
    if (status !== 'CONNECTED') {
      controllerRef.current?.updateBlendshapes(createNeutralWeights());
    }
  }, [status, controllerRef]);

  // ── End phrase detection via transcript ───────────────────────────────

  useEffect(() => {
    return subscribeToTranscript((_role, text) => {
      if (text.toLowerCase().includes(endPhraseRef.current.toLowerCase())) {
        setTimeout(() => {
          disconnect();
          onSessionEndRef.current?.();
        }, 0);
      }
    });
  // subscribeToTranscript and disconnect are stable useCallbacks
  }, [subscribeToTranscript, disconnect]);

  // Agent-level meter: real streams feed the shared AnalyserNode-based meter
  // via useAvatarLipsync; stream-less adapters (ElevenLabs) read their own
  // volume scalar directly.
  const getAgentLevel = useCallback(() => {
    return remoteStream ? getAgentAudioLevel() : (getRemoteAudioLevel?.() ?? 0);
  }, [remoteStream, getRemoteAudioLevel]);

  // Speaking glow: feed the smoothed agent level into the stage's
  // --aa-level CSS variable each frame (no React re-renders).
  const stageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || status !== 'CONNECTED') return;
    let level = 0;
    let raf = 0;
    const tick = () => {
      level += (Math.min(1, getAgentLevel() * 2.5) - level) * 0.2;
      stage.style.setProperty('--aa-level', level.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      stage.style.setProperty('--aa-level', '0');
    };
  }, [status, getAgentLevel]);

  // ── Connection toggle ─────────────────────────────────────────────────

  const onToggleConnection = useCallback(() => {
    if (status === 'CONNECTED' || status === 'CONNECTING') {
      disconnect();
    } else {
      connect().catch(() => {
        // error already logged inside the adapter
      });
    }
  }, [status, connect, disconnect]);

  // ── Mute ─────────────────────────────────────────────────────────────

  const onToggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    mute(next);
  }, [isMuted, mute]);

  useEffect(() => {
    if (status === 'CONNECTED') mute(isMuted);
  }, [status, isMuted, mute]);

  // ── Session timeout ───────────────────────────────────────────────────

  useEffect(() => {
    if (status !== 'CONNECTED') return;
    const id = setTimeout(() => {
      disconnect();
      onSessionEndRef.current?.();
    }, sessionTimeout);
    return () => clearTimeout(id);
  }, [status, sessionTimeout, disconnect]);

  // ── Cleanup on unmount ────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    // Outer shell fills whatever space the parent gives it and centers the
    // avatar in it, so consumers don't need their own centering wrapper.
    // With an auto-height parent it just collapses to the avatar's height.
    <div className="aa-shell">
      <div className={cn('aa-root', 'h-[300px] min-[800px]:h-[800px]', className)}>
        {/* Avatar window: square, cropped tight to the bust — the background
            image is confined to it. */}
        <div ref={stageRef} className="aa-stage" data-status={status} data-loading={!assetsReady || undefined}>
          {/* Stays mounted (so it keeps loading) but hidden until assets are ready. */}
          <div className="aa-stage-content" aria-hidden={!assetsReady}>
            <AvatarContainer containerRef={containerRef} backgroundImages={backgroundImages} />
            <div className="aa-stage-fade" aria-hidden="true" />
            <StatusBadge status={status} />
          </div>
          {!assetsReady && <AssetsLoader progress={loadProgress} />}
        </div>
        <div className="aa-toolbar-row">
          <Toolbar
            sessionStatus={status}
            onToggleConnection={onToggleConnection}
            onToggleMute={onToggleMute}
            isMuted={isMuted}
            getMicLevel={getMicLevel}
            getAgentLevel={getAgentLevel}
            disabled={!assetsReady}
          />
        </div>
      </div>
    </div>
  );
}
