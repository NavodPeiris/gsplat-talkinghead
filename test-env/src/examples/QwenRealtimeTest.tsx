import { QwenRealtimeAgent } from "gsplat-talkinghead/qwen";
import { sys_prompt, tools } from "./OpenAIRealtimeTest";

// The dev server proxies /qwen-session to Model Studio and adds your DashScope
// API key (see craco.config.js), so the key never reaches the browser and
// Model Studio's missing CORS headers don't matter. In production, do the same
// in a backend route.
async function createSession(offerSdp: string): Promise<string> {
  // Model Studio's WebRTC gateway occasionally returns a transient 500
  // ("No gRPC response received"); retry once before giving up.
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("/qwen-session?model=qwen3.8-omni-flash-realtime", {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offerSdp,
    });
    if (res.ok) return res.text();
    const body = await res.text();
    if (res.status >= 500 && attempt < 2) {
      console.warn(`Qwen SDP exchange failed (${res.status}), retrying…`, body);
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    throw new Error(`Qwen SDP exchange failed (${res.status}): ${body}`);
  }
}

export default function QwenRealtimeTest() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <QwenRealtimeAgent
        avatar="Jane"
        voice="Jennifer"
        backgroundImages={["/niceBG.jpg"]}
        instructions={sys_prompt}
        tools={tools}
        createSession={createSession}
        onSessionEnd={() => alert("Session ended")}
        sessionTimeout={2 * 60 * 1000}
      />
    </div>
  );
}
