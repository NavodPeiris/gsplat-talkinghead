// ── Base component (use this with any adapter for full flexibility) ───────────
export { AvatarAgent } from './AvatarAgent';
export type { AvatarAgentProps } from './AvatarAgent';

// ── Adapter interface (for building custom adapters) ──────────────────────────
export type { SessionAdapter } from './adapters/SessionAdapter';

// ── Avatar presets ────────────────────────────────────────────────────────────
export { AVATAR_PRESETS, DEFAULT_AVATAR_PRESET, getAvatarPresetUrl, configureAvatarPresets } from './avatar/presets';
export type { AvatarPreset } from './avatar/presets';

// ── Emotions ──────────────────────────────────────────────────────────────────
export { AVATAR_EMOTIONS, EMOTION_BLENDSHAPES, createEmotionTool } from './avatar/emotions';
export type { AvatarEmotion, EmotionToolOptions } from './avatar/emotions';

// ── Shared types ──────────────────────────────────────────────────────────────
export type { OpenAIRealtimeTool, ChatState } from './types';

// ── Avatar controller contract (for advanced/custom expression pipelines) ─────
export type { IAvatarController } from './avatar/GaussianAvatarController';

// ── ARKit blendshape constants ─────────────────────────────────────────────────
export { ARKIT_BLENDSHAPE_NAMES, createNeutralWeights } from './constants/arkit';