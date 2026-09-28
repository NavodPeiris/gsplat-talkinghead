// Centralized ARKit Blendshape Names
// Single source of truth for all 52 ARKit blendshape names

export const ARKIT_BLENDSHAPE_NAMES = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight',
  'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight',
  'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight',
  'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight', 'tongueOut',
] as const;

export type ArkitBlendshapeName = (typeof ARKIT_BLENDSHAPE_NAMES)[number];

export const ARKIT_BLENDSHAPE_COUNT = ARKIT_BLENDSHAPE_NAMES.length; // 52

/**
 * Lower-face blendshapes amplified to make mouth movement visible (see
 * MOUTH_GAIN). Deliberately excludes `mouthFunnel` and `mouthPucker` from
 * the reference LAM_Audio2Expression pipeline's own MOUTH_BLENDSHAPES
 * grouping: both round/purse the lips into an "O" shape, which combined
 * with an amplified `jawOpen` produced an exaggerated, gaping/"screaming"
 * look — the model's per-chunk output has no cross-chunk temporal
 * smoothing (the reference pipeline's own Savitzky-Golay smoothing step
 * was not ported), so these can spike alongside jawOpen without the
 * softening a real, continuous prediction would have. Also excludes
 * `mouthRollLower/Upper`, `mouthShrugLower/Upper`, `mouthPressLeft/Right`,
 * `noseSneerLeft/Right`, and `cheekPuff` as lower-value/more conflict-prone
 * shapes for a chunked, unsmoothed signal.
 */
export const MOUTH_BLENDSHAPE_NAMES: readonly ArkitBlendshapeName[] = [
  'jawOpen',
  'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight',
  'mouthSmileLeft', 'mouthSmileRight',
  'mouthStretchLeft', 'mouthStretchRight',
  'mouthDimpleLeft', 'mouthDimpleRight',
];

/**
 * Amplification applied to `MOUTH_BLENDSHAPE_NAMES` before driving the
 * avatar. Empirically validated against real speech oscillating at the
 * real ~33ms pacing rate (not just static held values, which understated
 * the needed gain): 3x left the mouth visually indistinguishable from
 * neutral almost the whole time — only isolated peak frames were large
 * enough to register.
 *
 * A plain linear gain + hard clamp (the first version of this) made loud
 * frames flatten several different blendshapes to an identical 1.0
 * simultaneously — an unnatural, "maxed out" combination in practice. The
 * exponential curve below has the same small-signal gain (so typical quiet
 * speech is still clearly visible) but saturates smoothly, so louder
 * frames keep some relative shape instead of all pinning to the ceiling.
 */
export const MOUTH_GAIN = 10;

/**
 * Soft ceiling the saturation curve approaches, rather than hard-clamping
 * to 1.0. Lowered from an initial 0.85 — even with the smooth curve, peaks
 * that close to fully open still read as an exaggerated, unnatural gape,
 * and the Gaussian-splat renderer visibly blurs/smears soft-tissue lip
 * shapes (unlike the more rigid jaw rotation) once deformed far from their
 * trained rest pose.
 */
export const MOUTH_MAX = 0.4;

/**
 * Per-shape ceiling multipliers (relative to MOUTH_MAX), for shapes that
 * need extra damping beyond the general ceiling. `mouthLowerDownLeft/Right`
 * specifically visibly blurs on this avatar rig at moderate-to-large
 * values — soft lower-lip tissue deforming far from rest pose is more
 * splat-rendering-artifact-prone than the jaw's more rigid rotation.
 */
const MOUTH_SHAPE_CEILING_MULTIPLIER: Partial<Record<ArkitBlendshapeName, number>> = {
  mouthLowerDownLeft: 0.4,
  mouthLowerDownRight: 0.4,
};

/**
 * Applies MOUTH_GAIN to the mouth/jaw blendshapes in `weights` via a smooth
 * saturating curve (`ceiling * (1 - e^-(MOUTH_GAIN * x))`), which behaves
 * like a `MOUTH_GAIN`x linear multiplier for small values but eases off
 * approaching its ceiling (MOUTH_MAX, scaled per-shape by
 * MOUTH_SHAPE_CEILING_MULTIPLIER) instead of hard-clamping. Mutates and
 * returns `weights`.
 */
export function applyMouthGain(weights: Record<string, number>): Record<string, number> {
  for (const name of MOUTH_BLENDSHAPE_NAMES) {
    const value = weights[name];
    if (value !== undefined && value > 0) {
      const ceiling = MOUTH_MAX * (MOUTH_SHAPE_CEILING_MULTIPLIER[name] ?? 1);
      weights[name] = ceiling * (1 - Math.exp(-MOUTH_GAIN * value));
    }
  }
  return weights;
}

/**
 * Create a neutral weights object with all blendshapes set to 0.
 * Includes a subtle default smile, matching the wav2arkit model's resting pose.
 */
export function createNeutralWeights(): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const name of ARKIT_BLENDSHAPE_NAMES) {
    weights[name] = 0;
  }
  weights['mouthSmileLeft'] = 0.2;
  weights['mouthSmileRight'] = 0.2;
  weights['jawOpen'] = 0.02;

  return weights;
}

/** Fast copy of weights from source to destination, defaulting missing keys to 0. */
export function copyWeights(source: Record<string, number>, dest: Record<string, number>): void {
  for (const name of ARKIT_BLENDSHAPE_NAMES) {
    dest[name] = source[name] ?? 0;
  }
}
