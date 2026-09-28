/** Resamples mono float32 PCM to 16kHz (the wav2arkit model's expected input rate) using the browser's OfflineAudioContext. */
export async function resampleTo16k(input: Float32Array, inputSampleRate: number): Promise<Float32Array> {
  const targetSampleRate = 16000;
  if (inputSampleRate === targetSampleRate) return input;

  const targetLength = Math.max(1, Math.ceil((input.length / inputSampleRate) * targetSampleRate));

  const OfflineAudioContextCtor =
    window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const offlineCtx = new OfflineAudioContextCtor(1, targetLength, targetSampleRate);

  const sourceBuffer = offlineCtx.createBuffer(1, input.length, inputSampleRate);
  sourceBuffer.copyToChannel(input as unknown as Float32Array<ArrayBuffer>, 0);

  const source = offlineCtx.createBufferSource();
  source.buffer = sourceBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0).slice();
}
