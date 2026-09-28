/**
 * Vapi adapter for AvatarAgent.
 *
 * Install: npm install @vapi-ai/web
 * Docs:    https://docs.vapi.ai/quickstart/introduction
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Vapi from '@vapi-ai/web';
import { DelayedAudioPlayback } from '../../audio/delayedAudioPlayback';
import type { SessionAdapter } from '../SessionAdapter';
import type { SessionStatus } from '../../types';

export interface UseVapiAdapterOptions {
  /** Your Vapi public key (safe to expose in the browser). */
  publicKey: string;

  /**
   * Pre-configured assistant ID from the Vapi dashboard.
   * Mutually exclusive with `assistant`.
   */
  assistantId?: string;

  /**
   * Inline assistant configuration.
   * Mutually exclusive with `assistantId`.
   * See https://docs.vapi.ai/api-reference/assistants/create for the full shape.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assistant?: Record<string, any>;
}

/**
 * Scan document.body for <audio> elements injected by Vapi's Daily.co layer.
 * Vapi's internal buildAudioPlayer() appends audio elements with
 * dataset.participantId set and srcObject containing the remote track.
 * Returns the first element that has a live audio stream, or null. Returns
 * the element itself (not just its stream) so the caller can mute it once
 * a delayed playback path takes over.
 */
function findVapiAudioElement(): HTMLAudioElement | null {
  const audios = Array.from(document.body.querySelectorAll<HTMLAudioElement>('audio[data-participant-id]'));
  for (const el of audios) {
    const stream = el.srcObject as MediaStream | null;
    if (stream && stream.getAudioTracks().some((t) => t.readyState === 'live')) {
      return el;
    }
  }
  return null;
}

export function useVapiAdapter({
  publicKey,
  assistantId,
  assistant,
}: UseVapiAdapterOptions): SessionAdapter {
  const [status, setStatus] = useState<SessionStatus>('DISCONNECTED');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const vapiRef = useRef<Vapi | null>(null);
  // Keep a ref so the MutationObserver cleanup is stable
  const observerRef = useRef<MutationObserver | null>(null);
  // Reroutes audible playback through a delay line matched to the lipsync
  // pipeline's own latency, instead of Vapi's native (unsynced) timing.
  const delayedPlaybackRef = useRef<DelayedAudioPlayback | null>(null);
  const mutedVapiElementRef = useRef<HTMLAudioElement | null>(null);

  const subscribersRef = useRef(
    new Set<(role: 'assistant' | 'user', text: string) => void>(),
  );

  // ── Start watching the DOM for Vapi's injected audio element ─────────────

  // Reroutes audible playback through a delay line matched to the lipsync
  // pipeline's latency, instead of Vapi's native (unsynced) timing. Only
  // mutes the element once the delayed path starts successfully, so a
  // failure falls back to normal audio instead of silence.
  const startDelayedPlayback = useCallback((el: HTMLAudioElement) => {
    const stream = el.srcObject as MediaStream | null;
    if (!stream) return;
    const delayedPlayback = new DelayedAudioPlayback();
    if (delayedPlayback.start(stream)) {
      el.muted = true;
      mutedVapiElementRef.current = el;
    }
    delayedPlaybackRef.current = delayedPlayback;
  }, []);

  const startObserving = useCallback(() => {
    // Stop any previous observer
    observerRef.current?.disconnect();

    // Immediate check — the element may already be there
    const existing = findVapiAudioElement();
    if (existing) {
      startDelayedPlayback(existing);
      setRemoteStream(existing.srcObject as MediaStream);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = findVapiAudioElement();
      if (el) {
        startDelayedPlayback(el);
        setRemoteStream(el.srcObject as MediaStream);
        observer.disconnect();
        observerRef.current = null;
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    observerRef.current = observer;
  }, [startDelayedPlayback]);

  const stopObserving = useCallback(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    delayedPlaybackRef.current?.stop();
    delayedPlaybackRef.current = null;
    // Restore the element's own playback in case Vapi reuses it for a
    // later call — muting is only meant to last while our delayed path
    // is standing in for it.
    if (mutedVapiElementRef.current) {
      mutedVapiElementRef.current.muted = false;
      mutedVapiElementRef.current = null;
    }
    setRemoteStream(null);
  }, []);

  // ── Boot the Vapi client once ──────────────────────────────────────────

  useEffect(() => {
    const vapi = new Vapi(publicKey);
    vapiRef.current = vapi;

    vapi.on('call-start', () => {
      setStatus('CONNECTED');
      startObserving();
    });

    vapi.on('call-end', () => {
      stopObserving();
      setStatus('DISCONNECTED');
    });

    vapi.on('error', (err: unknown) => {
      console.error('[VapiAdapter]', err);
      stopObserving();
      setStatus('DISCONNECTED');
    });

    // Transcript events — `message` events with type 'transcript' and
    // transcriptType 'final' carry the completed turn text.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vapi.on('message', (msg: any) => {
      if (msg.type === 'transcript' && msg.transcriptType === 'final') {
        const role = msg.role === 'assistant' ? 'assistant' : 'user';
        subscribersRef.current.forEach((h) => h(role, msg.transcript));
      }
    });

    return () => {
      vapi.stop();
      stopObserving();
    };
  // startObserving / stopObserving are stable useCallbacks
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  // ── SessionAdapter methods ─────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (status !== 'DISCONNECTED') return;
    setStatus('CONNECTING');
    try {
      const vapi = vapiRef.current;
      if (!vapi) throw new Error('[VapiAdapter] client not initialised');

      if (assistantId) {
        await vapi.start(assistantId);
      } else if (assistant) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await vapi.start(assistant as any);
      } else {
        throw new Error('[VapiAdapter] provide either assistantId or assistant');
      }
      // status transitions to CONNECTED via the call-start event handler
    } catch (err) {
      console.error('[VapiAdapter] connect failed:', err);
      setStatus('DISCONNECTED');
      throw err;
    }
  }, [status, assistantId, assistant]);

  const disconnect = useCallback(() => {
    vapiRef.current?.stop();
    stopObserving();
    // status transitions to DISCONNECTED via the call-end event handler
  }, [stopObserving]);

  const mute = useCallback((muted: boolean) => {
    try {
      vapiRef.current?.setMuted(muted);
    } catch {
      // Benign race: the call may have already ended internally before
      // React's `status` catches up to DISCONNECTED (disconnect() doesn't
      // update status synchronously — it waits for the 'call-end' event).
      // Muting an already-ending session is a no-op anyway.
    }
  }, []);

  const subscribeToTranscript = useCallback(
    (handler: (role: 'assistant' | 'user', text: string) => void): (() => void) => {
      subscribersRef.current.add(handler);
      return () => {
        subscribersRef.current.delete(handler);
      };
    },
    [],
  );

  return useMemo<SessionAdapter>(
    () => ({ status, connect, disconnect, mute, remoteStream, subscribeToTranscript }),
    [status, connect, disconnect, mute, remoteStream, subscribeToTranscript],
  );
}
