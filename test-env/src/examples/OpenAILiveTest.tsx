import { OpenAILiveAgent } from "gsplat-talkinghead/openai";
import { sys_prompt, tools } from "./OpenAIRealtimeTest";

// YOU SHOULD NEVER CALL THE OPENAI API DIRECTLY FROM THE BROWSER IN PRODUCTION.
// This runs on your backend: it creates the GPT-Live session with your API key
// and returns the SDP answer to the browser.
async function createLiveSession(offerSdp: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/live/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.REACT_APP_OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        model: "gpt-live-1",
        instructions: sys_prompt,
        audio: { output: { voice: "willow" } },
        // Tool schemas are registered on this backend by the component.
        delegation: { type: "responses", responses: { model: "gpt-5.1-mini" } },
      },
      transport: { type: "webrtc", sdp: offerSdp },
    }),
  });
  if (!res.ok) throw new Error(`GPT-Live session failed (${res.status}): ${await res.text()}`);
  const { transport } = await res.json();
  return transport.sdp;
}

export default function OpenAILiveTest() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <OpenAILiveAgent
        avatar="Jane"
        backgroundImages={["/niceBG.jpg"]}
        tools={tools}
        createSession={createLiveSession}
        onSessionEnd={() => alert("Session ended")}
        sessionTimeout={2 * 60 * 1000}
      />
    </div>
  );
}
