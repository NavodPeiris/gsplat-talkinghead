import { useMemo, useState } from "react";
import { OpenAIRealtimeAgent } from "gsplat-talkinghead/openai";
import { AVATAR_EMOTIONS, createEmotionTool } from "gsplat-talkinghead";
import type { AvatarEmotion, OpenAIRealtimeTool } from "gsplat-talkinghead";
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.REACT_APP_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true // ONLY FOR TESTING
});

export const sys_prompt = `
# ROLE
You are a product recommendation assistant for Amazon who answers user questions and recommends products based on their preferences.
at initial greeting, say 'Hello! I am Jane, a product specialist at Amazon. I can help you find products — feel free to tell me what you are looking for!'
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

export const tools: OpenAIRealtimeTool[] = [
  {
    name: 'get_product_price',
    description: 'Returns the current price of a product.',
    parameters: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'Name of the product' },
      },
      required: ['product_name'],
    },
    handler: ({ product_name }) => {
      const prices: Record<string, string> = {
        'apple iphone 15 pro max': '$1,199',
        'samsung galaxy s23 ultra': '$1,099',
        'sony wh-1000xm5': '$349',
        'dell xps 13': '$999',
        'amazon echo dot': '$49',
      };
      const price = prices[(product_name as string).toLowerCase()] ?? 'Price not available';
      return { product_name, price };
    },
  },
];

// Tells the model when to use the set_emotion tool.
const EMOTION_PROMPT = `
# EMOTIONS
Call the set_emotion tool when your feelings change: "happy" for good news, thanks or
great deals, "sad" when something is unavailable, "thinking" while you consider
options, "neutral" otherwise. Don't mention the tool to the user.
`;

export default function OpenAIRealtimeTest() {
  const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
  // The model sets the emotion itself; it returns to neutral after 8 s.
  const allTools = useMemo(() => [...tools, createEmotionTool(setEmotion)], []);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {/* Manual triggers, for trying the expressions out. */}
      <div style={{ position: "fixed", top: 12, left: 12, zIndex: 10, display: "flex", gap: 6 }}>
        {AVATAR_EMOTIONS.map((e) => (
          <button
            key={e}
            onClick={() => setEmotion(e)}
            style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid #ccc", background: e === emotion ? "#0f172a" : "#fff", color: e === emotion ? "#fff" : "#0f172a" }}
          >
            {e}
          </button>
        ))}
      </div>
      <OpenAIRealtimeAgent
        avatar="Jane"
        agentVoice="nova"
        emotion={emotion}
        tools={allTools}
        getEphemeralKey={async () => {
          // YOU SHOULD NEVER CALL THE OPENAI API DIRECTLY FROM THE BROWSER IN PRODUCTION. INSTEAD PROXY THIS REQUEST THROUGH YOUR BACKEND SERVER TO KEEP YOUR API KEY SAFE.
          const session = await openai.realtime.clientSecrets.create({
            session: {
              type: 'realtime',
              model: 'gpt-realtime-2.1-mini',
              instructions: sys_prompt + EMOTION_PROMPT,
            },
          });
          return session.value;
        }}
        sessionTimeout={2 * 60 * 1000}
      />
    </div>
  );
}