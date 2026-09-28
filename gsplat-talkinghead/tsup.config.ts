import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf-8'),
) as { version: string };

export default defineConfig({
  define: {
    // Bakes the published version into the avatar presets' jsDelivr
    // CDN URL (see src/avatar/presets.ts) so it always points at the
    // assets bundled with that exact release.
    'globalThis.__GSPLAT_TALKINGHEAD_VERSION__': JSON.stringify(pkg.version),
  },
  entry: {
    index: 'src/index.ts',
    openai: 'src/openai.ts',
    vapi: 'src/vapi.ts',
    elevenlabs: 'src/elevenlabs.ts',
    livekit: 'src/livekit.ts',
    qwen: 'src/qwen.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@myned-ai/gsplat-flame-avatar-renderer',
    '@elevenlabs/react',
    '@vapi-ai/web',
    'livekit-client',
    'uuid',
  ],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.mjs' };
  },
});
