/**
 * Workaround: libsodium-wrappers-sumo@0.7.16 ESM entry imports ./libsodium-sumo.mjs
 * but npm package "files" omit that sibling file (it lives in libsodium-sumo).
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs');
const destDir = join(root, 'node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm');
const dest = join(destDir, 'libsodium-sumo.mjs');

if (existsSync(src)) {
  mkdirSync(destDir, { recursive: true });
  if (!existsSync(dest)) {
    copyFileSync(src, dest);
  }
}
