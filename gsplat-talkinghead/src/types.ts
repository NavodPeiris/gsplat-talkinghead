import type { AvatarPreset } from './avatar/presets';
import type { AvatarEmotion } from './avatar/emotions';

export type SessionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

/** Drives the avatar's body animation. Facial blendshapes are driven separately, in real time, by the wav2arkit lipsync engine. */
export type ChatState = 'Idle' | 'Responding';

// ── Shared base props (common across all platform wrappers) ───────────────────

interface BaseAvatarAgentProps {
  /**
   * Built-in avatar to show: `'Jack' | 'Jane' | 'John' | 'Sasha'`.
   * Defaults to `'Jane'`. Ignored when `assetsPath` is set.
   */
  avatar?: AvatarPreset;

  /**
   * Facial emotion layered on top of lipsync: `'neutral' | 'happy' | 'sad' |
   * 'excited' | 'thinking'`. Changes blend in smoothly. Drive it from your
   * app state, or let the model set it via `createEmotionTool`.
   */
  emotion?: AvatarEmotion;

  /**
   * URL or path to a custom Gaussian-splat avatar asset bundle, compatible
   * with `@myned-ai/gsplat-flame-avatar-renderer`. Takes precedence over
   * `avatar`.
   */
  assetsPath?: string;

  /** Array of background image URLs. One is chosen at random each mount. */
  backgroundImages?: string[];

  /** Called when the agent ends the session (timeout or agent-triggered). */
  onSessionEnd?: () => void;

  /**
   * Phrase the agent says to signal the session should end.
   * Case-insensitive substring match against the transcript.
   * Defaults to `"this is the end"`.
   */
  endSessionPhrase?: string;

  /** Session hard-timeout in milliseconds. Defaults to 10 minutes. */
  sessionTimeout?: number;

  /** Extra class names applied to the outer container div. */
  className?: string;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

/** A function tool exposed to the OpenAI Realtime agent. */
export interface OpenAIRealtimeTool {
  /** Name the model uses to call this tool. */
  name: string;
  /** Description of what the tool does. */
  description: string;
  /** JSON Schema object for the tool's parameters. */
  parameters: Record<string, unknown>;
  /** Called when the model invokes the tool. Return value is sent back as the tool output. */
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

export interface OpenAIRealtimeAgentProps extends BaseAvatarAgentProps {
  /**
   * Must return a valid OpenAI ephemeral key for the realtime session.
   * Configure the model, system prompt (instructions), and tools inside the
   * session creation request:
   * ```ts
   * getEphemeralKey={async () => {
   *   const session = await openai.realtime.clientSecrets.create({
   *     session: {
   *       model: 'gpt-4o-mini-realtime-preview',
   *       instructions: 'You are a helpful assistant.',
   *     },
   *   });
   *   return session.value;
   * }}
   * ```
   */
  getEphemeralKey: () => Promise<string>;

  /**
   * OpenAI Realtime voice ID. Defaults to `"sage"`.
   * Options: `alloy` | `ash` | `ballad` | `coral` | `echo` | `sage` | `shimmer` | `verse`.
   */
  agentVoice?: string;

  /**
   * Tools to expose to the agent. Each entry declares the schema (sent to the model
   * via `session.update`) and a `handler` function called when the model invokes it.
   * The return value is sent back as the tool output.
   */
  tools?: OpenAIRealtimeTool[];
}

// ── OpenAI GPT-Live ───────────────────────────────────────────────────────────

export interface OpenAILiveAgentProps extends BaseAvatarAgentProps {
  /**
   * Exchanges the browser's WebRTC SDP offer for GPT-Live's SDP answer. Must
   * call **your backend**, which creates the session (`POST /v1/live/sessions`)
   * with its API key and returns `transport.sdp`. Set the model
   * (`gpt-live-1`), voice (`audio.output.voice`), instructions and delegation
   * there — GPT-Live fixes them when the session starts.
   */
  createSession: (offerSdp: string) => Promise<string>;

  /**
   * Browser-side function tools. Schemas are registered on the session's
   * Responses delegation backend; `handler` runs here when it calls one, and
   * the return value is sent back as the tool output. Requires the session to
   * be created with `delegation.type: "responses"`.
   */
  tools?: OpenAIRealtimeTool[];
}

// ── Qwen realtime (Alibaba Cloud Model Studio) ────────────────────────────────

export interface QwenRealtimeAgentProps extends BaseAvatarAgentProps {
  /**
   * Exchanges the browser's WebRTC SDP offer for Qwen's SDP answer. Must call
   * **your backend**, which POSTs the offer (`Content-Type: application/sdp`,
   * `Authorization: Bearer <DASHSCOPE_API_KEY>`) to
   * `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.8-omni-flash-realtime`
   * and returns the answer body. Never expose the API key to the browser.
   */
  createSession: (offerSdp: string) => Promise<string>;

  /** System prompt. */
  instructions?: string;

  /** Qwen voice name (see Model Studio's voice list). Defaults to the model's default, `Tina`. */
  voice?: string;

  /** Browser-side function tools, same shape as `OpenAIRealtimeAgent`'s. */
  tools?: OpenAIRealtimeTool[];

  /** `"server_vad"` (default) or `"semantic_vad"`. */
  turnDetection?: 'server_vad' | 'semantic_vad';

  /** Transcribe the user's speech (`qwen3-asr-flash-realtime`, billed separately). Defaults to `false`. */
  transcribeInput?: boolean;

  /**
   * Makes the agent speak first. A string is the instruction for that opening
   * turn (e.g. "Introduce yourself as Jane and ask how you can help"); `false`
   * waits for the user to speak. Defaults to greeting per your `instructions`.
   */
  greeting?: string | false;
}

// ── Vapi ──────────────────────────────────────────────────────────────────────

export interface VapiAvatarAgentProps extends BaseAvatarAgentProps {
  /** Your Vapi public key (safe to expose in the browser). */
  publicKey: string;

  /**
   * Pre-configured assistant ID from the Vapi dashboard.
   * Mutually exclusive with `assistant`.
   */
  assistantId?: string;

  /**
   * Inline assistant configuration object.
   * Mutually exclusive with `assistantId`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assistant?: Record<string, any>;
}

// ── ElevenLabs ────────────────────────────────────────────────────────────────

export interface ElevenLabsAvatarAgentProps extends BaseAvatarAgentProps {
  /** Agent ID from the ElevenLabs dashboard. */
  agentId: string;

  /**
   * Required for private/authenticated agents.
   * Fetch a short-lived WebRTC token server-side:
   *   GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id={agentId}
   *   Header: xi-api-key: <your-api-key>
   * If omitted, connects with agentId directly (public agents only).
   */
  getConversationToken?: () => Promise<string>;

  /** Optional client tools exposed to the agent. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientTools?: Record<string, (...args: any[]) => any>;
}

// ── LiveKit ───────────────────────────────────────────────────────────────────

export interface LiveKitAvatarAgentProps extends BaseAvatarAgentProps {
  /** LiveKit server WebSocket URL, e.g. wss://my-project.livekit.cloud */
  serverUrl: string;

  /**
   * Returns a short-lived participant token for the LiveKit room.
   * Generate server-side using the LiveKit server SDK.
   */
  getToken: () => Promise<string>;
}

