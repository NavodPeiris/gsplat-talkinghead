/** Standalone 0-1 audio level meter for the agent's remote stream, decoupled from the lipsync inference pipeline. */
export class AgentLevelMeter {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;

  public start(stream: MediaStream): void {
    if (this.audioCtx) return;

    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new AudioContextCtor();
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

    const source = this.audioCtx.createMediaStreamSource(stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    source.connect(this.analyser);
  }

  public getLevel(): number {
    if (!this.analyser || !this.dataArray) return 0;
    this.analyser.getByteFrequencyData(this.dataArray as unknown as Uint8Array<ArrayBuffer>);
    const avg = this.dataArray.reduce((a, b) => a + b, 0) / this.dataArray.length;
    return avg / 128;
  }

  public stop(): void {
    this.analyser?.disconnect();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close();
    }
    this.audioCtx = null;
    this.analyser = null;
    this.dataArray = null;
  }
}

let activeMeter: AgentLevelMeter | null = null;

/** Tracks whichever meter was most recently started, for the module-level `getAgentAudioLevel()` reader. */
export function setActiveAgentLevelMeter(meter: AgentLevelMeter | null): void {
  activeMeter = meter;
}

/** Returns a 0-1 audio level from the currently active agent stream, or 0 if none is active. */
export function getAgentAudioLevel(): number {
  return activeMeter?.getLevel() ?? 0;
}
