import { useEffect } from 'react';
import type { RefObject } from 'react';
import { Wav2ArkitLipsync } from './wav2arkit/liveLipsync';
import { AgentLevelMeter, setActiveAgentLevelMeter } from './wav2arkit/agentLevelMeter';
import type { IAvatarController } from '../avatar/GaussianAvatarController';
import { createNeutralWeights } from '../constants/arkit';

interface UseAvatarLipsyncOptions {
  /** The remote agent audio stream. When this transitions from null to a stream,
   *  the lipsync pipeline is set up. Must be reactive state (not a ref). */
  remoteStream: MediaStream | null;
  /** Ref to the mounted avatar controller — decoded blendshape frames are pushed here. */
  controllerRef: RefObject<IAvatarController | null>;
  onStartRecording?: (stream: MediaStream) => void;
  onStopRecording?: () => void;
}

/**
 * Wires the remote audio stream into the wav2arkit lipsync engine whenever
 * the stream becomes available, streaming decoded ARKit blendshapes into
 * the avatar controller, and tears down cleanly when it goes away.
 */
export function useAvatarLipsync({ remoteStream, controllerRef, onStartRecording, onStopRecording }: UseAvatarLipsyncOptions) {
  useEffect(() => {
    if (!remoteStream || remoteStream.getAudioTracks().length === 0) return;

    const lipsync = new Wav2ArkitLipsync({
      onFrame: (weights) => controllerRef.current?.updateBlendshapes(weights),
      // Drives body-animation ChatState from real audio activity, not just
      // session connect/disconnect — a single long-lived stream (e.g.
      // Vapi) would otherwise never revert to Idle during natural pauses.
      onSpeakingChange: (speaking) => controllerRef.current?.setChatState(speaking ? 'Responding' : 'Idle'),
    });
    const levelMeter = new AgentLevelMeter();

    levelMeter.start(remoteStream);
    setActiveAgentLevelMeter(levelMeter);
    lipsync.start(remoteStream);

    onStartRecording?.(remoteStream);

    return () => {
      lipsync.stop();
      levelMeter.stop();
      setActiveAgentLevelMeter(null);
      onStopRecording?.();
      // Only now can no more lipsync frames arrive — clear the last spoken
      // frame (often a half-open mouth) so it doesn't stay frozen on the face.
      controllerRef.current?.updateBlendshapes(createNeutralWeights());
      controllerRef.current?.setChatState('Idle');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteStream]); // re-runs when the stream reference changes (null → stream → null)
}
