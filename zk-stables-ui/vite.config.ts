import path from 'node:path';
import { fileURLToPath } from 'node:url';
import inject from '@rollup/plugin-inject';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractRoot = path.resolve(__dirname, '../contract/dist');

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
  ],
  resolve: {
    dedupe: [
      '@midnight-ntwrk/compact-runtime',
      '@midnight-ntwrk/compact-js',
      '@midnight-ntwrk/onchain-runtime-v3',
    ],
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@midnight-ntwrk/compact-runtime': path.resolve(__dirname, 'node_modules/@midnight-ntwrk/compact-runtime'),
      '@midnight-ntwrk/compact-js': path.resolve(__dirname, 'node_modules/@midnight-ntwrk/compact-js'),
      '@midnight-ntwrk/onchain-runtime-v3': path.resolve(__dirname, 'node_modules/@midnight-ntwrk/onchain-runtime-v3'),
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
    warmup: {
      clientFiles: ['./index.html', './src/main.tsx', './src/globals.ts', './src/bootstrap.tsx'],
    },
  },
}));
