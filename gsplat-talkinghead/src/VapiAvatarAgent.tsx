import { AvatarAgent } from './AvatarAgent';
import { useVapiAdapter } from './adapters/vapi/useVapiAdapter';
import type { VapiAvatarAgentProps } from './types';

/**
 * Lip-synced 3D avatar driven by Vapi. Configure your assistant in the Vapi
 * dashboard or provide an inline configuration object.
 *
 * @param publicKey - Your Vapi public key. Safe to expose in the browser —
 *   find it in the Vapi dashboard under API Keys.
 *
 * @param assistantId - ID of a pre-configured assistant from the Vapi dashboard.
 *   Mutually exclusive with `assistant`.
 *
 * @param assistant - Inline assistant configuration object. Use this to define
 *   the assistant without a dashboard setup. Mutually exclusive with `assistantId`.
 *   ```ts
 *   assistant={{
 *     model: {
 *       provider: 'openai',
 *       model: 'gpt-4o-mini',
 *       messages: [{ role: 'system', content: 'You are a helpful assistant.' }],
 *     },
 *     voice: { provider: '11labs', voiceId: 'sarah' },
 *   }}
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
export function VapiAvatarAgent({
  publicKey,
  assistantId,
  assistant,
  avatar,
  emotion,
  assetsPath,
  backgroundImages,
  onSessionEnd,
  endSessionPhrase,
  sessionTimeout,
  className,
}: VapiAvatarAgentProps) {
  const adapter = useVapiAdapter({ publicKey, assistantId, assistant });

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
