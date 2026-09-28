import { AvatarAgent } from './AvatarAgent';
import { useQwenRealtimeAdapter } from './adapters/qwen/useQwenRealtimeAdapter';
import type { QwenRealtimeAgentProps } from './types';

/**
 * Lip-synced 3D avatar driven by Qwen3.8-Omni-Flash-Realtime (Alibaba Cloud
 * Model Studio), a full-duplex speech-to-speech model, over WebRTC.
 *
 * @param createSession - Sends the browser's WebRTC SDP offer to **your
 *   backend**, which forwards it to Model Studio with your DashScope API key
 *   and returns the SDP answer:
 *   ```ts
 *   // server
 *   const res = await fetch(
 *     `https://${WORKSPACE_ID}.ap-southeast-1.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.8-omni-flash-realtime`,
 *     { method: 'POST', headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}` }, body: offerSdp },
 *   );
 *   return res.text();
 *   ```
 *
 * @param instructions - System prompt.
 *
 * @param voice - Qwen voice name. Defaults to 'Jennifer'. for male voice, try 'Aiden'.
 *
 * @param tools - Browser-side function tools (same shape as `OpenAIRealtimeAgent`'s).
 *
 * @param turnDetection - `"server_vad"` (default) or `"semantic_vad"`.
 *
 * @param transcribeInput - Also transcribe the user's speech (billed separately).
 *
 * @param greeting - Instruction for the agent's opening turn, or `false` to wait for the user.
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
export function QwenRealtimeAgent({
  createSession,
  instructions,
  voice,
  tools,
  turnDetection,
  transcribeInput,
  greeting,
  avatar,
  emotion,
  assetsPath,
  backgroundImages,
  onSessionEnd,
  endSessionPhrase,
  sessionTimeout,
  className,
}: QwenRealtimeAgentProps) {
  const adapter = useQwenRealtimeAdapter({
    createSession,
    instructions,
    voice,
    tools,
    turnDetection,
    transcribeInput,
    greeting,
  });

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
