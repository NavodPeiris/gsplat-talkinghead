import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DelayedAudioPlayback } from '../../audio/delayedAudioPlayback';
import { LiveCostTracker } from '../../session/openaiCost';
import type { SessionAdapter } from '../SessionAdapter';
import type { OpenAIRealtimeTool, SessionStatus } from '../../types';

export interface UseOpenAILiveAdapterOptions {
  /**
   * Exchanges the browser's WebRTC SDP offer for GPT-Live's SDP answer.
   * Must go through your backend — GPT-Live sessions are created with a
   * standard API key (`POST /v1/live/sessions`), which must never reach the
   * browser. Model, voice, instructions and delegation are set there.
   */
  createSession: (offerSdp: string) => Promise<string>;
  /**
   * Browser-side function tools. Schemas are sent to the session's Responses
   * delegation backend via `session.update`; `handler` runs here when the
   * backend calls the tool. Requires `delegation.type: "responses"`.
   */
  tools?: OpenAIRealtimeTool[];
}

// GPT-Live only streams transcript deltas (no "done" event). Buffer them
// into utterances and flush after this much silence, or when the other
// side starts talking, so transcript subscribers see whole sentences.
const TRANSCRIPT_FLUSH_MS = 1200;

// How long to wait for `session.started` before treating the session as
// live anyway (media is already negotiated at that point).
const SESSION_START_TIMEOUT_MS = 5000;

type Role = 'assistant' | 'user';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LiveEvent = Record<string, any>;

/**
 * OpenAI GPT-Live (`gpt-live-1`) adapter.
 * Full-duplex voice over WebRTC via the GPT-Live endpoint — a different API
 * from the Realtime one used by `useOpenAIRealtimeAdapter`.
 */
