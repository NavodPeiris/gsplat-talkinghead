<div align="center">

<img alt="NPM Version" src="https://img.shields.io/npm/v/gsplat-talkinghead">
<img alt="NPM Downloads" src="https://img.shields.io/npm/dy/gsplat-talkinghead">
<img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/NavodPeiris/gsplat-talkinghead">

# gsplat-talkinghead

Lip-Synced Gaussian-Splat avatar components for AI voice agents. Drop it into any React app, pick a provider, and hand it your credentials — everything else is handled internally. **No infrastructure provisioning — Gaussian-splat rendering and wav2arkit neural lipsync both run directly in the browser.**

Supported providers: **OpenAI Realtime API**, **ElevenLabs Conversational AI Agents**, **Vapi Agents**, **LiveKit Agents**. **Qwen Realtime (Alibaba Cloud)**

</div>

## Requirements

| Peer dependency                          | Version |
| ---------------------------------------- | ------- |
| `@myned-ai/gsplat-flame-avatar-renderer` | ≥ 1.4.0 |
| `react`                                  | ≥ 18    |
| `react-dom`                              | ≥ 18    |
| `@elevenlabs/react`                      | ≥ 1.0.2 |
| `@vapi-ai/web`                           | ≥ 2.5.2 |
| `livekit-client`                         | 2.16.1  |

Optional depending on your provider usecase:

`@elevenlabs/react`  
`@vapi-ai/web`  
`livekit-client`

---

## Installation

```bash
npm install gsplat-talkinghead
```

---

## Environment setup

Provider **secret keys belong on your backend**, never in browser code. Each
component asks for credentials through a callback (`getEphemeralKey`,
`getConversationToken`, `getToken`, `createSession`): implement it by calling
your own backend route, which uses the secret to mint a short-lived token (or
forward a WebRTC offer) and returns only that to the browser.

