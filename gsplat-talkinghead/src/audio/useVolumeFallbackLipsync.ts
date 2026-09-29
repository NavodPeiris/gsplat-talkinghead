import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { IAvatarController } from '../avatar/GaussianAvatarController';
import type { ChatState } from '../types';
import { createNeutralWeights } from '../constants/arkit';

// Hysteresis around the speaking/idle boundary: rises above SPEAKING_ENTER
// to become "Responding", must fall below the lower SPEAKING_EXIT to drop
// back to "Idle". A single shared threshold let the volume level flicker
// across it many times per second (this runs on every rAF tick, ~60Hz),
// repeatedly calling setChatState('Responding')/('Idle') back to back —
// which triggered a "removeChild" DOM error inside the renderer's own
// animation-transition code, most likely not written to be reentrant
// against being re-triggered before a previous transition finished.
const SPEAKING_ENTER_THRESHOLD = 0.05;
const SPEAKING_EXIT_THRESHOLD = 0.02;

interface UseVolumeFallbackLipsyncOptions {
  /** Present only for adapters that can't expose a MediaStream (e.g. ElevenLabs). */
  getRemoteAudioLevel?: () => number;
  /** Whether this fallback path should be running (e.g. connected and no remoteStream). */
  active: boolean;
  controllerRef: RefObject<IAvatarController | null>;
}

/**
 * Coarse, volume-only mouth animation for adapters whose SDK exposes only a
 * scalar output level (no raw audio) — currently just ElevenLabs. Other
 * providers use `useAvatarLipsync` (full wav2arkit neural lipsync) instead;
 * this is a deliberately lower-fidelity fallback, not a replacement.
 */
export function useVolumeFallbackLipsync({ getRemoteAudioLevel, active, controllerRef }: UseVolumeFallbackLipsyncOptions) {
  useEffect(() => {
    if (!getRemoteAudioLevel || !active) return;

    const neutral = createNeutralWeights();
    let frameId: number;
    let currentState: ChatState = 'Idle';

    const setStateIfChanged = (next: ChatState) => {
      if (next === currentState) return;
      currentState = next;
      controllerRef.current?.setChatState(next);
    };

    const tick = () => {
      const level = Math.max(0, Math.min(1, getRemoteAudioLevel()));
      if (currentState === 'Idle' && level > SPEAKING_ENTER_THRESHOLD) {
        setStateIfChanged('Responding');
      } else if (currentState === 'Responding' && level < SPEAKING_EXIT_THRESHOLD) {
        setStateIfChanged('Idle');
      }
      // Driving jawOpen alone renders as a round, funnel-like "O" on this rig
      // regardless of how loud the input is — there's no horizontal
      // complement to counteract the vertical drop. Blending in mouthStretch
      // widens the mouth as it opens, closer to a natural talking shape.
      const jawOpen = Math.min(0.5, level * 0.75);
      const stretch = Math.min(0.35, level * 0.5);
      controllerRef.current?.updateBlendshapes({
        ...neutral,
        jawOpen,
        mouthClose: 0,
        mouthStretchLeft: stretch,
        mouthStretchRight: stretch,
      });
      frameId = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(frameId);
      setStateIfChanged('Idle');
      controllerRef.current?.updateBlendshapes(createNeutralWeights());
    };
  }, [getRemoteAudioLevel, active, controllerRef]);
}
