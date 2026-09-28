import { useEffect } from 'react';
import type { RefObject } from 'react';
import { Wav2ArkitLipsync } from './wav2arkit/liveLipsync';
import type { IAvatarController } from '../avatar/GaussianAvatarController';

const IDLE_AFTER_MS = 400;

interface UsePushAudioLipsyncOptions {
  /** Present only for adapters that decode raw PCM themselves and can push samples directly. */
  subscribeToRemoteAudio?: (handler: (chunk: Float32Array, sampleRate: number) => void) => () => void;
  controllerRef: RefObject<IAvatarController | null>;
}

/**
 * Full wav2arkit neural lipsync fed directly from an adapter's already-
 * decoded PCM audio, for adapters that never produce a browser MediaStream
 * (e.g. a provider that decodes raw PCM16 frames from its own WebSocket).
 */
export function usePushAudioLipsync({ subscribeToRemoteAudio, controllerRef }: UsePushAudioLipsyncOptions) {
  useEffect(() => {
    if (!subscribeToRemoteAudio) return;

    const lipsync = new Wav2ArkitLipsync({
      onFrame: (weights) => controllerRef.current?.updateBlendshapes(weights),
    });

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controllerRef.current?.setChatState('Idle'), IDLE_AFTER_MS);
    };

    const unsubscribe = subscribeToRemoteAudio((chunk, sampleRate) => {
      controllerRef.current?.setChatState('Responding');
      scheduleIdle();
      lipsync.pushAudio(chunk, sampleRate);
    });

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      unsubscribe();
      lipsync.stop();
      controllerRef.current?.setChatState('Idle');
    };
  }, [subscribeToRemoteAudio, controllerRef]);
}
