import { AvatarAgent } from './AvatarAgent';
import { useOpenAIRealtimeAdapter } from './adapters/openai-realtime/useOpenAIRealtimeAdapter';
import type { OpenAIRealtimeAgentProps } from './types';

/**
 * Lip-synced 3D avatar driven by the OpenAI Realtime API over WebRTC.
 *
 * @param getEphemeralKey - Async function that returns a short-lived OpenAI ephemeral key.
 *   Configure the model, voice, and system prompt (instructions) inside the session
 *   creation request. **Never call the OpenAI API directly from the browser** —
 *   proxy through your backend:
 *   ```ts
 *   getEphemeralKey={async () => {
 *     const res = await fetch('/api/realtime-session');
 *     const { client_secret } = await res.json();
 *     return client_secret.value;
 *   }}
 *   ```
 *
 *
 * @param avatar - Built-in avatar: `'Jack' | 'Jane' | 'John' | 'Sasha'`. Defaults to `'Jane'`.
 *
 * @param emotion - Facial emotion over lipsync: `'neutral' | 'happy' | 'sad' | 'excited' | 'thinking'`.
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
export function OpenAIRealtimeAgent({
  getEphemeralKey,
  agentVoice,
  tools,
  avatar,
  emotion,
  assetsPath,
  backgroundImages,
  onSessionEnd,
  endSessionPhrase,
  sessionTimeout,
  className,
}: OpenAIRealtimeAgentProps) {
  const adapter = useOpenAIRealtimeAdapter({ getEphemeralKey, agentVoice, tools });

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
