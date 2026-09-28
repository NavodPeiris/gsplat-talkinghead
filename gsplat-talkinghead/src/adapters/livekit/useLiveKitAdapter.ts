/**
 * LiveKit adapter for AvatarAgent.
 *
 * Install: npm install livekit-client
 * Docs:    https://livekit.com/
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteAudioTrack, type RemoteTrackPublication, type RemoteParticipant } from 'livekit-client';
import { DelayedAudioPlayback } from '../../audio/delayedAudioPlayback';
import type { SessionAdapter } from '../SessionAdapter';
import type { SessionStatus } from '../../types';

export interface UseLiveKitAdapterOptions {
  /** LiveKit server WebSocket URL, e.g. wss://my-project.livekit.cloud */
  serverUrl: string;

  /**
   * Returns a short-lived participant token for the room.
   * Generate it server-side using the LiveKit server SDK.
   * If your agent uses explicit dispatch (agent_name is set), include
   * RoomConfiguration.agents in the token to auto-dispatch on room creation.
   */
  getToken: () => Promise<string>;
}

export function useLiveKitAdapter({ serverUrl, getToken }: UseLiveKitAdapterOptions): SessionAdapter {
  const [status, setStatus] = useState<SessionStatus>('DISCONNECTED');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const roomRef = useRef<Room>(new Room());
  // Audio element used to actually play the agent's voice through the speaker
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // Reroutes audible playback through a delay line matched to the lipsync
  // pipeline's own latency, instead of the element's native (unsynced) timing.
  const delayedPlaybackRef = useRef<DelayedAudioPlayback | null>(null);

  const subscribersRef = useRef(
    new Set<(role: 'assistant' | 'user', text: string) => void>(),
  );

  // ── Helper: attach a remote audio track to both the speaker and lipsync ──

  const attachAudioTrack = useCallback((track: RemoteAudioTrack) => {
    // Detach any previous element safely
    detachAudioTrack();

    // Use LiveKit's own attach() to create a properly configured <audio> element
    const el = track.attach() as HTMLAudioElement;
    el.autoplay = true;
    el.style.display = 'none';
    document.body.appendChild(el);
    audioElRef.current = el;

    // Also expose the raw MediaStream for lipsync analysis
    const stream = new MediaStream([track.mediaStreamTrack]);

    // Reroute audible playback through a delay line matched to the lipsync
    // pipeline's latency, instead of the element's native (unsynced)
    // timing. Only mute the element once the delayed path starts
    // successfully, so a failure falls back to normal audio instead of
    // silence.
    const delayedPlayback = new DelayedAudioPlayback();
    if (delayedPlayback.start(stream)) {
      el.muted = true;
    }
    delayedPlaybackRef.current = delayedPlayback;

    setRemoteStream(stream);
  }, []);

  const detachAudioTrack = useCallback(() => {
    const el = audioElRef.current;
    if (el) {
      audioElRef.current = null;
      // If autoplay's play() promise is still pending, pause() will throw
      // AbortError. Wait for it to settle first, then pause safely.
      const p = el.play();
      if (p !== undefined) {
        p.then(() => { el.pause(); el.srcObject = null; el.remove(); })
         .catch(() => { el.srcObject = null; el.remove(); });
      } else {
        el.pause();
        el.srcObject = null;
        el.remove();
      }
    }
    delayedPlaybackRef.current?.stop();
    delayedPlaybackRef.current = null;
    setRemoteStream(null);
  }, []);

  // ── Wire up Room events once ───────────────────────────────────────────

  useEffect(() => {
    const room = roomRef.current;

    room.on(RoomEvent.Connected, async () => {
      // Unlock audio playback — must be called in the user gesture chain.
      await room.startAudio();

      // Publish mic now that the room is fully ready (roomID assigned).
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (err) {
        console.error('[LiveKitAdapter] failed to enable microphone:', err);
      }

      // Handle agent tracks that were already published before we connected.
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((pub) => {
          if (pub.track && pub.kind === Track.Kind.Audio) {
            attachAudioTrack(pub.track as RemoteAudioTrack);
          }
        });
      });

      setStatus('CONNECTED');
    });

    room.on(RoomEvent.Disconnected, () => {
      detachAudioTrack();
      setStatus('DISCONNECTED');
    });

    room.on(
      RoomEvent.TrackSubscribed,
      (track, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          attachAudioTrack(track as RemoteAudioTrack);
        }
      },
    );

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        detachAudioTrack();
      }
    });

    // LiveKit data messages can carry transcript payloads if your agent sends them
    room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        if (msg.type === 'transcript') {
          const role = msg.role === 'assistant' ? 'assistant' : 'user';
          subscribersRef.current.forEach((h) => h(role, msg.text));
        }
      } catch {
        // not a transcript message
      }
    });

    return () => {
      detachAudioTrack();
      room.disconnect();
    };
  // attachAudioTrack / detachAudioTrack are stable useCallbacks
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── SessionAdapter methods ─────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (roomRef.current.state !== 'disconnected') return;
    setStatus('CONNECTING');
    try {
      const token = await getToken();
      await roomRef.current.connect(serverUrl, token, { autoSubscribe: true });
    } catch (err) {
      console.error('[LiveKitAdapter] connect failed:', err);
      setStatus('DISCONNECTED');
      throw err;
    }
  }, [getToken, serverUrl]);

  const disconnect = useCallback(() => {
    detachAudioTrack();
    roomRef.current.disconnect();
  }, [detachAudioTrack]);

  const mute = useCallback((muted: boolean) => {
    // setMicrophoneEnabled is async — catch a rejection (not just a sync
    // throw), since the room may already be disconnecting/disconnected
    // before React's `status` catches up. Muting an already-ending
    // session is a no-op anyway.
    roomRef.current.localParticipant.setMicrophoneEnabled(!muted).catch(() => {});
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
