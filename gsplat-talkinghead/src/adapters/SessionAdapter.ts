import type { SessionStatus } from '../types';

/**
 * Common interface that every platform adapter must implement.
 * The base AvatarAgent component talks exclusively through this contract —
 * platform-specific details stay inside each adapter hook.
 */
export interface SessionAdapter {
  /** Current connection state. Changes trigger re-renders via the adapter hook. */
  readonly status: SessionStatus;

  /** Establish a voice session with the platform. */
  connect(): Promise<void>;

  /** Tear down the session and clean up resources. */
  disconnect(): void;

  /** Mute or unmute the local microphone. */
  mute(muted: boolean): void;

  /**
   * The remote audio MediaStream (agent voice) for lipsync analysis.
   * Must be `null` until audio is actually flowing — not just CONNECTED.
   * Adapters expose this as reactive state so useAvatarLipsync re-runs when it arrives.
   *
   * When a platform SDK cannot expose a raw MediaStream, leave this `null`
   * and implement `getRemoteAudioLevel` instead.
   */
  remoteStream: MediaStream | null;

  /**
   * Fallback for platforms that cannot expose a MediaStream (e.g. ElevenLabs,
   * whose SDK only exposes frequency-magnitude and volume scalars, not raw
   * waveform samples). Returns the agent's current output volume, 0-1.
   *
   * When present, `remoteStream` is `null`, and `subscribeToRemoteAudio` is
   * not implemented, AvatarAgent drives coarse, volume-only mouth movement
   * from this instead of full wav2arkit neural lipsync (which requires real
   * audio samples).
   */
  getRemoteAudioLevel?(): number;

  /**
   * Alternative to `remoteStream` for adapters that decode raw PCM
   * themselves and never produce a browser MediaStream (e.g. a provider
   * that decodes PCM16 frames from its own WebSocket for manual
   * playback). Subscribe to receive each decoded chunk as it's produced;
   * returns an unsubscribe function. When present, AvatarAgent drives full
   * wav2arkit neural lipsync from these chunks instead of tapping
   * `remoteStream`.
   */
  subscribeToRemoteAudio?(handler: (chunk: Float32Array, sampleRate: number) => void): () => void;

  /**
   * Subscribe to transcript messages from both the user and the assistant.
   * Returns an unsubscribe function — call it in useEffect cleanup.
   */
  subscribeToTranscript(
    handler: (role: 'assistant' | 'user', text: string) => void,
  ): () => void;

  /**
   * Send a platform-specific low-level event over the active session.
   * Optional — only implement if the platform supports raw event forwarding.
   */
  sendEvent?(event: unknown): void;
}
