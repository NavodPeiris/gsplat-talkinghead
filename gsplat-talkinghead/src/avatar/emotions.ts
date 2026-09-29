import type { ArkitBlendshapeName } from '../constants/arkit';
import type { OpenAIRealtimeTool } from '../types';

/** Facial emotions the avatar can show, layered on top of lipsync. */
export const AVATAR_EMOTIONS = ['neutral', 'happy', 'sad', 'thinking'] as const;

export type AvatarEmotion = (typeof AVATAR_EMOTIONS)[number];

type Offsets = Partial<Record<ArkitBlendshapeName, number>>;

/**
 * ARKit blendshape offsets per emotion, added to the lipsync frame (then
 * clamped to 0–1). Built from FACS action units and sized for the preset
 * LAM heads, whose shapes move 3–10 mm at weight 1 (eyeWide only ~2.7 mm,
 * hence it runs at full weight). Avoids pairing shapes that cancel out,
 * e.g. browInnerUp with browDown.
 */
export const EMOTION_BLENDSHAPES: Record<AvatarEmotion, Offsets> = {
  neutral: {},
  // Genuine (Duchenne) smile: a gentle lip-corner lift (AU12) — stronger
  // pulls the lips too wide — carried mostly by the cheek raise that bunches
  // the lower lids and crinkles the eyes (AU6).
  happy: {
    mouthSmileLeft: 0.4,
    mouthSmileRight: 0.4,
    cheekSquintLeft: 0.6,
    cheekSquintRight: 0.6,
    eyeSquintLeft: 0.4,
    eyeSquintRight: 0.4,
  },
  // Inner brows pulled up (AU1), lip corners down (AU15), chin raised (AU17),
  // gaze slightly lowered.
  sad: {
    browInnerUp: 0.95,
    mouthFrownLeft: 0.75,
    mouthFrownRight: 0.75,
    mouthShrugLower: 0.3,
    mouthPressLeft: 0.2,
    mouthPressRight: 0.2,
    eyeLookDownLeft: 0.3,
    eyeLookDownRight: 0.3,
  },
  // Asymmetric brows (one lowered, one raised), narrowed eye, lips pressed
  // and pulled to one side, gaze up and away.
  thinking: {
    browDownLeft: 0.6,
    browOuterUpRight: 0.55,
    browInnerUp: 0.2,
    eyeSquintLeft: 0.35,
    mouthPressLeft: 0.45,
    mouthPressRight: 0.45,
    mouthLeft: 0.3,
    mouthRollLower: 0.2,
    eyeLookUpLeft: 0.5,
    eyeLookUpRight: 0.5,
    eyeLookOutLeft: 0.35,
    eyeLookInRight: 0.35,
  },
};

export interface EmotionToolOptions {
  /** Return to `neutral` this long after the last call. `0` keeps it until changed. Defaults to 8000 ms. */
  resetAfterMs?: number;
}

/**
 * A ready-made `set_emotion` tool for the providers with browser-side tools
 * (`OpenAIRealtimeAgent`, `OpenAILiveAgent`, `QwenRealtimeAgent`). Add it to
 * `tools` and feed `onEmotion` into the component's `emotion` prop:
 *
 * ```tsx
 * const [emotion, setEmotion] = useState<AvatarEmotion>('neutral');
 * const allTools = useMemo(() => [...tools, createEmotionTool(setEmotion)], []);
 * <OpenAIRealtimeAgent tools={allTools} emotion={emotion} ... />
 * ```
 *
 * Tell the model when to use it in your instructions, e.g. "Call set_emotion
 * when your feelings change: happy for good news, sad for bad news…".
 */
export function createEmotionTool(
  onEmotion: (emotion: AvatarEmotion) => void,
  { resetAfterMs = 8000 }: EmotionToolOptions = {},
): OpenAIRealtimeTool {
  let resetTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    name: 'set_emotion',
    description:
      "Set the avatar's facial expression to match how you feel about what you're saying. " +
      'Call it when your emotion changes; keep speaking normally afterwards.',
    parameters: {
      type: 'object',
      properties: {
        emotion: { type: 'string', enum: [...AVATAR_EMOTIONS], description: 'The emotion to show.' },
      },
      required: ['emotion'],
    },
    handler: ({ emotion }) => {
      const value = AVATAR_EMOTIONS.includes(emotion as AvatarEmotion) ? (emotion as AvatarEmotion) : 'neutral';
      onEmotion(value);
      if (resetTimer) clearTimeout(resetTimer);
      if (resetAfterMs > 0 && value !== 'neutral') {
        resetTimer = setTimeout(() => onEmotion('neutral'), resetAfterMs);
      }
      return { ok: true, emotion: value };
    },
  };
}
