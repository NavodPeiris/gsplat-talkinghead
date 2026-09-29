/** Names of the built-in avatars, usable as the `avatar` prop. */
export const AVATAR_PRESETS = ['Jack', 'Jane', 'John', 'Sasha'] as const;

/** A built-in avatar name. */
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

/** Avatar used when neither `avatar` nor `assetsPath` is given. */
export const DEFAULT_AVATAR_PRESET: AvatarPreset = 'Jane';

// Preset bundles are NOT shipped in the npm package (they're ~16 MB). They
// live in the GitHub repo's `main` branch and are served by jsDelivr's GitHub
// CDN. Every installed version loads the current bundles on `main`, and
// jsDelivr caches branch files (~12 h), so updated zips take a while to
// propagate unless the cache is purged (https://www.jsdelivr.com/tools/purge).
const GITHUB_REPO = 'NavodPeiris/gsplat-talkinghead';
const ASSETS_DIR = 'gsplat-talkinghead/assets';
const CDN_BASE_URL = `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main/${ASSETS_DIR}`;

// Override lives on globalThis, not in module scope: the CJS build doesn't
// share chunks between entry points, so `gsplat-talkinghead` and e.g.
// `gsplat-talkinghead/openai` each get their own copy of this module.
const BASE_URL_KEY = '__GSPLAT_TALKINGHEAD_PRESETS_BASE_URL__';
const store = globalThis as Record<string, unknown>;

/**
 * Changes where preset bundles are fetched from — e.g. to self-host the
 * repo's `gsplat-talkinghead/assets/` folder (strict CSP, offline, or a local
 * dev server). Call once at startup.
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