| Provider                                      | Backend env (secret)                          | Browser env (public) | What your backend serves                                                                 |
| --------------------------------------------- | --------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| [OpenAI Realtime](#openai)                    | `OPENAI_API_KEY`                              | —                    | `getEphemeralKey` → ephemeral key from `POST /v1/realtime/client_secrets`                |
| [OpenAI GPT-Live](#openai-gpt-live)           | `OPENAI_API_KEY`                              | —                    | `createSession` → SDP answer from `POST /v1/live/sessions`                               |
| [Qwen realtime](#qwen-realtime-alibaba-cloud) | `DASHSCOPE_API_KEY`, `DASHSCOPE_WORKSPACE_ID` | —                    | `createSession` → SDP answer from Model Studio's WebRTC endpoint                         |
| [ElevenLabs](#elevenlabs)                     | `ELEVENLABS_API_KEY`                          | agent ID             | `getConversationToken` → conversation token for your agent                               |
| [Vapi](#vapi)                                 | —                                             | `VAPI_PUBLIC_KEY`    | Nothing — the public key is browser-safe; restrict allowed domains in the Vapi dashboard |
| [LiveKit](#livekit)                           | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`       | `LIVEKIT_URL`        | `getToken` → room access token                                                           |

Example files (only include the providers you use):

```bash
# backend/.env — server only, never shipped to the browser
OPENAI_API_KEY=sk-...
DASHSCOPE_API_KEY=sk-...
DASHSCOPE_WORKSPACE_ID=ws-...
ELEVENLABS_API_KEY=...
LIVEKIT_API_KEY=API...
LIVEKIT_API_SECRET=...
```

```bash
# frontend/.env — public values only (use your bundler's prefix:
# VITE_ for Vite, NEXT_PUBLIC_ for Next.js, REACT_APP_ for Create React App)
VITE_VAPI_PUBLIC_KEY=...
VITE_LIVEKIT_URL=wss://<project>.livekit.cloud
```

Anything with a bundler prefix is embedded in your JavaScript bundle and
visible to users, so never give a secret key one of those prefixes.

To try the providers locally without a backend, see the
[`test-env` playground](test-env/README.md), which reads keys from its own
`.env` (for local testing only).

---

## Providers

- [OpenAI](#openai)
- [OpenAI GPT-Live](#openai-gpt-live)
- [Qwen realtime (Alibaba Cloud)](#qwen-realtime-alibaba-cloud)
- [ElevenLabs](#elevenlabs)
- [Vapi](#vapi)
- [LiveKit](#livekit)

---

## OpenAI

Uses the OpenAI Realtime API over WebRTC. Requires a server-side endpoint to mint ephemeral session keys.

```tsx
import { OpenAIRealtimeAgent } from "gsplat-talkinghead/openai";
import type { OpenAIRealtimeTool } from "gsplat-talkinghead";

const tools: OpenAIRealtimeTool[] = [
  {
    name: "get_product_price",
    description: "Returns the current price of a product.",
    parameters: {
      type: "object",
      properties: {
        product_name: { type: "string", description: "Name of the product" },
      },
      required: ["product_name"],
    },
    handler: ({ product_name }) => {
      const prices: Record<string, string> = {
        "apple iphone 15 pro max": "$1,199",
        "samsung galaxy s23 ultra": "$1,099",
        "sony wh-1000xm5": "$349",
        "dell xps 13": "$999",
        "amazon echo dot": "$49",
      };
      const price =
        prices[(product_name as string).toLowerCase()] ?? "Price not available";
      return { product_name, price };
    },
  },
];

<OpenAIRealtimeAgent
  backgroundImages={["/niceBG.jpg"]}
  agentVoice="nova"
  tools={tools}
  getEphemeralKey={async () => {
    const res = await fetch("/api/realtime-session");
    const { client_secret } = await res.json();
    return client_secret;
  }}
/>;
```

**Backend — ephemeral key endpoint**

```ts
// app/api/realtime-session/route.ts  (Next.js App Router)
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.REACT_APP_OPENAI_API_KEY,
});

const sys_prompt = `
# ROLE
You are a product recommendation assistant for Amazon who answers user questions and recommends products based on their preferences.
at initial greeting, say 'Hello! I am your product specialist at Amazon. I can help you find products — feel free to tell me what you are looking for!'
DO NOT repeat it again.

These are currently available products:
1. Apple iPhone 15 Pro Max - iPhone 15 Pro Max delivers premium performance with a lightweight titanium design, stunning 6.7-inch Super Retina XDR display with ProMotion, and the powerful A17 Pro chip. Capture incredible detail with its advanced Pro camera system featuring a 48MP main sensor and 5x optical zoom.
2. Samsung Galaxy S23 Ultra - A high-end Android phone with a stunning display, versatile cameras, and long battery life.
3. Sony WH-1000XM5 Wireless Noise-Canceling Headphones - Premium headphones with industry-leading noise cancellation, exceptional sound quality, and comfortable design.
4. Dell XPS 13 Laptop - A sleek and powerful ultrabook with a stunning InfinityEdge display, Intel Core i7 processor, and long battery life.
5. Amazon Echo Dot (5th Gen) - A compact smart speaker with Alexa voice assistant, perfect for controlling smart home devices, playing music, and getting information.
Always recommend products based on the user's preferences and needs. If the user asks for a specific product, provide information about it and suggest similar alternatives if available.
When the user says goodbye or is done, say "this is the end" to close the session.

# TOOLS
if user asks for product prices, use the get_product_price tool to retrieve the current price of the product and include it in your response.
`;

export async function GET() {
  const session = await openai.realtime.clientSecrets.create({
    session: {
      type: "realtime",
      model: "gpt-realtime-mini-2025-10-06",
      instructions: sys_prompt,
    },
  });

  return Response.json({ client_secret: session.value });
}
```

### Props

| Prop              | Type                        | Default      | Description                                                                                     |
| ----------------- | --------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `systemPrompt`    | `string`                    | **required** | Instructions injected into the realtime agent on connect.                                       |
| `getEphemeralKey` | `() => Promise<string>`     | **required** | Called once per connection. Must resolve to an OpenAI ephemeral key.                            |
| `tools`           | `ReturnType<typeof tool>[]` | `[]`         | Tools the agent can call. Use the `tool()` helper from `@openai/agents/realtime`.               |
| `agentVoice`      | `string`                    | `"sage"`     | OpenAI Realtime voice. Options: `alloy` `ash` `ballad` `coral` `echo` `sage` `shimmer` `verse`. |

Runs full wav2arkit neural lipsync — OpenAI's WebRTC session exposes a real remote `MediaStream`.

---

## OpenAI GPT-Live

[`gpt-live-1`](https://developers.openai.com/api/docs/models/gpt-live-1) is
OpenAI's full-duplex voice model: it keeps listening while it speaks and hands
reasoning and tool calls to a backend model. It uses its own endpoint
(`POST /v1/live/sessions`), not the Realtime API, so it has its own component.

GPT-Live sessions are created with a standard API key, so the WebRTC
handshake goes through **your backend**: the component gives you the
browser's SDP offer, your server creates the session and returns the SDP
answer.

```tsx
import { OpenAILiveAgent } from "gsplat-talkinghead/openai";

<OpenAILiveAgent
  avatar="Jane"
  createSession={async (offerSdp) => {
    const res = await fetch("/api/live-session", {
      method: "POST",
      body: offerSdp,
    });
    return res.text(); // SDP answer
  }}
  tools={tools} // same shape as <OpenAIRealtimeAgent tools>
/>;
```

```ts
// Your backend — POST /api/live-session
const res = await fetch("https://api.openai.com/v1/live/sessions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    session: {
      model: "gpt-live-1",
      instructions: "You are a helpful assistant.",
      audio: { output: { voice: "willow" } },
      delegation: { type: "responses", responses: { model: "gpt-5.6-terra" } },
    },
    transport: { type: "webrtc", sdp: offerSdp },
  }),
});
const { transport } = await res.json();
return transport.sdp;
```

Model, voice, instructions and delegation are fixed when the session starts,
so they're configured on the backend rather than as component props.

### Props

| Prop            | Type                                    | Default      | Description                                                                                                        |
| --------------- | --------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `createSession` | `(offerSdp: string) => Promise<string>` | **required** | Sends the SDP offer to your backend and resolves to GPT-Live's SDP answer.                                         |
| `tools`         | `OpenAIRealtimeTool[]`                  | `[]`         | Browser-side function tools. Registered on the Responses delegation backend; needs `delegation.type: "responses"`. |

Runs full wav2arkit neural lipsync — agent audio arrives as a WebRTC media track.
Unlike `OpenAIRealtimeAgent`, it doesn't send an opening prompt on connect, so the user may need to speak first.

---

## Qwen realtime (Alibaba Cloud)

[`qwen3.8-omni-flash-realtime`](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-omni-flash-realtime)
is Alibaba's full-duplex speech-to-speech model, at roughly $0.93 / $1.87 per
1M audio tokens in / out (Singapore). It connects over WebRTC.

The WebRTC SDP exchange is authenticated with your DashScope API key, so it
goes through **your backend**: the component gives you the browser's SDP
offer, your server forwards it and returns the answer.

```tsx
import { QwenRealtimeAgent } from "gsplat-talkinghead/qwen";

<QwenRealtimeAgent
  avatar="Jane"
  instructions="You are a helpful assistant."
  tools={tools} // same shape as <OpenAIRealtimeAgent tools>
  createSession={async (offerSdp) => {
    const res = await fetch("/api/qwen-session", {
      method: "POST",
      body: offerSdp,
    });
    return res.text(); // SDP answer
  }}
/>;
```

```ts
// Your backend — POST /api/qwen-session
const res = await fetch(
  `https://${WORKSPACE_ID}.ap-southeast-1.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.8-omni-flash-realtime`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
      Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
    },
    body: offerSdp,
  },
);
return res.text();
```

Use the `cn-beijing` host and a Beijing API key for the China (Beijing)
region.

### Props

| Prop              | Type                                    | Default                  | Description                                                            |
| ----------------- | --------------------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `createSession`   | `(offerSdp: string) => Promise<string>` | **required**             | Sends the SDP offer to your backend and resolves to Qwen's SDP answer. |
| `instructions`    | `string`                                | —                        | System prompt.                                                         |
| `voice`           | `string`                                | `"Tina"`                 | A voice from Model Studio's voice list.                                |
| `tools`           | `OpenAIRealtimeTool[]`                  | `[]`                     | Browser-side function tools.                                           |
| `turnDetection`   | `"server_vad" \| "semantic_vad"`        | `"server_vad"`           | WebRTC only supports server-side turn detection.                       |
| `transcribeInput` | `boolean`                               | `false`                  | Also transcribe the user's speech (billed separately).                 |
| `greeting`        | `string \| false`                       | greet per `instructions` | Instruction for the agent's opening turn; `false` waits for the user.  |

Runs full wav2arkit neural lipsync — agent audio arrives as a WebRTC media track.

The agent speaks first by default (see `greeting`).

---

## ElevenLabs

Uses the ElevenLabs Conversational AI SDK. Configure your agent in the ElevenLabs dashboard and pass its ID here.

```tsx
import { ElevenLabsAvatarAgent } from "gsplat-talkinghead/elevenlabs";

// Public agent (no auth required)
<ElevenLabsAvatarAgent
  agentId="your-agent-id"
/>

// Private agent (fetch a short-lived token server-side)
<ElevenLabsAvatarAgent
  backgroundImages={["/niceBG.jpg"]}
  agentId="your-agent-id"
  getConversationToken={async () => {
    const res = await fetch("/api/elevenlabs-token");
    const { token } = await res.json();
    return token;
  }}
/>
```

**Backend — conversation token endpoint**

```ts
// app/api/elevenlabs-token/route.ts
export async function GET(req: Request) {
  const agentId = new URL(req.url).searchParams.get("agentId");
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`,
    { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! } },
  );
  return Response.json(await res.json());
}
```

### Props

| Prop                   | Type                               | Default      | Description                                                      |
| ---------------------- | ---------------------------------- | ------------ | ---------------------------------------------------------------- |
| `agentId`              | `string`                           | **required** | Agent ID from the ElevenLabs dashboard.                          |
| `getConversationToken` | `() => Promise<string>`            | —            | Required for private agents. Returns a short-lived WebRTC token. |
| `clientTools`          | `Record<string, (...args) => any>` | —            | Client-side tools exposed to the agent.                          |

> **Lipsync note:** the ElevenLabs SDK only exposes frequency-magnitude and volume scalars, never raw waveform audio, so the wav2arkit neural model can't run for this provider. ElevenLabs falls back to coarse, volume-driven mouth movement instead of full lipsync.

---

## Vapi

Uses the Vapi Web SDK. Configure your assistant in the Vapi dashboard or pass an inline configuration object.

```tsx
import { VapiAvatarAgent } from "gsplat-talkinghead/vapi";

// Using a pre-configured assistant ID
<VapiAvatarAgent
  publicKey="your-vapi-public-key"
  assistantId="your-assistant-id"
/>

// Using an inline assistant config
<VapiAvatarAgent
  backgroundImages={["/niceBG.jpg"]}
  publicKey="your-vapi-public-key"
  assistant={{
    model: {
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: "You are a helpful assistant." }],
    },
    voice: { provider: "11labs", voiceId: "sarah" },
  }}
/>
```

### Props

| Prop          | Type                  | Default      | Description                                                                   |
| ------------- | --------------------- | ------------ | ----------------------------------------------------------------------------- |
| `publicKey`   | `string`              | **required** | Your Vapi public key (safe to expose in the browser).                         |
| `assistantId` | `string`              | —            | Pre-configured assistant ID. Mutually exclusive with `assistant`.             |
| `assistant`   | `Record<string, any>` | —            | Inline assistant configuration object. Mutually exclusive with `assistantId`. |

Runs full wav2arkit neural lipsync — Vapi's Web SDK exposes a real remote `MediaStream`.

---

## LiveKit

Uses LiveKit Agents over WebRTC. Your LiveKit agent must be running server-side and the token must grant access to the correct room.

```tsx
import { LiveKitAvatarAgent } from "gsplat-talkinghead/livekit";

<LiveKitAvatarAgent
  backgroundImages={["/niceBG.jpg"]}
  serverUrl="wss://my-project.livekit.cloud"
  getToken={async () => {
    const res = await fetch("/api/livekit-token");
    const { token } = await res.json();
    return token;
  }}
/>;
```

**Backend — participant token endpoint**

```ts
// app/api/livekit-token/route.ts
import { AccessToken } from "livekit-server-sdk";

export async function GET() {
  const token = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    { identity: `user-${Date.now()}` },
  );
  token.addGrant({ roomJoin: true, room: "agent-room" });
  return Response.json({ token: await token.toJwt() });
}
```

### Props

| Prop        | Type                    | Default      | Description                                                                                |
| ----------- | ----------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `serverUrl` | `string`                | **required** | LiveKit server WebSocket URL, e.g. `wss://my-project.livekit.cloud`.                       |
| `getToken`  | `() => Promise<string>` | **required** | Returns a short-lived participant token. Generate server-side with the LiveKit server SDK. |

Runs full wav2arkit neural lipsync — LiveKit's client exposes a real remote `MediaStream`.

---

## Shared props

All provider components accept these additional props:

| Prop               | Type           | Default             | Description                                                                                        |
| ------------------ | -------------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| `avatar`           | `AvatarPreset` | `"Jane"`            | Built-in avatar: `"Jack"`, `"Jane"`, `"John"` or `"Sasha"`. See [Avatars](#avatars) below.         |
| `assetsPath`       | `string`       | —                   | URL/path to a custom Gaussian-splat avatar asset bundle. Takes precedence over `avatar`.           |
| `backgroundImages` | `string[]`     | `[]`                | Image URLs for the background. One is chosen at random each mount. Transparent when omitted.       |
| `onSessionEnd`     | `() => void`   | —                   | Called when the session ends (end phrase detected, timeout, or user clicked End).                  |
| `endSessionPhrase` | `string`       | `"this is the end"` | Case-insensitive substring the component watches for in the agent's transcript to end the session. |
| `sessionTimeout`   | `number`       | `600000`            | Hard timeout in milliseconds.                                                                      |
| `className`        | `string`       | —                   | Extra CSS class names on the outermost container `div`.                                            |

---

## Avatars

The library ships with four preset avatars — **Jack**, **Jane**, **John** and
**Sasha** — picked with the `avatar` prop. **Jane** is used when
you pass neither `avatar` nor `assetsPath`. Nothing to configure, nothing to
host: the bundles live inside the npm package (`assets/<name>.zip`) and are
served via [jsDelivr's npm CDN](https://www.jsdelivr.com/), which mirrors
every published package's contents automatically.

```tsx
// Default preset (Jane)
<OpenAIRealtimeAgent getEphemeralKey={...} />

// Another preset
<OpenAIRealtimeAgent avatar="Jack" getEphemeralKey={...} />
```

The preset list is also exported, e.g. to build an avatar picker:

```tsx
import { AVATAR_PRESETS, type AvatarPreset } from "gsplat-talkinghead";

AVATAR_PRESETS; // ["Jack", "Jane", "John", "Sasha"]
```

To serve the presets from your own origin instead of jsDelivr (strict CSP,
offline, or local development before a version is published), copy the
package's `assets/` folder somewhere public and point the library at it once
at startup:

```ts
import { configureAvatarPresets } from "gsplat-talkinghead";

configureAvatarPresets({ baseUrl: "/avatars" }); // loads /avatars/Jack.zip, …
```

To use your own avatar instead, host a Gaussian-splat asset bundle
(compatible with
[`@myned-ai/gsplat-flame-avatar-renderer`](https://www.npmjs.com/package/@myned-ai/gsplat-flame-avatar-renderer))
and pass its URL as `assetsPath`:

```tsx
<OpenAIRealtimeAgent
  getEphemeralKey={...}
  assetsPath="https://your-cdn.example.com/avatars/your-avatar-bundle"
/>
```

---

## Emotions

Every component takes an `emotion` prop — `"neutral"`, `"happy"`, `"sad"`,
`"excited"` or `"thinking"` — layered on top of lipsync as ARKit blendshape
offsets (smile, brows, eye squint/gaze), so the avatar can smile while it
talks. Changes blend in over ~0.3 s.

Drive it from your app:

```tsx
const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
<OpenAIRealtimeAgent emotion={emotion} ... />
```

Or let the model set it with the built-in `set_emotion` tool (for providers
with browser-side tools: `OpenAIRealtimeAgent`, `OpenAILiveAgent`,
`QwenRealtimeAgent`). It returns to neutral after 8 s by default
(`createEmotionTool(setEmotion, { resetAfterMs })`):

```tsx
import { createEmotionTool, type AvatarEmotion } from "gsplat-talkinghead";

const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
const allTools = useMemo(() => [...tools, createEmotionTool(setEmotion)], []);

<OpenAIRealtimeAgent
  emotion={emotion}
  tools={allTools}
  // + in your instructions: "Call set_emotion when your feelings change:
  //   happy for good news, sad for bad news, thinking while you consider options."
/>;
```

The expressions are defined in `EMOTION_BLENDSHAPES` (exported) if you want to
see or copy the exact offsets.

---

## Advanced: adapter hooks

For full layout control, use `AvatarAgent` directly with an adapter hook. This lets you compose the avatar into your own UI without the built-in container styles.

```tsx
import { AvatarAgent } from "gsplat-talkinghead";
import { useVapiAdapter } from "gsplat-talkinghead/vapi";

function MyPage() {
  const adapter = useVapiAdapter({
    publicKey: "your-vapi-public-key",
    assistantId: "your-assistant-id",
  });

  return (
    <div className="my-layout">
      <AvatarAgent adapter={adapter} className="h-[600px]" />
    </div>
  );
}
```

All adapter hooks follow the same pattern:

```ts
useOpenAIRealtimeAdapter(options); // → SessionAdapter
useElevenLabsAdapter(options); // → SessionAdapter
useVapiAdapter(options); // → SessionAdapter
useLiveKitAdapter(options); // → SessionAdapter
```

A `SessionAdapter` exposes `remoteStream` for full neural lipsync, plus two
optional fallbacks for platforms that can't produce a `MediaStream`:
`subscribeToRemoteAudio` (push already-decoded PCM straight into wav2arkit,
for a platform whose SDK decodes raw PCM itself) and `getRemoteAudioLevel`
(a 0-1 volume scalar for coarse, volume-only mouth movement — used by
ElevenLabs). Implement one of these if you're writing a custom adapter for a
platform without a real audio stream.

---

## How it works

```
User clicks Start
      │
      ▼
Provider adapter connects (WebRTC / WebSocket)
      │
      ├── Audio ──► resample to 16kHz ──► wav2arkit (onnxruntime-web) ──► ARKit blendshapes ──► Gaussian-splat renderer
      │             (MediaStream tap, or pushed raw PCM — see Advanced: adapter hooks)
      │
      ├── Transcript ──► endSessionPhrase check ──► onSessionEnd(), End
      │
      ├── User clicks end ──► End
      |
      └── sessionTimeout ──► onSessionEnd(), End
```

The wav2arkit ONNX model
([myned-ai/wav2arkit_cpu](https://huggingface.co/myned-ai/wav2arkit_cpu), Apache-2.0)
is fetched and cached in the browser on first use — no server component
required.

---

## Package structure

```
src/
├── index.ts                    ← public exports
├── types.ts                    ← shared prop types
├── AvatarAgent.tsx              ← platform-agnostic core component
├── OpenAIRealtimeAgent.tsx       ← provider convenience wrappers
├── ElevenLabsAvatarAgent.tsx
├── VapiAvatarAgent.tsx
├── LiveKitAvatarAgent.tsx
├── avatar/
│   ├── GaussianAvatarController.ts   ← wraps @myned-ai/gsplat-flame-avatar-renderer
│   ├── LazyAvatarController.ts       ← lazy-loads the renderer + lipsync engine
│   └── AvatarContainer.tsx           ← React mount point + background image
├── constants/
│   └── arkit.ts                 ← ARKit blendshape names, neutral pose
├── adapters/
│   ├── SessionAdapter.ts        ← adapter interface
│   ├── openai/
│   ├── elevenlabs/
│   ├── vapi/
│   └── livekit/
└── audio/
    ├── wav2arkit/
    │   ├── modelLoader.ts        ← fetches + caches the ONNX model
    │   ├── resample.ts           ← resamples audio to 16kHz
    │   ├── inferenceEngine.ts    ← onnxruntime-web session
    │   └── liveLipsync.ts        ← streaming/paced inference pipeline
    ├── useAvatarLipsync.ts       ← wires a MediaStream into wav2arkit
    ├── usePushAudioLipsync.ts    ← wires pushed raw PCM into wav2arkit
    ├── useVolumeFallbackLipsync.ts ← coarse fallback for stream-less adapters
    └── useAudio.ts               ← mic monitoring
```

---

## Contribution Guide

To contribute to package source code, raise PRs to the `main` branch.

---

## Sponsoring ❤️

**gsplat-talkinghead is free, open-source, and maintained in personal time.**

If your product ships AI-powered conversations and this library saves you weeks of WebRTC wrangling, lip-sync work, and provider integration — consider sponsoring. Even a small recurring amount keeps the library maintained, more providers supported, and bugs fixed fast.

[**Sponsor on GitHub →**](https://github.com/sponsors/navodPeiris)

---

## Citing this project

If you use gsplat-talkinghead in academic work, a research demo, or a published product, a citation or acknowledgement is appreciated.

**BibTeX**

```bibtex
@software{peiris2026gsplattalkinghead,
  author  = {Peiris, Navod},
  title   = {gsplat-talkinghead: LAM Gaussian-Splat Avatars for AI voice agents},
  year    = {2026},
  url     = {https://github.com/NavodPeiris/gsplat-talkinghead},
  note    = {npm: gsplat-talkinghead}
}
```

**Plain text**

> Navod Peiris. _gsplat-talkinghead: LAM Gaussian-Splat Avatars for AI voice agents._ 2026. https://github.com/NavodPeiris/gsplat-talkinghead

**Acknowledgement (for README or paper footnote)**

> Gaussian-splat avatar and lip-sync powered by [gsplat-talkinghead](https://github.com/NavodPeiris/gsplat-talkinghead).
