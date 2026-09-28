import type { ArkitBlendshapeName } from '../constants/arkit';
import type { OpenAIRealtimeTool } from '../types';

/** Facial emotions the avatar can show, layered on top of lipsync. */
export const AVATAR_EMOTIONS = ['neutral', 'happy', 'sad', 'excited', 'thinking'] as const;

export type AvatarEmotion = (typeof AVATAR_EMOTIONS)[number];

type Offsets = Partial<Record<ArkitBlendshapeName, number>>;

/**
 * ARKit blendshape offsets per emotion, added to the lipsync frame (then
 * clamped to 0–1). Kept moderate: they're held for seconds while the mouth
 * is also moving, so strong values quickly look exaggerated.
 */
export const EMOTION_BLENDSHAPES: Record<AvatarEmotion, Offsets> = {
  neutral: {},
  happy: {
    mouthSmileLeft: 0.45,
    mouthSmileRight: 0.45,
    cheekSquintLeft: 0.3,
    cheekSquintRight: 0.3,
    eyeSquintLeft: 0.15,
    eyeSquintRight: 0.15,
    browOuterUpLeft: 0.1,
    browOuterUpRight: 0.1,
  },
  sad: {
    browInnerUp: 0.55,
    browDownLeft: 0.1,
    browDownRight: 0.1,
    mouthFrownLeft: 0.4,
    mouthFrownRight: 0.4,
    mouthPressLeft: 0.1,
    mouthPressRight: 0.1,
    eyeLookDownLeft: 0.2,
    eyeLookDownRight: 0.2,
  },
  excited: {
    browInnerUp: 0.3,
    browOuterUpLeft: 0.45,
    browOuterUpRight: 0.45,
    eyeWideLeft: 0.4,
    eyeWideRight: 0.4,
    mouthSmileLeft: 0.4,
    mouthSmileRight: 0.4,
    cheekSquintLeft: 0.15,
    cheekSquintRight: 0.15,
  },
  thinking: {
    browDownLeft: 0.3,
    browInnerUp: 0.15,
    browOuterUpRight: 0.2,
    mouthPressLeft: 0.2,
    mouthPressRight: 0.2,
    mouthLeft: 0.12,
    eyeLookUpLeft: 0.35,
    eyeLookUpRight: 0.35,
    eyeLookOutLeft: 0.15,
    eyeLookInRight: 0.15,
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
