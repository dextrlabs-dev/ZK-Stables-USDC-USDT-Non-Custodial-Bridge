#!/usr/bin/env node
/**
 * Funds Cardano demo / operator addresses on Yaci DevKit via admin `addressTopup`.
 * Fixes Mesh errors like: ada in inputs: 0, ada in outputs: 3000000 (bridge wallet unfunded).
 *
 * From repo root (loads zk-stables-relayer/.env if env vars are missing):
 *   node scripts/fund-cardano-demo-from-yaci.mjs
 *
 * Or: set -a && source zk-stables-relayer/.env && set +a && node scripts/fund-cardano-demo-from-yaci.mjs
 *
 * Requires: RELAYER_YACI_URL, RELAYER_YACI_ADMIN_URL, RELAYER_CARDANO_WALLET_MNEMONIC
 * Optional: RELAYER_CARDANO_TOPUP_ADA (default 50000), RELAYER_CARDANO_NETWORK_ID (default 0)
 * Optional: RELAYER_RELAYER_ENV path to .env (default: zk-stables-relayer/.env next to repo root)
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshWallet, YaciProvider } from '@meshsdk/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DEFAULT_ENV = join(REPO_ROOT, 'zk-stables-relayer', '.env');

function loadDotEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = val;
    }
  }
}

const envPath = process.env.RELAYER_RELAYER_ENV?.trim() || DEFAULT_ENV;
loadDotEnvFile(envPath);

const yaci = (process.env.RELAYER_YACI_URL ?? process.env.YACI_URL ?? '').trim().replace(/\/$/, '');
const admin = (process.env.RELAYER_YACI_ADMIN_URL ?? process.env.YACI_ADMIN_URL ?? '').trim().replace(/\/$/, '');
const rawMn = (process.env.RELAYER_CARDANO_WALLET_MNEMONIC ?? '').trim();
const demoMn = (process.env.RELAYER_DEMO_MNEMONIC_CARDANO ?? '').trim();
const adaAmount = String(process.env.RELAYER_CARDANO_TOPUP_ADA ?? '50000');
const networkId = Number(process.env.RELAYER_CARDANO_NETWORK_ID ?? 0);

/** Bech32 payment addresses mentioned in relayer .env (local Yaci = testnet). */
function addrsFromEnvFile(path) {
  const set = new Set();
  if (!existsSync(path)) return set;
  const text = readFileSync(path, 'utf8');
  const re = /^[A-Za-z0-9_]+=(.+)$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    let val = m[1].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val.startsWith('addr_test1')) set.add(val);
  }
  return set;
}

async function changeForMnemonic(mnemonic) {
  const words = mnemonic.trim().split(/\s+/u);
  const fs = new YaciProvider(yaci, admin);
  const wallet = new MeshWallet({
    networkId: networkId === 1 ? 1 : 0,
    fetcher: fs,
    submitter: fs,
    key: { type: 'mnemonic', words },
  });
  return wallet.getChangeAddress();
}

if (!yaci || !admin) {
  console.error('Missing RELAYER_YACI_URL and RELAYER_YACI_ADMIN_URL (or YACI_*).');
  process.exit(1);
}
if (!rawMn) {
  console.error('Missing RELAYER_CARDANO_WALLET_MNEMONIC.');
  process.exit(1);
}

const targets = new Set(addrsFromEnvFile(envPath));
const operatorChange = await changeForMnemonic(rawMn);
targets.add(operatorChange);
if (demoMn && demoMn !== rawMn) {
  try {
    targets.add(await changeForMnemonic(demoMn));
  } catch (e) {
    console.warn('Could not derive address from RELAYER_DEMO_MNEMONIC_CARDANO:', e?.message ?? e);
  }
}

const fs = new YaciProvider(yaci, admin);

const list = [...targets].filter((a) => a.startsWith('addr_test1')).sort();
console.log(`Yaci Store: ${yaci}\nAdmin: ${admin}\nTopup: ${adaAmount} ADA each\n`);
console.log(`${list.length} unique addr_test1 address(es):\n${list.map((a) => `  ${a}`).join('\n')}\n`);

for (const addr of list) {
  try {
    const topupResult = await fs.addressTopup(addr, adaAmount);
    console.log(addr.slice(0, 28) + '…', topupResult?.status === true ? 'OK' : topupResult);
  } catch (e) {
    console.error('Topup failed for', addr, e?.message ?? e);
    process.exitCode = 1;
  }
}

const quotedMn = JSON.stringify(rawMn);
console.log('\nIf your .env used different bech32 lines, align to the operator change address:\n');
console.log(`RELAYER_DEMO_MNEMONIC_CARDANO=${quotedMn}`);
console.log(`RELAYER_DEMO_CARDANO_ADDRESS_SRC=${operatorChange}`);
console.log(`RELAYER_DEMO_CARDANO_ADDRESS_DST=${operatorChange}`);
console.log(`RELAYER_CARDANO_LOCK_ADDRESS=${operatorChange}`);
console.log(`RELAYER_BRIDGE_CARDANO_RECIPIENT=${operatorChange}`);
console.log('');
