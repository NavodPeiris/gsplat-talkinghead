import { ElevenLabsAvatarAgent } from "gsplat-talkinghead/elevenlabs";

export default function ElevenLabsAvatarTest() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <ElevenLabsAvatarAgent
        avatar="Jane"
        agentId="agent_2301knhmg0caevmaa33j53q4zbds"
        getConversationToken={async () => {
          // YOU SHOULD NEVER CALL THE ELEVENLABS API DIRECTLY FROM THE BROWSER IN PRODUCTION. INSTEAD PROXY THIS REQUEST THROUGH YOUR BACKEND SERVER TO KEEP YOUR API KEY SAFE.
          const res = await fetch(
            "https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_2301knhmg0caevmaa33j53q4zbds",
            { headers: { "xi-api-key": process.env.REACT_APP_ELEVENLABS_API_KEY! } },
          );
          if (!res.ok) throw new Error(`Failed to get conversation token: ${res.status}`);
          const { token } = await res.json();
          return token;
        }}
        backgroundImages={["/niceBG.jpg"]}
        onSessionEnd={() => alert("Session ended")}
        sessionTimeout={2 * 60 * 1000}
      />
    </div>
  );
}