import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DelayedAudioPlayback } from '../../audio/delayedAudioPlayback';
import type { SessionAdapter } from '../SessionAdapter';
import type { OpenAIRealtimeTool, SessionStatus } from '../../types';

export interface UseQwenRealtimeAdapterOptions {
  /**
   * Exchanges the browser's WebRTC SDP offer for Qwen's SDP answer. Must go
   * through **your backend**: the SDP exchange is authenticated with your
   * DashScope API key, which must never reach the browser. POST the offer to
   * `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.8-omni-flash-realtime`
   * (or the `cn-beijing` host) with `Content-Type: application/sdp` and return
   * the response body.
   */
  createSession: (offerSdp: string) => Promise<string>;
  /** System prompt. */
  instructions?: string;
  /** Voice name (see Qwen's voice list). Defaults to the model's default, `Tina`. */
  voice?: string;
  /** Browser-side function tools, same shape as the OpenAI Realtime adapter's. */
  tools?: OpenAIRealtimeTool[];
  /** `server_vad` (default) or `semantic_vad`. WebRTC doesn't support manual turns. */
  turnDetection?: 'server_vad' | 'semantic_vad';
  /**
   * Transcribe the user's speech (`qwen3-asr-flash-realtime`, billed separately).
   * Only needed for user transcripts; the end phrase is matched against the
   * assistant's transcript. Defaults to false.
   */
  transcribeInput?: boolean;
  /**
   * Makes the agent speak first. A string is the instruction for that opening
   * turn (e.g. "Introduce yourself as Jane and ask how you can help"); `false`
   * waits for the user to speak. Defaults to greeting per your `instructions`.
   */
  greeting?: string | false;
}

// How long to wait for local ICE gathering. Qwen needs a complete (non-trickle) offer.
const ICE_GATHER_TIMEOUT_MS = 3000;
const SESSION_START_TIMEOUT_MS = 8000;
const DEFAULT_GREETING = 'Greet the user briefly, following your instructions.';

type Role = 'assistant' | 'user';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QwenEvent = Record<string, any>;

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    // Send whatever candidates we have if gathering stalls (e.g. an unreachable STUN/TURN).
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

/** Qwen's answer SDP can come back with bare \n line endings; WebRTC wants \r\n. */
function normalizeSdp(sdp: string): string {
  const s = sdp.trim().replace(/\r?\n/g, '\r\n');
  return s.endsWith('\r\n') ? s : `${s}\r\n`;
}

/**
 * Qwen3.8-Omni-Flash-Realtime adapter (Alibaba Cloud Model Studio), over
 * WebRTC. Mic audio goes up an RTP track and the agent's voice comes back on
 * one, so lipsync and delayed playback work exactly as for the OpenAI
 * Realtime adapter. Control and server events use the data channel,
 * with OpenAI-Realtime-style event names.
 */
