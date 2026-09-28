/**
 * ElevenLabs Conversational AI adapter for AvatarAgent.
 *
 * Install: npm install @elevenlabs/react
 * Docs:    https://elevenlabs.io/docs/eleven-agents/libraries/react
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useConversation } from '@elevenlabs/react';
import type { SessionAdapter } from '../SessionAdapter';
import type { SessionStatus } from '../../types';

export interface UseElevenLabsAdapterOptions {
  /** Agent ID from the ElevenLabs dashboard. */
  agentId: string;

  /**
   * Required for private/authenticated agents.
   * Must fetch a short-lived conversation token from your server:
   *   GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id={agentId}
   *   Header: xi-api-key: <your-api-key>
   * Never expose your API key in the browser — call this from your backend.
   * If omitted, connects with agentId directly (only works for public agents).
   */
  getConversationToken?: () => Promise<string>;

  /**
   * Optional: override individual client tools exposed to the agent.
   * See ElevenLabs docs for the shape.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientTools?: Record<string, (...args: any[]) => any>;
}

export function useElevenLabsAdapter({
  agentId,
  getConversationToken,
  clientTools,
}: UseElevenLabsAdapterOptions): SessionAdapter {
  const [status, setStatus] = useState<SessionStatus>('DISCONNECTED');

  const subscribersRef = useRef(
    new Set<(role: 'assistant' | 'user', text: string) => void>(),
  );

  // ── ElevenLabs conversation hook ──────────────────────────────────────

  const conversation = useConversation({
    onConnect: () => setStatus('CONNECTED'),
    onDisconnect: () => setStatus('DISCONNECTED'),
    onMessage: ({ message, source }: { message: string; source: string }) => {
      const role = source === 'ai' ? 'assistant' : 'user';
      subscribersRef.current.forEach((h) => h(role, message));
    },
    onError: (error: unknown) => {
      console.error('[ElevenLabsAdapter]', error);
      setStatus('DISCONNECTED');
    },
  });

  // ── ElevenLabs has its own audio playback and exposes no MediaStream ──
  //
  // The SDK only exposes frequency-magnitude data and a volume scalar
  // (getOutputByteFrequencyData / getOutputVolume) — never raw waveform
  // samples — so the wav2arkit neural lipsync model (which requires real
  // audio) cannot run for this provider. AvatarAgent falls back to coarse,
  // volume-driven mouth movement via `getRemoteAudioLevel` instead.

  const remoteStream: MediaStream | null = null;

  const getRemoteAudioLevel = useCallback(() => {
    return conversation.getOutputVolume();
  }, [conversation]);

  // ── SessionAdapter methods ─────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (status !== 'DISCONNECTED') return;
    setStatus('CONNECTING');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessionOpts: Record<string, any> = { clientTools };
      if (getConversationToken) {
        // Private agent — fetch a short-lived WebRTC token from your server
        sessionOpts.conversationToken = await getConversationToken();
      } else {
        // Public agent — connect directly with agentId
        sessionOpts.agentId = agentId;
      }
      sessionOpts.connectionType = 'webrtc';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await Promise.resolve((conversation.startSession as any)(sessionOpts));
    } catch (err) {
      console.error('[ElevenLabsAdapter] connect failed:', err);
      setStatus('DISCONNECTED');
      throw err;
    }
  }, [status, agentId, getConversationToken, clientTools, conversation]);

  const disconnect = useCallback(() => {
    conversation.endSession();
  }, [conversation]);

  const mute = useCallback((muted: boolean) => {
    try {
      conversation.setMuted(muted);
    } catch {
      // Benign race: `conversation` can change identity (retriggering
      // AvatarAgent's mute-sync effect) while it's mid-teardown from
      // disconnect(), before React's `status` has caught up to
      // DISCONNECTED. Muting an already-ending session is a no-op anyway.
    }
  }, [conversation]);

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
    () => ({ status, connect, disconnect, mute, remoteStream, getRemoteAudioLevel, subscribeToTranscript }),
    // remoteStream is always null (stable), no need to include in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, connect, disconnect, mute, getRemoteAudioLevel, subscribeToTranscript],
  );
}