export function useOpenAILiveAdapter({ createSession, tools }: UseOpenAILiveAdapterOptions): SessionAdapter {
  const [status, setStatus] = useState<SessionStatus>('DISCONNECTED');
  const statusRef = useRef<SessionStatus>('DISCONNECTED');
  const updateStatus = useCallback((s: SessionStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const costRef = useRef(new LiveCostTracker());
  const toolsRef = useRef(tools);
  toolsRef.current = tools;

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
  const buffersRef = useRef<Record<Role, string>>({ assistant: '', user: '' });
  const flushTimersRef = useRef<Partial<Record<Role, ReturnType<typeof setTimeout>>>>({});

  const flushTranscript = useCallback((role: Role) => {
    clearTimeout(flushTimersRef.current[role]);
    const text = buffersRef.current[role].trim();
    buffersRef.current[role] = '';
    if (text) subscribersRef.current.forEach((h) => h(role, text));
  }, []);

  const appendTranscript = useCallback(
    (role: Role, delta: string) => {
      flushTranscript(role === 'assistant' ? 'user' : 'assistant');
      buffersRef.current[role] += delta;
      clearTimeout(flushTimersRef.current[role]);
      flushTimersRef.current[role] = setTimeout(() => flushTranscript(role), TRANSCRIPT_FLUSH_MS);
    },
    [flushTranscript],
  );

  const subscribeToTranscript = useCallback((handler: (role: Role, text: string) => void) => {
    subscribersRef.current.add(handler);
    return () => {
      subscribersRef.current.delete(handler);
    };
  }, []);

  // ── Session plumbing ──────────────────────────────────────────────────

  const sendEvent = useCallback((ev: unknown) => {
    const dc = dcRef.current;
    if (dc?.readyState === 'open') {
      try {
        dc.send(JSON.stringify(ev));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const cleanup = useCallback(() => {
    costRef.current.logAndReset();
    flushTranscript('user');
    flushTranscript('assistant');
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    dcRef.current = null;
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
  }, [audioElement, flushTranscript, updateStatus]);

  const runTool = useCallback(
    (call: LiveEvent) => {
      const tool = toolsRef.current?.find((t) => t.name === call.name);
      if (!tool) {
        console.warn(`[useOpenAILiveAdapter] No handler for tool "${call.name}"`);
        return;
      }
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments ?? '{}');
      } catch {
        /* pass empty args */
      }
      Promise.resolve(tool.handler(args))
        .then((result) => {
          sendEvent({
            type: 'response.item.create',
            item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result ?? null) },
          });
          sendEvent({ type: 'response.create' });
        })
        .catch((err) => console.error(`[useOpenAILiveAdapter] Tool "${call.name}" failed:`, err));
    },
    [sendEvent],
  );

  const handleEvent = useCallback(
    (msg: LiveEvent) => {
      costRef.current.handleEvent(msg);
      switch (msg.type) {
        case 'session.output_transcript.delta':
          if (typeof msg.delta === 'string') appendTranscript('assistant', msg.delta);
          break;
        case 'session.input_transcript.delta':
          if (typeof msg.delta === 'string') appendTranscript('user', msg.delta);
          break;
        case 'response.event': {
          // Responses-delegation backend events are forwarded wrapped.
          const inner = msg.event as LiveEvent | undefined;
          if (inner?.type === 'response.output_item.done' && inner.item?.type === 'function_call') {
            runTool(inner.item);
          }
          break;
        }
        case 'session.closed':
          cleanup();
          break;
        case 'error':
          console.error('[useOpenAILiveAdapter] GPT-Live error:', msg.error);
          break;
      }
    },
    [appendTranscript, runTool, cleanup],
  );

  // ── Connection ────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (statusRef.current !== 'DISCONNECTED') return;
    updateStatus('CONNECTING');

    try {
      const pc = new RTCPeerConnection();
      const dc = pc.createDataChannel('oai-events');
      pcRef.current = pc;
      dcRef.current = dc;

      pc.ontrack = (event) => {
        if (audioElement && event.streams[0]) audioElement.srcObject = event.streams[0];
      };
      pc.onconnectionstatechange = () => {
        if (pcRef.current === pc && ['failed', 'closed'].includes(pc.connectionState)) cleanup();
      };

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (pcRef.current !== pc) {
        // Disconnected while the permission prompt was open.
        micStream.getTracks().forEach((t) => t.stop());
        return;
      }
      micStreamRef.current = micStream;
      pc.addTrack(micStream.getAudioTracks()[0], micStream);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!offer.sdp) throw new Error('[useOpenAILiveAdapter] Failed to create WebRTC offer');

      const answerSdp = await createSession(offer.sdp);
      if (pcRef.current !== pc) return; // disconnected while waiting on the backend
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      dc.addEventListener('message', (event) => {
        try {
          handleEvent(JSON.parse(event.data as string));
        } catch {
          /* ignore parse errors */
        }
      });
      dc.addEventListener('close', () => {
        if (dcRef.current === dc) cleanup();
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, SESSION_START_TIMEOUT_MS);
        const onMessage = (event: MessageEvent) => {
          try {
            if (JSON.parse(event.data as string).type === 'session.started') {
              clearTimeout(timeout);
              dc.removeEventListener('message', onMessage);
              resolve();
            }
          } catch {
            /* ignore */
          }
        };
        dc.addEventListener('message', onMessage);
        dc.addEventListener('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
      if (pcRef.current !== pc) return;

      const currentTools = toolsRef.current;
      if (currentTools?.length) {
        sendEvent({
          type: 'session.update',
          session: {
            delegation: {
              type: 'responses',
              responses: {
                tools: currentTools.map((t) => ({
                  type: 'function',
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                })),
              },
            },
          },
        });
      }

      updateStatus('CONNECTED');
    } catch (err) {
      console.error('[useOpenAILiveAdapter] connect failed:', err);
      cleanup();
      throw err;
    }
  }, [audioElement, createSession, cleanup, handleEvent, sendEvent, updateStatus]);

  const disconnect = useCallback(() => {
    if (statusRef.current === 'DISCONNECTED') return;
    const dc = dcRef.current;
    if (dc?.readyState === 'open') {
      // Ask the server to end (and stop billing) the session cleanly, then
      // give the message a moment to leave before closing the connection.
      try {
        dc.send(JSON.stringify({ type: 'session.close' }));
      } catch {
        /* ignore */
      }
      const pc = pcRef.current;
      pcRef.current = null;
      dcRef.current = null;
      setTimeout(() => {
        try {
          pc?.close();
        } catch {
          /* ignore */
        }
      }, 250);
    }
    cleanup();
  }, [cleanup]);

  const mute = useCallback(
    (muted: boolean) => {
      micStreamRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
      sendEvent({ type: muted ? 'session.input_audio.mute' : 'session.input_audio.unmute' });
    },
    [sendEvent],
  );

  // ── Lipsync stream ────────────────────────────────────────────────────

  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (status !== 'CONNECTED' || !audioElement) return;

    // Same delay-line trick as the Realtime adapter: play audio through a
    // delay matched to the lipsync pipeline's latency so mouth and voice
    // line up. Only mutes the element once the delayed path is running.
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

  return useMemo<SessionAdapter>(
    () => ({ status, connect, disconnect, mute, remoteStream, sendEvent, subscribeToTranscript }),
    [status, connect, disconnect, mute, remoteStream, sendEvent, subscribeToTranscript],
  );
}
