import { useRef } from 'react';

/**
 * Handles recording of the mixed mic + remote audio stream.
 * Returned chunks can be used for playback, upload, or analysis.
 */
export function useAudio() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);

  const startRecording = async (remoteStream: MediaStream) => {
    try {
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      micStreamRef.current = new MediaStream();
    }

    audioContextRef.current = new AudioContext();
    const destination = audioContextRef.current.createMediaStreamDestination();

    try {
      audioContextRef.current.createMediaStreamSource(remoteStream).connect(destination);
    } catch { /* non-fatal */ }

    try {
      const micSource = audioContextRef.current
        .createMediaStreamSource(micStreamRef.current);
      micAnalyserRef.current = audioContextRef.current.createAnalyser();
      micAnalyserRef.current.fftSize = 256;
      micSource.connect(micAnalyserRef.current);
      micAnalyserRef.current.connect(destination);
    } catch { /* non-fatal */ }

    try {
      const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm' });
      recorder.ondataavailable = (e) => {
        if (e.data?.size) recordedChunksRef.current.push(e.data);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
    } catch { /* non-fatal */ }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.requestData();
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;

    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    micAnalyserRef.current = null;

    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close();
    }
    audioContextRef.current = null;
  };

  const getMicLevel = (): number => {
    if (!micAnalyserRef.current) return 0;
    const data = new Uint8Array(micAnalyserRef.current.frequencyBinCount);
    micAnalyserRef.current.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    return avg / 128;
  };

  const getRecordedBlob = (): Blob | null => {
    if (!recordedChunksRef.current.length) return null;
    return new Blob(recordedChunksRef.current, { type: 'audio/webm' });
  };

  // ── Standalone mic monitoring (no remote stream needed) ──────────────────
  // Starts mic access and level analysis independently of recording.
  // Call this on session connect so getMicLevel() works even before the
  // agent sends audio (e.g. LiveKit, where mic is published natively).

  const startMicMonitoring = async () => {
    if (micAnalyserRef.current) return; // already running
    try {
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = audioContextRef.current ?? new AudioContext();
      const micSource = audioContextRef.current.createMediaStreamSource(micStreamRef.current);
      micAnalyserRef.current = audioContextRef.current.createAnalyser();
      micAnalyserRef.current.fftSize = 256;
      micSource.connect(micAnalyserRef.current);
    } catch { /* mic denied — getMicLevel will return 0 */ }
  };

  const stopMicMonitoring = () => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    micAnalyserRef.current = null;
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close();
    }
    audioContextRef.current = null;
  };

  return { startRecording, stopRecording, getRecordedBlob, getMicLevel, startMicMonitoring, stopMicMonitoring };
}
