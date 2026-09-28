import { AvatarAgent } from './AvatarAgent';
import { useLiveKitAdapter } from './adapters/livekit/useLiveKitAdapter';
import type { LiveKitAvatarAgentProps } from './types';

/**
 * Lip-synced 3D avatar driven by a LiveKit Agents backend over WebRTC.
 * Your LiveKit agent must be running server-side; this component handles
 * only the browser-side connection and avatar rendering.
 *
 * @param serverUrl - LiveKit server WebSocket URL.
 *   ```ts
 *   serverUrl="wss://my-project.livekit.cloud"
 *   ```
 *
 * @param getToken - Async function that returns a short-lived LiveKit
 *   participant token. Generate server-side with the LiveKit server SDK:
 *   ```ts
 *   getToken={async () => {
 *     const res = await fetch('/api/livekit-token');
 *     const { token } = await res.json();
 *     return token;
 *   }}
 *   ```
 *   Backend (Next.js example):
 *   ```ts
 *   import { AccessToken } from 'livekit-server-sdk';
 *   const token = new AccessToken(apiKey, apiSecret, { identity: userId });
 *   token.addGrant({ roomJoin: true, room: 'agent-room' });
 *   return { token: await token.toJwt() };
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
export function LiveKitAvatarAgent({
  serverUrl,
  getToken,
  avatar,
  emotion,
  assetsPath,
  backgroundImages,
  onSessionEnd,
  endSessionPhrase,
  sessionTimeout,
  className,
}: LiveKitAvatarAgentProps) {
  const adapter = useLiveKitAdapter({ serverUrl, getToken });

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
