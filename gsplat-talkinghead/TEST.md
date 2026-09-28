# Local build & test flow

This document covers how to typecheck, build, and verify the package locally — both in isolation and wired into the host app.

---

## 1. Install package dependencies

```bash
cd gsplat-talkinghead
pnpm install
```

This installs the TypeScript compiler and type stubs used for the type-check step. The heavy runtime dependency (`@myned-ai/gsplat-flame-avatar-renderer`) is a peer dependency supplied by the host app, so it is not duplicated here. `onnxruntime-web` is a regular dependency and installs normally.

---

## 2. Type-check

Run the TypeScript compiler in no-emit mode to verify there are no type errors across the whole package:

```bash
# from gsplat-talkinghead/
pnpm tsc --noEmit
```

Expected output: silence (no errors). Any `error TS…` line needs to be fixed before merging.

Common things to check when errors appear:

| Error pattern                                                  | Likely cause                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `Cannot find module '@myned-ai/gsplat-flame-avatar-renderer'`  | Run `pnpm install` first — the host app must supply this peer dependency          |
| `Cannot find module 'onnxruntime-web'`                         | Run `pnpm install` first — it's a regular dependency, not a peer                  |
| `Type … is not assignable to type 'tool'`                      | Wrong import — use `tool` from `@openai/agents/realtime`, not from `@openai/agents` |

---

## 3. Test package in host app

build package:

```bash
cd gsplat-talkinghead
pnpm i
pnpm build
```

test in host app:

```bash
cd test-env
pnpm i
# import any test agent from src/examples into App.tsx and test
pnpm start
```

### What to verify

| Check                                                     | Expected |
| ----------------------------------------------------------- | -------- |
| Page loads without console errors                         | ✓        |
| Spinner shows while the avatar bundle + ONNX model download | ✓        |
| Avatar appears after loading finishes                      | ✓        |
| Reloading the page loads the ONNX model from cache (faster, check the Network tab) | ✓        |
| **Start** button is visible                                | ✓        |
| Clicking **Start** prompts mic permission                   | ✓        |
| Avatar mouth moves when agent speaks                       | ✓        |
| Clicking **End** disconnects cleanly                       | ✓        |
| `onSessionEnd` fires on phrase / timeout                    | ✓        |
| No errors in Network tab (WebRTC connected)                | ✓        |

### Mobile verification

Open Chrome DevTools → Toggle Device Toolbar → choose a phone preset, then reload. Additional checks:

| Check                                          | Expected |
| ------------------------------------------------- | -------- |
| Avatar renders without WebGL errors on mobile GPU tier | ✓        |
| Lipsync still keeps up in near-real-time on mobile CPU (WASM inference) | ✓        |

---

## 4. Tuning mouth animation

The wav2arkit model's raw output is *real* — it does react to speech — but its natural amplitude is far too subtle to read as visible movement on most avatar rigs, and its per-chunk predictions have no smoothing across chunk boundaries (the reference LAM_Audio2Expression pipeline's own Savitzky-Golay smoothing step wasn't ported). Because of that, "does the mouth look right" is a tuning problem you'll likely want to revisit per avatar rig, not a one-time fix. All the relevant knobs live in **`src/constants/arkit.ts`**, with a corresponding change log in the doc comment above each one — read those comments for the specific evidence that led to the current values before changing them blind.

Symptom → which knob to change:

| Symptom                                                        | Knob                                                                 | How to adjust |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- | -------------- |
| Mouth barely moves / looks neutral even when the agent is clearly speaking | `MOUTH_GAIN`                                                        | Raise it (was too low at 3, workable at 10). Small-signal response scales roughly linearly with this. |
| Mouth opens too wide / looks exaggerated, "screaming", or unnatural | `MOUTH_MAX`                                                          | Lower it (0.4 as of this writing). This is a soft ceiling the curve approaches, not a hard clamp — see the curve formula in the code comment. |
| A *specific* mouth shape looks wrong (blurry, distorted, combines badly with others) at high values | `MOUTH_SHAPE_CEILING_MULTIPLIER`                                     | Add/adjust an entry for that blendshape name to scale its ceiling down (e.g. `0.6` = 60% of `MOUTH_MAX`) relative to the others, instead of lowering everything. `mouthLowerDownLeft/Right` already has one — a Gaussian-splat rendering artifact (soft lip tissue blurs when deformed far from its rest pose, more than the jaw's rigid rotation does). |
| Odd combined shapes (e.g. lips pursing into an "O" while the jaw opens) | `MOUTH_BLENDSHAPE_NAMES`                                             | Remove the offending blendshape name from the list entirely (it'll still come from the model, just won't be amplified). `mouthFunnel` and `mouthPucker` were already removed for exactly this reason. |
| Mouth flickers/twitches when nobody is speaking                | `SILENCE_GATE_CHUNKS` / `SILENCE_PEAK_THRESHOLD` in `src/audio/wav2arkit/liveLipsync.ts` | Lower `SILENCE_GATE_CHUNKS` to gate to neutral faster, or raise `SILENCE_PEAK_THRESHOLD` if genuinely-quiet speech is being misclassified as silence. |
| Mouth animation visibly starts a beat after the agent's voice, especially on short opening words | `CHUNK_MS` in `src/audio/wav2arkit/liveLipsync.ts`                    | Lower it. Latency scales with this (both the wait for the next capture tick and the inference call itself), at the cost of less acoustic context per model call — don't go far below 100ms without re-checking mouth quality, since the model may need close to a full syllable of audio to predict well. |

After changing a constant:
- If your host app aliases `gsplat-talkinghead` straight to `src/*.ts` (like `test-env`'s craco config does), just save — the dev server hot-reloads it.
- Otherwise, rebuild the package (`cd gsplat-talkinghead && pnpm build`) before retesting in the host app.

Judge all of the above by actually watching the avatar during a live conversation, not by reading logged blendshape values — a value that looks fine in isolation can still look wrong once you see the real motion, and vice versa.

---

## 6. Type-check the host app with the package included

After wiring the alias, run the host app's own type-check to catch any interface mismatches:

```bash
# from host app
pnpm tsc --noEmit
```

---

## 8. Pre-publish checklist

Before bumping the version and publishing to npm, confirm all of the following:

- [ ] `pnpm tsc --noEmit` passes with zero errors (run from `gsplat-talkinghead/`)
- [ ] Smoke test page works on desktop Chrome
- [ ] Smoke test page works on mobile Chrome (DevTools device emulation)
- [ ] `onSessionEnd` fires correctly via `endSessionPhrase`
- [ ] `onSessionEnd` fires correctly via `sessionTimeout`
- [ ] Custom `tools` are called by the agent as expected
- [ ] Custom `backgroundImages` array cycles correctly (refresh a few times)
- [ ] Omitting `avatar` and `assetsPath` loads the Jane preset from jsDelivr at `https://cdn.jsdelivr.net/npm/gsplat-talkinghead@<version>/assets/Jane.zip` — verify this URL 404s until the version is actually published (jsDelivr only mirrors published npm versions)
- [ ] Each of `avatar="Jack" | "Jane" | "John" | "Sasha"` loads its own bundle
- [ ] `configureAvatarPresets({ baseUrl })` makes presets load from that base URL instead of jsDelivr
- [ ] A custom `assetsPath` loads that bundle and overrides `avatar`
- [ ] Unmounting the component (navigate away) produces no console errors
- [ ] `package.json` `version` is bumped following semver
- [ ] `npm pack --dry-run` includes all four `assets/<name>.zip` preset bundles in the tarball

---

## 9. Publishing

```bash
cd gsplat-talkinghead

# dry run — inspect what will be included
npm pack --dry-run

# build the dist
npm build

# log into npm
npm login

# access token register
npm config set //registry.npmjs.org/:_authToken=<auth token>

# publish
npm publish --access public
```

> The `main` and `types` fields in `package.json` both point to `src/index.ts`. If consumers need a pre-compiled output, add a build step (`tsc --outDir dist`) and update those fields to point into `dist/` before publishing.
