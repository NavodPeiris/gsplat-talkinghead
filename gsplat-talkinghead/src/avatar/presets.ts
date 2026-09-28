// Substituted at build time by tsup (see tsup.config.ts's `define`) with
// the published package version. Read via a `globalThis` property access
// (rather than a bare identifier) so no ambient type declaration is
// needed — this file also gets compiled as-is by consumers that alias
// straight to source (e.g. a dev harness), where the substitution never
// runs and this safely evaluates to `undefined` at runtime.
const injectedVersion = (globalThis as Record<string, unknown>).__GSPLAT_TALKINGHEAD_VERSION__;
const VERSION = typeof injectedVersion === 'string' ? injectedVersion : 'latest';

/** Names of the built-in avatars, usable as the `avatar` prop. */
export const AVATAR_PRESETS = ['Jack', 'Jane', 'John', 'Sasha'] as const;

/** A built-in avatar name. */
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

/** Avatar used when neither `avatar` nor `assetsPath` is given. */
export const DEFAULT_AVATAR_PRESET: AvatarPreset = 'Jane';

// Preset bundles ship inside the npm package (`assets/<name>.zip`) and are
// served via jsDelivr's npm CDN, which mirrors every published package's
// contents automatically — no separate hosting needed.
const CDN_BASE_URL = `https://cdn.jsdelivr.net/npm/gsplat-talkinghead@${VERSION}/assets`;

// Override lives on globalThis, not in module scope: the CJS build doesn't
// share chunks between entry points, so `gsplat-talkinghead` and e.g.
// `gsplat-talkinghead/openai` each get their own copy of this module.
const BASE_URL_KEY = '__GSPLAT_TALKINGHEAD_PRESETS_BASE_URL__';
const store = globalThis as Record<string, unknown>;

/**
 * Changes where preset bundles are fetched from — e.g. to self-host the
 * package's `assets/` folder (strict CSP, offline, or a local dev server
 * before a version is published to npm). Call once at startup.
 */
export function configureAvatarPresets({ baseUrl }: { baseUrl: string }): void {
  store[BASE_URL_KEY] = baseUrl.replace(/\/+$/, '');
}

/** URL of a preset's asset bundle. */
export function getAvatarPresetUrl(preset: AvatarPreset): string {
  const baseUrl = typeof store[BASE_URL_KEY] === 'string' ? store[BASE_URL_KEY] : CDN_BASE_URL;
  return `${baseUrl}/${preset}.zip`;
}

/**
 * Resolves the bundle to load: an explicit `assetsPath` wins, then the
 * `avatar` preset, then the default preset.
 */
export function resolveAvatarAssets(avatar?: AvatarPreset, assetsPath?: string): string {
  if (assetsPath) return assetsPath;
  if (avatar && !AVATAR_PRESETS.includes(avatar)) {
    console.warn(
      `[gsplat-talkinghead] Unknown avatar preset "${avatar}" — expected one of ${AVATAR_PRESETS.join(', ')}. Using "${DEFAULT_AVATAR_PRESET}".`,
    );
    avatar = undefined;
  }
  return getAvatarPresetUrl(avatar ?? DEFAULT_AVATAR_PRESET);
}
