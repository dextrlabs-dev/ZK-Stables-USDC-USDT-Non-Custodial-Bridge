/**
 * Mesh / wallet-sdk pulls libsodium-wrappers-sumo; npm package omits a sibling ESM file.
 * Same fix as cardano/ts/scripts/fix-libsodium.mjs, run from repo root for hoisted node_modules.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');
const src = join(root, 'libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs');
const destDir = join(root, 'libsodium-wrappers-sumo/dist/modules-sumo-esm');
const dest = join(destDir, 'libsodium-sumo.mjs');

if (existsSync(src)) {
  mkdirSync(destDir, { recursive: true });
  if (!existsSync(dest)) {
    copyFileSync(src, dest);
    console.log('[postinstall-libsodium] copied libsodium-sumo.mjs for ESM compatibility');
  }
}
