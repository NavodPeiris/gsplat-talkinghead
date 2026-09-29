import { defineConfig } from 'tsup';

export default defineConfig({
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
