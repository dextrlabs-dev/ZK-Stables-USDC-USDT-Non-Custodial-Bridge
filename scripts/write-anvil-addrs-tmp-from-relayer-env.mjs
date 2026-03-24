#!/usr/bin/env node
/**
 * Writes /tmp/zk-stables-anvil-addrs.json from zk-stables-relayer/.env so fund:evm-seed-zk works
 * without re-running deploy-anvil.js.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const envPath = join(REPO, 'zk-stables-relayer', '.env');
const outPath = '/tmp/zk-stables-anvil-addrs.json';

function loadEnv(path) {
  if (!existsSync(path)) throw new Error(`Missing ${path}`);
  const o = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[t.slice(0, eq).trim()] = v;
  }
  return o;
}

const e = loadEnv(envPath);
const j = {
  bridgeMint: e.RELAYER_EVM_BRIDGE_MINT,
  poolLock: e.RELAYER_EVM_POOL_LOCK,
  usdc: e.RELAYER_EVM_UNDERLYING_TOKEN,
  usdt: e.RELAYER_EVM_UNDERLYING_TOKEN_USDT ?? e.RELAYER_EVM_UNDERLYING_TOKEN,
  wUSDC: e.RELAYER_EVM_WRAPPED_TOKEN_USDC ?? e.RELAYER_EVM_WRAPPED_TOKEN,
  wUSDT: e.RELAYER_EVM_WRAPPED_TOKEN_USDT,
};
for (const [k, v] of Object.entries(j)) {
  if (!v || !String(v).startsWith('0x')) throw new Error(`Missing or invalid ${k} in relayer .env`);
}
writeFileSync(outPath, JSON.stringify(j, null, 2));
console.log('Wrote', outPath);
