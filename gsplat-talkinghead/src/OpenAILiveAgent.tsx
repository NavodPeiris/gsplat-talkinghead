import { AvatarAgent } from './AvatarAgent';
import { useOpenAILiveAdapter } from './adapters/openai-live/useOpenAILiveAdapter';
import type { OpenAILiveAgentProps } from './types';

/**
 * Lip-synced 3D avatar driven by OpenAI GPT-Live (`gpt-live-1`) — a
 * full-duplex voice model that listens while it speaks and delegates
 * reasoning and tools to a backend model.
 *
 * @param createSession - Sends the browser's WebRTC SDP offer to **your
 *   backend**, which creates the GPT-Live session with its API key and
 *   returns the SDP answer. Model, voice, instructions and delegation are
 *   configured there:
 *   ```ts
 *   // server
 *   const { transport } = await openai.live.create({
 *     session: {
 *       model: 'gpt-live-1',
 *       instructions: 'You are a helpful assistant.',
 *       delegation: { type: 'responses', responses: { model: 'gpt-5.6-terra' } },
 *     },
 *     transport: { type: 'webrtc', sdp: offerSdp },
 *   });
 *   return transport.sdp;
 *
 *   // client
 *   createSession={async (sdp) => {
 *     const res = await fetch('/api/live-session', { method: 'POST', body: sdp });
 *     return res.text();
 *   }}
 *   ```
 *
 * @param tools - Browser-side function tools, run when the delegation
 *   backend calls them. Requires `delegation.type: "responses"`.
 *
 * @param avatar - Built-in avatar: `'Jack' | 'Jane' | 'John' | 'Sasha'`. Defaults to `'Jane'`.
 *
 * @param emotion - Facial emotion over lipsync: `'neutral' | 'happy' | 'sad' | 'thinking'`.
 *
 * @param assetsPath - URL/path to a custom Gaussian-splat avatar asset bundle. Takes precedence over `avatar`.
 *
 * @param backgroundImages - Array of image URLs for the scene background.
 *
 * @param onSessionEnd - Called when the session ends.
 *
 * @param endSessionPhrase - Phrase watched in the transcript to end the session.
 *
 * @param sessionTimeout - Hard timeout in milliseconds. Defaults to `600000` (10 min).
 *
 * @param className - Extra CSS class names on the outermost container `div`.
 */
export function OpenAILiveAgent({
  createSession,
  tools,
  avatar,
  emotion,
  assetsPath,
  backgroundImages,
  onSessionEnd,
  endSessionPhrase,
  sessionTimeout,
  className,
}: OpenAILiveAgentProps) {
  const adapter = useOpenAILiveAdapter({ createSession, tools });

  return (
    <AvatarAgent
      adapter={adapter}
      avatar={avatar}
      emotion={emotion}
      assetsPath={assetsPath}
      backgroundImages={backgroundImages}
      onSessionEnd={onSessionEnd}
      endSessionPhrase={endSessionPhrase}
      sessionTimeout={sessionTimeout}
      className={className}
    />
  );
}
