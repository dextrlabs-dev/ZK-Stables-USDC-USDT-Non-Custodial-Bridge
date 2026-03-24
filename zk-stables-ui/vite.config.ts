import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import inject from '@rollup/plugin-inject';
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { VitePWA } from 'vite-plugin-pwa';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractRoot = path.resolve(__dirname, '../contract/dist');
/** npm workspaces hoist deps to the repo root; `zk-stables-ui/node_modules/@midnight-ntwrk` is often empty. */
const rootNm = path.resolve(__dirname, '../node_modules');
const midnight = (pkg: string) => path.join(rootNm, '@midnight-ntwrk', pkg);

/** Same-origin proxy for Blockfrost-compatible Yaci Store (dev + `vite preview`). */
const yaciStoreProxy: Record<string, ProxyOptions> = {
  '/yaci-store': {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/yaci-store/u, '/api/v1'),
    configure: (proxy) => {
      proxy.on('error', (err: NodeJS.ErrnoException, _req: IncomingMessage, res: ServerResponse | unknown) => {
        const r = res as ServerResponse;
        if (r?.writeHead && !r.headersSent) {
          r.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
          r.end(
            `Yaci Store unreachable (${err.code ?? err.message ?? 'ECONNREFUSED'}). Start Yaci DevKit / Store on port 8080 (see repo docs/CARDANO_LOCAL_YACI.md).`,
          );
        }
      });
    },
  },
};

