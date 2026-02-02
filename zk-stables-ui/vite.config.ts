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
    // Let Vite pre-bundle WASM deps once; excluding caused repeated slow transforms.
    include: ['buffer', 'react', 'react-dom', 'react/jsx-runtime'],
  },
  build: {
    commonjsOptions: { transformMixedEsModules: true },
  },
  server: {
    fs: { allow: ['..'] },
    // Do not warm the entire dependency graph at startup (Midnight + WASM is huge).
    warmup: {
      clientFiles: ['./index.html', './src/main.tsx', './src/globals.ts'],
    },
  },
}));
