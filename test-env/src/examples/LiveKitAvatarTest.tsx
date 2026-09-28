import { LiveKitAvatarAgent } from "gsplat-talkinghead/livekit";

// ── Minimal LiveKit access token builder using the Web Crypto API ─────────────
// WARNING: exposes your API secret in the browser bundle. For testing only.
async function buildLiveKitToken(
  apiKey: string,
  apiSecret: string,
  roomName: string,
  participantIdentity: string,
  agentName?: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "HS256", typ: "JWT" };
  const payload: Record<string, unknown> = {
    iss: apiKey,
    sub: participantIdentity,
    nbf: now,
    exp: now + 3600,
    video: {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };

  // If the agent uses explicit dispatch (agent_name is set in the agent config),
  // embed RoomConfiguration so LiveKit dispatches it when this room is created.
  if (agentName) {
    payload.roomConfig = {
      agents: [{ agentName }],
    };
  }

  // base64url-encode a plain object via UTF-8 bytes
  const b64url = (obj: object) => {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  const signingInput = `${b64url(header)}.${b64url(payload)}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...Array.from(new Uint8Array(sig))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return `${signingInput}.${sigB64}`;
}

export default function LiveKitAvatarTest() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <LiveKitAvatarAgent
        avatar="Jane"
        serverUrl={process.env.REACT_APP_LIVEKIT_URL!}
        getToken={() =>
          buildLiveKitToken(
            process.env.REACT_APP_LIVEKIT_API_KEY!,
            process.env.REACT_APP_LIVEKIT_API_SECRET!,
            "avatar-room",
            `avatar-test-${Date.now()}`,
            process.env.REACT_APP_LIVEKIT_AGENT_NAME, // optional: only needed for explicit dispatch
          )
        }
        backgroundImages={["/niceBG.jpg"]}
        onSessionEnd={() => alert("Session ended")}
        sessionTimeout={2 * 60 * 1000}
      />
    </div>
  );
}