export default defineConfig(({ mode, command }) => ({
  esbuild: {
    target: 'es2022',
  },
  define: {
    // `vite build --mode development` loads `.env.development` for local preview; still ship a production React build.
    'process.env.NODE_ENV': JSON.stringify(command === 'build' ? 'production' : mode === 'production' ? 'production' : 'development'),
    global: 'globalThis',
  },
  plugins: [
    inject({
      Buffer: ['buffer', 'Buffer'],
    }),
    wasm(),
    react(),
    topLevelAwait(),
    // Production: cache hashed JS/CSS/WASM (and public ZK artifacts) locally via Service Worker for fast repeat loads.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'inline',
      devOptions: { enabled: false },
      manifest: {
        name: 'ZK-Stables Bridge',
        short_name: 'ZK-Stables',
        description: 'Midnight + EVM/Cardano bridge demo',
        theme_color: '#f8fafc',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Ledger WASM + vendor chunk exceed Workbox default 2 MiB precache limit.
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,wasm,ico,svg,png,woff2,json}'],
        globIgnores: ['**/mockServiceWorker.js'],
        // Precache covers hashed bundles + WASM; this catches ZK files under /keys/ and /zkir/ with any extension.
        runtimeCaching: [
          // Same-origin `/yaci-store` proxies to Yaci Store (dev/preview); never cache API responses (avoids stale 503).
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/yaci-store'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/keys/') || url.pathname.startsWith('/zkir/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'zk-artifacts',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    dedupe: [
      '@midnight-ntwrk/compact-runtime',
      '@midnight-ntwrk/compact-js',
      '@midnight-ntwrk/onchain-runtime-v3',
    ],
    alias: {
      // Mesh → bip39 uses `import { generateMnemonic, mnemonicToEntropy }`; CJS package breaks prod Rollup.
      bip39: path.join(__dirname, 'src/shims/bip39-esm.ts'),
      // Mesh default-imports CJS-only base32-encoding.
      'base32-encoding': path.join(__dirname, 'src/shims/base32-encoding-esm.ts'),
      'serialize-error': path.join(__dirname, 'src/shims/serialize-error-esm.ts'),
      // Subsquid hex helpers are CJS; bare `exports` can survive bundling and break preview.
      '@subsquid/util-internal-hex': path.join(__dirname, 'src/shims/subsquid-util-internal-hex.ts'),
      // CJS @subsquid/scale-codec leaves bare `exports` in TLA chunks; only Midnight address-format needs it.
      '@subsquid/scale-codec': path.join(__dirname, 'src/shims/subsquid-scale-codec-esm.ts'),
      // Other Subsquid CJS still uses `require("assert")`.
      assert: path.join(__dirname, 'src/shims/node-assert-lite.ts'),
      // @stricahq/cbors (via @meshsdk/core) extends stream.Transform; Vite externalizes Node "stream" → undefined in browser.
      stream: path.join(rootNm, 'stream-browserify'),
      // @meshsdk/provider and readable-stream expect Node's EventEmitter.
      events: path.join(rootNm, 'events'),
      '@': path.resolve(__dirname, './src'),
      '@midnight-ntwrk/compact-runtime': midnight('compact-runtime'),
      '@midnight-ntwrk/compact-js': midnight('compact-js'),
      '@midnight-ntwrk/onchain-runtime-v3': midnight('onchain-runtime-v3'),
      '@midnight-ntwrk/dapp-connector-api': midnight('dapp-connector-api'),
      '@midnight-ntwrk/ledger-v8': midnight('ledger-v8'),
      '@midnight-ntwrk/midnight-js-contracts': midnight('midnight-js-contracts'),
      '@midnight-ntwrk/midnight-js-fetch-zk-config-provider': midnight('midnight-js-fetch-zk-config-provider'),
      '@midnight-ntwrk/midnight-js-http-client-proof-provider': midnight('midnight-js-http-client-proof-provider'),
      '@midnight-ntwrk/midnight-js-indexer-public-data-provider': midnight('midnight-js-indexer-public-data-provider'),
      '@midnight-ntwrk/midnight-js-network-id': midnight('midnight-js-network-id'),
      '@midnight-ntwrk/midnight-js-types': midnight('midnight-js-types'),
      '@midnight-ntwrk/wallet-sdk-address-format': midnight('wallet-sdk-address-format'),
      '@midnight-ntwrk/wallet-sdk-facade': midnight('wallet-sdk-facade'),
      '@midnight-ntwrk/wallet-sdk-hd': midnight('wallet-sdk-hd'),
      '@midnight-ntwrk/wallet-sdk-dust-wallet': midnight('wallet-sdk-dust-wallet'),
      '@midnight-ntwrk/wallet-sdk-shielded': midnight('wallet-sdk-shielded'),
      '@midnight-ntwrk/wallet-sdk-unshielded-wallet': midnight('wallet-sdk-unshielded-wallet'),
      '@contract/zk-stables': path.join(contractRoot, 'managed/zk-stables/contract/index.js'),
      '@contract/witnesses-zk-stables': path.join(contractRoot, 'witnesses-zk-stables.js'),
      '@contract/zk-stables-registry': path.join(contractRoot, 'managed/zk-stables-registry/contract/index.js'),
      '@contract/witnesses-zk-stables-registry': path.join(contractRoot, 'witnesses-registry.js'),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: { global: 'globalThis' },
    },
    // Pre-bundle the shell so the first dev request is fast.
    include: [
      'buffer',
      'process',
      'stream-browserify',
      'events',
      '@meshsdk/core',
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@emotion/react',
      '@emotion/styled',
      '@mui/material',
      '@tanstack/react-query',
      'wagmi',
      'viem',
    ],
  },
  build: {
    // Default ~ES2020 downlevels public static/instance fields in a way that breaks self-referential
    // classes (e.g. UnshieldedAddress.[Bech32mSymbol] = UnshieldedAddress.codec → temp is undefined).
    target: 'es2022',
    commonjsOptions: { transformMixedEsModules: true },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Do not split Midnight into its own chunk: it imports Ramda/Effect from `vendor`, while
          // other `vendor` modules import Midnight — a circular chunk graph leaves live bindings
          // (e.g. curry) undefined at runtime ("O is not a function" in preview).
          if (id.includes('@mui') || id.includes('@emotion')) {
            return 'mui';
          }
          if (id.includes('viem') || id.includes('wagmi') || id.includes('@tanstack')) {
            return 'evm-wallet';
          }
          return 'vendor';
        },
      },
    },
  },
  server: {
    // Prevent the browser from reusing a cached index / module graph that references deleted optimizeDeps chunks.
    headers: { 'Cache-Control': 'no-store' },
    fs: { allow: ['..'] },
    warmup: {
      clientFiles: ['./index.html', './src/main.tsx', './src/globals.ts', './src/bootstrap.tsx', './src/App.tsx'],
    },
    // Browser → Yaci Store would hit CORS; same-origin `/yaci-store` proxies to Blockfrost-compatible API.
    proxy: yaciStoreProxy,
  },
  // `vite preview` does not use `server`; `/yaci-store` must be proxied here too when using VITE_YACI_STORE_URL=/yaci-store.
  preview: {
    proxy: yaciStoreProxy,
  },
}));
