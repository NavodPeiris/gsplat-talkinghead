import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentSession } from '../../session/useAgentSession';
import { DelayedAudioPlayback } from '../../audio/delayedAudioPlayback';
import type { SessionAdapter } from '../SessionAdapter';
import type { OpenAIRealtimeTool } from '../../types';

export interface UseOpenAIRealtimeAdapterOptions {
  getEphemeralKey: () => Promise<string>;
  agentVoice?: string;
  tools?: OpenAIRealtimeTool[];
}

/**
 * OpenAI Realtime adapter.
 * Establishes a WebRTC connection directly to the OpenAI Realtime API —
 * no `@openai/agents` SDK required.
 */
export function useOpenAIRealtimeAdapter({
  getEphemeralKey,
  agentVoice,
  tools,
}: UseOpenAIRealtimeAdapterOptions): SessionAdapter {
  // ── Audio element (lives for the lifetime of this hook) ───────────────

  const audioElement = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    const el = document.createElement('audio');
    el.autoplay = true;
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
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

  // ── Transcript subscriber registry ────────────────────────────────────

  const subscribersRef = useRef(
    new Set<(role: 'assistant' | 'user', text: string) => void>(),
  );

  const handleTranscript = useCallback((role: 'assistant' | 'user', text: string) => {
    subscribersRef.current.forEach((h) => h(role, text));
  }, []);

  // ── Session core ──────────────────────────────────────────────────────

  const {
    status,
    connect: rawConnect,
    disconnect: rawDisconnect,
    sendEvent,
    mute,
  } = useAgentSession({ onTranscriptMessage: handleTranscript });

  // ── VAD + initial greeting once connected ─────────────────────────────

  // Kick off the initial agent greeting once connected.
  useEffect(() => {
    if (status !== 'CONNECTED') return;
    sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hi' }],
      },
    });
    sendEvent({ type: 'response.create' });
  }, [status, sendEvent]);

  // ── Connection ────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    await rawConnect({ getEphemeralKey, agentVoice, tools, audioElement });
  }, [rawConnect, getEphemeralKey, agentVoice, tools, audioElement]);

  const disconnect = useCallback(() => {
    const stream = audioElement?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (audioElement) {
      audioElement.pause();
      audioElement.srcObject = null;
    }
    rawDisconnect();
  }, [audioElement, rawDisconnect]);

  // ── Lipsync stream ────────────────────────────────────────────────────

  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (status !== 'CONNECTED' || !audioElement) return;

    // Reroutes audible playback through a delay line matched to the
    // lipsync pipeline's own latency, instead of the element's native
    // (unsynced) timing. Only mutes the element once the delayed path
    // starts successfully, so a failure falls back to normal audio
    // instead of silence.
    const delayedPlayback = new DelayedAudioPlayback();

    let attempts = 0;
    const poll = setInterval(() => {
      const stream = audioElement.srcObject as MediaStream | null;
      if (stream && stream.getAudioTracks().length > 0) {
        if (delayedPlayback.start(stream)) {
          audioElement.muted = true;
        }
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

  // ── Transcript subscription ───────────────────────────────────────────

  const subscribeToTranscript = useCallback(
    (handler: (role: 'assistant' | 'user', text: string) => void): (() => void) => {
      subscribersRef.current.add(handler);
      return () => { subscribersRef.current.delete(handler); };
    },
    [],
  );

  // ── Return stable SessionAdapter ──────────────────────────────────────

  return useMemo<SessionAdapter>(
    () => ({ status, connect, disconnect, mute, remoteStream, sendEvent, subscribeToTranscript }),
    [status, connect, disconnect, mute, remoteStream, sendEvent, subscribeToTranscript],
  );
}
