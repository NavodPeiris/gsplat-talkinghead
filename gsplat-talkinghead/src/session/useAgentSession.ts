/**
 * Minimal OpenAI Realtime WebRTC session hook.
 *
 * Connects directly to the OpenAI Realtime API without any SDK dependency —
 * only the browser's native RTCPeerConnection and fetch are used.
 */
import { useCallback, useRef, useState } from 'react';
import { audioFormatForCodec, applyCodecPreferences } from './codecUtils';
import type { SessionStatus, OpenAIRealtimeTool } from '../types';

const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

export interface ConnectOptions {
  getEphemeralKey: () => Promise<string>;
  agentVoice?: string;
  tools?: OpenAIRealtimeTool[];
  audioElement?: HTMLAudioElement;
}

export interface UseAgentSessionOptions {
  onConnectionChange?: (status: SessionStatus) => void;
  onTranscriptMessage?: (role: 'assistant' | 'user', text: string) => void;
}

export function useAgentSession({
  onConnectionChange,
  onTranscriptMessage,
}: UseAgentSessionOptions = {}) {
  const [status, setStatus] = useState<SessionStatus>('DISCONNECTED');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const codecParamRef = useRef<string>(
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('codec') ?? 'opus').toLowerCase()
      : 'opus',
  );

  const updateStatus = useCallback(
    (s: SessionStatus) => {
      setStatus(s);
      onConnectionChange?.(s);
    },
    [onConnectionChange],
  );

  const cleanup = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    dcRef.current = null;
    if (pcRef.current) {
      try { pcRef.current.close(); } catch { /* ignore */ }
      pcRef.current = null;
    }
    updateStatus('DISCONNECTED');
  }, [updateStatus]);

  const connect = useCallback(
    async ({ getEphemeralKey, agentVoice = 'sage', tools = [], audioElement }: ConnectOptions) => {
      if (status !== 'DISCONNECTED') return;
      updateStatus('CONNECTING');

      try {
        const ek = await getEphemeralKey();
        const codecParam = codecParamRef.current;
        const audioFormat = audioFormatForCodec(codecParam);

        const pc = new RTCPeerConnection();
        const dc = pc.createDataChannel('oai-events');

        pc.ontrack = (event) => {
          if (audioElement && event.streams[0]) {
            audioElement.srcObject = event.streams[0];
          }
        };

        pc.onconnectionstatechange = () => {
          if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
            cleanup();
          }
        };

        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = micStream;
        pc.addTrack(micStream.getAudioTracks()[0]);
        applyCodecPreferences(pc, codecParam);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        if (!offer.sdp) throw new Error('[useAgentSession] Failed to create WebRTC offer');

        const res = await fetch(CALLS_URL, {
          method: 'POST',
          body: offer.sdp,
          headers: {
            'Content-Type': 'application/sdp',
            Authorization: `Bearer ${ek}`,
          },
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`[useAgentSession] OpenAI Realtime API error ${res.status}: ${body}`);
        }

        await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });

        pcRef.current = pc;
        dcRef.current = dc;

        // Wait for data channel open → send full config → wait for server ack.
        await new Promise<void>((resolve, reject) => {
          // Fallback: resolve after 5 s even if ack never arrives.
          const timeout = setTimeout(() => resolve(), 5000);

          const onMessage = (event: MessageEvent) => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const msg = JSON.parse(event.data as string) as Record<string, any>;
              if (msg.type === 'session.updated') {
                clearTimeout(timeout);
                dc.removeEventListener('message', onMessage);
                resolve();
              }
            } catch { /* ignore */ }
          };

          dc.onopen = () => {
            // Send full session config in one update so nothing is reset.
            dc.send(JSON.stringify({
              type: 'session.update',
              session: {
                voice: agentVoice,
                input_audio_format: audioFormat,
                output_audio_format: audioFormat,
                input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
                turn_detection: {
                  type: 'server_vad',
                  threshold: 0.9,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 500,
                  create_response: true,
                },
                tools: tools.map((t) => ({
                  type: 'function',
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                })),
              },
            }));
            // Listen for the server's session.updated acknowledgement.
            dc.addEventListener('message', onMessage);
          };

          dc.onerror = (err) => { clearTimeout(timeout); reject(err); };
          dc.onclose = () => { clearTimeout(timeout); resolve(); };
        });

        // Ongoing message handler
        dc.addEventListener('message', (event) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const msg = JSON.parse(event.data as string) as Record<string, any>;

            if (msg.type === 'response.audio_transcript.done' && typeof msg.transcript === 'string') {
              onTranscriptMessage?.('assistant', msg.transcript);
            }
            if (
              msg.type === 'conversation.item.input_audio_transcription.completed' &&
              typeof msg.transcript === 'string'
            ) {
              onTranscriptMessage?.('user', msg.transcript);
            }

            if (msg.type === 'response.function_call_arguments.done') {
              const tool = tools.find((t) => t.name === msg.name);
              if (tool) {
                Promise.resolve(tool.handler(JSON.parse(msg.arguments ?? '{}')))
                  .then((result) => {
                    if (dc.readyState !== 'open') return;
                    dc.send(JSON.stringify({
                      type: 'conversation.item.create',
                      item: { type: 'function_call_output', call_id: msg.call_id, output: JSON.stringify(result) },
                    }));
                    dc.send(JSON.stringify({ type: 'response.create' }));
                  })
                  .catch(console.error);
              }
            }

          } catch { /* ignore parse errors */ }
        });

        dc.addEventListener('close', () => cleanup());

        updateStatus('CONNECTED');
      } catch (err) {
        console.error('[useAgentSession] connect failed:', err);
        cleanup();
        throw err;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, updateStatus, cleanup, onTranscriptMessage],
  );

  const disconnect = useCallback(() => cleanup(), [cleanup]);

  const sendEvent = useCallback((ev: unknown) => {
    const dc = dcRef.current;
    if (dc?.readyState === 'open') {
      try { dc.send(JSON.stringify(ev)); } catch { /* ignore */ }
    }
  }, []);

  const mute = useCallback((m: boolean) => {
    micStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !m; });
  }, []);

  return { status, connect, disconnect, sendEvent, mute } as const;
}