export function useQwenRealtimeAdapter({
  createSession,
  instructions,
  voice = 'Jennifer',
  tools,
  turnDetection = 'server_vad',
  transcribeInput = false,
  greeting = DEFAULT_GREETING,
}: UseQwenRealtimeAdapterOptions): SessionAdapter {
  const [status, setStatus] = useState<SessionStatus>('DISCONNECTED');
  const statusRef = useRef<SessionStatus>('DISCONNECTED');
  const updateStatus = useCallback((s: SessionStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const configRef = useRef({ instructions, voice, tools, turnDetection, transcribeInput, greeting });
  configRef.current = { instructions, voice, tools, turnDetection, transcribeInput, greeting };

  const pcRef = useRef<RTCPeerConnection | null>(null);
  // The server pushes events on its own "txt" channel; replies go back on it.
  const channelRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mutedRef = useRef(false);
  // The opening greeting is sent once per connection, on the first session.updated.
  const greetedRef = useRef(false);

  // ── Audio element (lives for the lifetime of this hook) ───────────────

  const audioElement = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    const el = document.createElement('audio');
    el.autoplay = true;
    el.style.display = 'none';
    document.body.appendChild(el);
    return el;
  }, []);

  useEffect(() => {
    return () => {
      audioElement?.pause();
      audioElement?.remove();
    };
  }, [audioElement]);

  // ── Transcripts ───────────────────────────────────────────────────────

  const subscribersRef = useRef(new Set<(role: Role, text: string) => void>());
  const emitTranscript = useCallback((role: Role, text: string) => {
    if (text.trim()) subscribersRef.current.forEach((h) => h(role, text));
  }, []);
  const subscribeToTranscript = useCallback((handler: (role: Role, text: string) => void) => {
    subscribersRef.current.add(handler);
    return () => {
      subscribersRef.current.delete(handler);
    };
  }, []);

  // ── Session plumbing ──────────────────────────────────────────────────

  const sendEvent = useCallback((ev: unknown) => {
    const ch = channelRef.current;
    if (ch?.readyState === 'open') ch.send(JSON.stringify(ev));
  }, []);

  const cleanup = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    channelRef.current = null;
    const pc = pcRef.current;
    pcRef.current = null;
    try {
      pc?.close();
    } catch {
      /* ignore */
    }
    if (audioElement) {
      audioElement.pause();
      audioElement.srcObject = null;
    }
    updateStatus('DISCONNECTED');
  }, [audioElement, updateStatus]);

  const setMicEnabled = useCallback((enabled: boolean) => {
    micStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }, []);

  const sessionUpdate = useCallback(() => {
    const { instructions: prompt, voice: v, tools: t, turnDetection: vad, transcribeInput: transcribe } =
      configRef.current;
    return {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        ...(prompt ? { instructions: prompt } : {}),
        ...(v ? { audio: { output: { voice: v } } } : {}),
        turn_detection: { type: vad },
        ...(transcribe ? { input_audio_transcription: { model: 'qwen3-asr-flash-realtime' } } : {}),
        ...(t?.length
          ? {
              tools: t.map((tool) => ({
                type: 'function',
                function: { name: tool.name, description: tool.description, parameters: tool.parameters },
              })),
            }
          : {}),
      },
    };
  }, []);

  const runTool = useCallback(
    async (call: QwenEvent) => {
      const tool = configRef.current.tools?.find((t) => t.name === call.name);
      let output: string;
      if (!tool) {
        output = JSON.stringify({ error: `Unknown tool ${call.name}` });
      } else {
        try {
          output = JSON.stringify((await tool.handler(JSON.parse(call.arguments || '{}'))) ?? null);
        } catch (err) {
          console.error(`[useQwenRealtimeAdapter] Tool "${call.name}" failed:`, err);
          output = JSON.stringify({ error: String(err) });
        }
      }
      sendEvent({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output } });
      sendEvent({ type: 'response.create' });
    },
    [sendEvent],
  );

  // Resolvers for the connect() handshake, set while CONNECTING.
  const handshakeRef = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  const handleEvent = useCallback(
    (msg: QwenEvent, channel: RTCDataChannel) => {
      switch (msg.type) {
        case 'session.created':
          // Configure the session on the channel the server talks on, then unmute the mic.
          channelRef.current = channel;
          channel.send(JSON.stringify(sessionUpdate()));
          break;
        case 'session.updated': {
          if (!mutedRef.current) setMicEnabled(true);
          const opening = configRef.current.greeting;
          if (opening && !greetedRef.current) {
            greetedRef.current = true;
            // A bare response.create is rejected ("Cannot create response
            // without input, history, or instructions"); per-response
            // instructions work and keep the history free of a fake user turn.
            channel.send(JSON.stringify({ type: 'response.create', response: { instructions: opening } }));
          }
          handshakeRef.current?.resolve();
          break;
        }
        case 'response.audio_transcript.done':
          if (typeof msg.transcript === 'string') emitTranscript('assistant', msg.transcript);
          break;
        case 'conversation.item.input_audio_transcription.completed':
          if (typeof msg.transcript === 'string') emitTranscript('user', msg.transcript);
          break;
        case 'response.function_call_arguments.done':
          runTool(msg);
          break;
        case 'error':
          console.error('[useQwenRealtimeAdapter] Qwen error:', msg.error ?? msg);
          if (statusRef.current === 'CONNECTING') {
            handshakeRef.current?.reject(new Error(msg.error?.message ?? 'Qwen session error'));
          }
          break;
      }
    },
    [emitTranscript, runTool, sessionUpdate, setMicEnabled],
  );

  // ── Connection ────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (statusRef.current !== 'DISCONNECTED') return;
    updateStatus('CONNECTING');
    mutedRef.current = false;
    greetedRef.current = false;
    // Re-read through a function: the ref changes across the awaits below.
    const stillConnecting = () => statusRef.current === 'CONNECTING';

    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (audioElement && event.streams[0]) audioElement.srcObject = event.streams[0];
      };
      pc.onconnectionstatechange = () => {
        if (pcRef.current === pc && ['failed', 'closed', 'disconnected'].includes(pc.connectionState)) cleanup();
      };

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!stillConnecting()) {
        micStream.getTracks().forEach((t) => t.stop());
        return;
      }
      micStreamRef.current = micStream;
      // Muted until the session is configured, so no audio is billed against defaults.
      micStream.getAudioTracks().forEach((t) => {
        t.enabled = false;
        pc.addTrack(t, micStream);
      });

      const listen = (channel: RTCDataChannel) => {
        channel.onmessage = (e) => {
          try {
            handleEvent(JSON.parse(e.data as string), channel);
          } catch {
            /* ignore non-JSON */
          }
        };
      };
      // A client channel is required for negotiation; the server answers on its own "txt" channel.
      listen(pc.createDataChannel('oai-events'));
      pc.ondatachannel = (event) => listen(event.channel);

      const handshake = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for session.updated')), SESSION_START_TIMEOUT_MS);
        handshakeRef.current = {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        };
      });

      // If a later step throws, the handshake is abandoned — don't let its
      // timeout surface as an unhandled rejection.
      handshake.catch(() => {});

      await pc.setLocalDescription(await pc.createOffer());
      await waitForIceGathering(pc);
      const offerSdp = pc.localDescription?.sdp;
      if (!offerSdp) throw new Error('[useQwenRealtimeAdapter] Failed to create WebRTC offer');

      const answerSdp = await createSession(offerSdp);
      if (!stillConnecting()) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: normalizeSdp(answerSdp) });

      await handshake;
      handshakeRef.current = null;
      if (!stillConnecting()) return;
      updateStatus('CONNECTED');
    } catch (err) {
      // Settles the pending handshake and clears its timeout.
      handshakeRef.current?.reject(err instanceof Error ? err : new Error(String(err)));
      handshakeRef.current = null;
      console.error('[useQwenRealtimeAdapter] connect failed:', err);
      cleanup();
      throw err;
    }
  }, [audioElement, cleanup, createSession, handleEvent, updateStatus]);

  const disconnect = useCallback(() => {
    if (statusRef.current !== 'DISCONNECTED') cleanup();
  }, [cleanup]);

  const mute = useCallback(
    (muted: boolean) => {
      mutedRef.current = muted;
      setMicEnabled(!muted);
    },
    [setMicEnabled],
  );

  // ── Lipsync stream ────────────────────────────────────────────────────

  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (status !== 'CONNECTED' || !audioElement) return;

    // Same delay-line trick as the OpenAI Realtime adapter: play audio
    // through a delay matched to the lipsync pipeline's latency so voice and
    // lips line up. Only mutes the element once the delayed path is running.
    const delayedPlayback = new DelayedAudioPlayback();

    let attempts = 0;
    const poll = setInterval(() => {
      const stream = audioElement.srcObject as MediaStream | null;
      if (stream && stream.getAudioTracks().length > 0) {
        if (delayedPlayback.start(stream)) audioElement.muted = true;
        setRemoteStream(stream);
        clearInterval(poll);
      } else if (++attempts > 50) {
        clearInterval(poll);
      }
    }, 50);

    return () => {
      clearInterval(poll);
      delayedPlayback.stop();
      audioElement.muted = false;
      setRemoteStream(null);
    };
  }, [status, audioElement]);

  useEffect(() => () => cleanup(), [cleanup]);

  return useMemo<SessionAdapter>(
    () => ({ status, connect, disconnect, mute, remoteStream, sendEvent, subscribeToTranscript }),
    [status, connect, disconnect, mute, remoteStream, sendEvent, subscribeToTranscript],
  );
}
