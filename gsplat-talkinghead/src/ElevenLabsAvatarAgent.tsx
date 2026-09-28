import { ConversationProvider } from '@elevenlabs/react';
import { AvatarAgent } from './AvatarAgent';
import { useElevenLabsAdapter } from './adapters/elevenlabs/useElevenLabsAdapter';
import type { ElevenLabsAvatarAgentProps } from './types';

/**
 * Inner component — must be rendered inside ConversationProvider.
 */
function ElevenLabsAvatarAgentInner({
  agentId,
  getConversationToken,
  clientTools,
  avatar,
  emotion,
  assetsPath,
  backgroundImages,
  onSessionEnd,
  endSessionPhrase,
  sessionTimeout,
  className,
}: ElevenLabsAvatarAgentProps) {
  const adapter = useElevenLabsAdapter({ agentId, getConversationToken, clientTools });

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

/**
 * Lip-synced 3D avatar driven by ElevenLabs Conversational AI.
 * Configure your agent in the ElevenLabs dashboard and pass its ID here.
 * Automatically wraps children in the required `ConversationProvider` context.
 *
 * For full layout control use `AvatarAgent + useElevenLabsAdapter` directly
 * and wrap your tree with `ConversationProvider` yourself.
 *
 * @param agentId - Agent ID from the ElevenLabs dashboard. **Required.**
 *
 * @param getConversationToken - Required for private/authenticated agents.
 *   Must return a short-lived WebRTC conversation token fetched server-side:
 *   ```ts
 *   getConversationToken={async () => {
 *     const res = await fetch('/api/elevenlabs-token');
 *     const { token } = await res.json();
 *     return token;
 *   }}
 *   ```
 *   Backend: `GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id={agentId}`
 *   with header `xi-api-key: <your-api-key>`.
 *   Omit for public agents.
 *
 * @param clientTools - Optional client-side tools exposed to the agent.
 *   ```ts
 *   clientTools={{ getWeather: async ({ city }) => fetchWeather(city) }}
 *   ```
 *
 * @param avatar - Built-in avatar: `'Jack' | 'Jane' | 'John' | 'Sasha'`. Defaults to `'Jane'`.
 *
 * @param emotion - Facial emotion over lipsync: `'neutral' | 'happy' | 'sad' | 'excited' | 'thinking'`.
 *
 * @param assetsPath - URL/path to a custom Gaussian-splat avatar asset bundle. Takes precedence over `avatar`.
 *
 * @param backgroundImages - Array of image URLs for the scene background. One
 *   is chosen at random each mount. Transparent when omitted.
 *
 * @param onSessionEnd - Called when the session ends — end phrase detected,
 *   timeout elapsed, or the user clicked End.
 *
 * @param endSessionPhrase - Case-insensitive substring the component watches
 *   for in the agent transcript to end the session. Defaults to `"this is the end"`.
 *
 * @param sessionTimeout - Hard timeout in milliseconds. Defaults to `600000` (10 min).
 *
 * @param className - Extra CSS class names on the outermost container `div`.
 */
export function ElevenLabsAvatarAgent(props: ElevenLabsAvatarAgentProps) {
  return (
    <ConversationProvider>
      <ElevenLabsAvatarAgentInner {...props} />
    </ConversationProvider>
  );
}
