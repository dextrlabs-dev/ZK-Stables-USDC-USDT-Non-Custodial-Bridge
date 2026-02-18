import path from 'node:path';
import { fileURLToPath } from 'node:url';
import inject from '@rollup/plugin-inject';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { VitePWA } from 'vite-plugin-pwa';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractRoot = path.resolve(__dirname, '../contract/dist');
/** npm workspaces hoist deps to the repo root; `zk-stables-ui/node_modules/@midnight-ntwrk` is often empty. */
const rootNm = path.resolve(__dirname, '../node_modules');
const midnight = (pkg: string) => path.join(rootNm, '@midnight-ntwrk', pkg);

export default defineConfig(({ mode }) => ({
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    global: 'globalThis',
  },
  plugins: [
    inject({
      Buffer: ['buffer', 'Buffer'],
    }),
    wasm(),
    react(),
    viteCommonjs(),
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
        theme_color: '#121212',
        background_color: '#121212',
        display: 'standalone',
        start_url: '/',
        icons: [],
      },
      workbox: {
        // Ledger WASM + vendor chunk exceed Workbox default 2 MiB precache limit.
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,wasm,ico,svg,png,woff2,json}'],
        globIgnores: ['**/mockServiceWorker.js'],
        // Precache covers hashed bundles + WASM; this catches ZK files under /keys/ and /zkir/ with any extension.
        runtimeCaching: [
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
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: { global: 'globalThis' },
    },
    // Pre-bundle the shell so the first dev request is fast; Midnight/WASM still lazy via MainApp.
    include: [
      'buffer',
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
    commonjsOptions: { transformMixedEsModules: true },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@midnight-ntwrk') || id.includes('ledger-v8')) {
            return 'midnight';
          }
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
    fs: { allow: ['..'] },
    // Warm shell only; MainApp triggers a second transform when the browser requests it.
    // Pre-transform heavy client modules so the first browser load pays less cold-compile latency (dev only).
    warmup: {
      clientFiles: [
        './index.html',
        './src/main.tsx',
        './src/globals.ts',
        './src/bootstrap.tsx',
        './src/MainApp.tsx',
        './src/contexts/ZkStablesContext.tsx',
      ],
    },
  },
}));
