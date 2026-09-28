/**
 * Default delay applied to audio that's rerouted through
 * `DelayedAudioPlayback`, matching the wav2arkit lipsync pipeline's own
 * typical processing latency (audio chunk buffering + inference time).
 * That latency can't be eliminated without shrinking the audio window fed
 * to the model, which measurably hurts blendshape accuracy (see CHUNK_MS
 * in `wav2arkit/liveLipsync.ts` — 100ms was tried and reverted for exactly
 * this reason). Delaying the audible audio instead keeps voice and mouth
 * movement in sync without sacrificing accuracy.
 */
export const AUDIO_SYNC_DELAY_MS = 300;

/**
 * Plays a `MediaStream` through a Web Audio delay line instead of letting
 * it play at its natural timing — used to intentionally lag audible agent
 * audio behind by a fixed amount so it lines up with wav2arkit's own
 * inherent lipsync latency.
 *
 * The caller MUST mute the stream's own native playback (e.g. the
 * `<audio>` element a provider SDK created) once this starts successfully
 * — otherwise the audio plays twice (natural timing + delayed), audibly
 * doubled. Conversely, don't mute before confirming `start()` succeeded,
 * or a failure here would leave the user with no audio at all instead of
 * falling back to normal (unsynced) playback.
 */
export class DelayedAudioPlayback {
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private delayNode: DelayNode | null = null;

  /** Returns true if the delayed path started successfully. */
  public start(stream: MediaStream, delayMs: number = AUDIO_SYNC_DELAY_MS): boolean {
    if (this.audioCtx) return true; // already running

    try {
      const AudioContextCtor =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextCtor({ latencyHint: 'interactive' });
      if (ctx.state === 'suspended') ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      // maxDelayTime must exceed the actual delay value, with headroom.
      const delay = ctx.createDelay(Math.max(1, delayMs / 1000 + 0.5));
      delay.delayTime.value = delayMs / 1000;

      source.connect(delay);
      delay.connect(ctx.destination);

      this.audioCtx = ctx;
      this.sourceNode = source;
      this.delayNode = delay;
      return true;
    } catch (err) {
      console.warn(
        '[gsplat-talkinghead] Failed to start delayed audio playback — audio will play at its natural (unsynced) timing instead:',
        err,
      );
      this.stop();
      return false;
    }
  }

  public stop(): void {
    this.sourceNode?.disconnect();
    this.delayNode?.disconnect();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close();
    }
    this.audioCtx = null;
    this.sourceNode = null;
    this.delayNode = null;
  }
}
