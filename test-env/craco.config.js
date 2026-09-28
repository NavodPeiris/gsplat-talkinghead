const fs = require('fs');
const path = require('path');

// Minimal .env reader for dev-server-only secrets (CRA only exposes REACT_APP_*
// vars to the browser bundle; these stay in Node).
function readEnv() {
  const env = {};
  for (const file of ['.env', '.env.local']) {
    const p = path.resolve(__dirname, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return { ...env, ...process.env };
}

const env = readEnv();
const DASHSCOPE_API_KEY = env.DASHSCOPE_API_KEY || env.REACT_APP_DASHSCOPE_API_KEY;
const DASHSCOPE_WORKSPACE_ID = env.DASHSCOPE_WORKSPACE_ID || env.REACT_APP_DASHSCOPE_WORKSPACE_ID;

module.exports = {
  // Serve the package's preset avatar bundles at /avatars (see
  // configureAvatarPresets in src/index.tsx) — jsDelivr only mirrors
  // published npm versions, so unpublished presets aren't on the CDN yet.
  devServer: (devServerConfig) => {
    devServerConfig.static = [
      ...[].concat(devServerConfig.static || []),
      { directory: path.resolve(__dirname, '../gsplat-talkinghead/assets'), publicPath: '/avatars' },
    ];

    // Qwen realtime: Model Studio doesn't allow browser (CORS) requests, and the
    // SDP exchange needs the API key — proxy it through the dev server, which
    // adds the key so it never reaches the browser. Production needs the same
    // thing as a backend route.
    if (DASHSCOPE_API_KEY && DASHSCOPE_WORKSPACE_ID) {
      devServerConfig.proxy = [
        ...[].concat(devServerConfig.proxy || []),
        {
          context: ['/qwen-session'],
          target: `https://${DASHSCOPE_WORKSPACE_ID}.ap-southeast-1.maas.aliyuncs.com`,
          changeOrigin: true,
          secure: true,
          pathRewrite: { '^/qwen-session': '/api/v1/webrtc/realtime' },
          headers: { Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
          // Send only what Model Studio needs. The browser attaches localhost
          // cookies (often from other dev apps) plus Origin/Referer/sec-*
          // headers; forwarding those to a third party is wrong and can make
          // its gateway fail.
          onProxyReq: (proxyReq) => {
            for (const name of proxyReq.getHeaderNames()) {
              if (name === 'cookie' || name === 'origin' || name === 'referer' || name.startsWith('sec-')) {
                proxyReq.removeHeader(name);
              }
            }
          },
          onProxyRes: (proxyRes, req) => {
            if (proxyRes.statusCode >= 400) {
              console.warn(`[qwen-session] ${req.method} ${req.url} → ${proxyRes.statusCode}`);
            }
          },
        },
      ];
    }
    return devServerConfig;
  },
  webpack: {
    alias: {
      'gsplat-talkinghead$': path.resolve(__dirname, '../gsplat-talkinghead/src/index.ts'),
      'gsplat-talkinghead/openai': path.resolve(__dirname, '../gsplat-talkinghead/src/openai.ts'),
      'gsplat-talkinghead/vapi': path.resolve(__dirname, '../gsplat-talkinghead/src/vapi.ts'),
      'gsplat-talkinghead/elevenlabs': path.resolve(__dirname, '../gsplat-talkinghead/src/elevenlabs.ts'),
      'gsplat-talkinghead/livekit': path.resolve(__dirname, '../gsplat-talkinghead/src/livekit.ts'),
      'gsplat-talkinghead/qwen': path.resolve(__dirname, '../gsplat-talkinghead/src/qwen.ts'),
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      '@openai/agents/realtime': path.resolve(__dirname, 'node_modules/@openai/agents/dist/realtime/index.mjs'),
      '@openai/agents': path.resolve(__dirname, 'node_modules/@openai/agents'),
    },
    configure: (webpackConfig) => {
      // Allow imports from outside src/ (gsplat-talkinghead lives one level up)
      webpackConfig.resolve.plugins = webpackConfig.resolve.plugins.filter(
        (plugin) => plugin.constructor.name !== 'ModuleScopePlugin',
      );

      // Make babel-loader also transpile gsplat-talkinghead/src TypeScript files
      const oneOfRule = webpackConfig.module.rules.find((r) => r.oneOf);
      if (oneOfRule) {
        const babelRule = oneOfRule.oneOf.find(
          (r) => r.loader && r.loader.includes('babel-loader') && r.include,
        );
        if (babelRule) {
          babelRule.include = [babelRule.include, path.resolve(__dirname, '../gsplat-talkinghead/src')].flat();
        }
      }

      // Fix: ESM packages in node_modules that use extensionless relative
      // imports (e.g. @elevenlabs/react) fail with webpack's strict ESM
      // resolver. Disable fullySpecified for .js files inside node_modules.
      webpackConfig.module.rules.push({
        test: /\.m?js$/,
        resolve: { fullySpecified: false },
        include: /node_modules/,
      });

      return webpackConfig;
    },
  },
};
