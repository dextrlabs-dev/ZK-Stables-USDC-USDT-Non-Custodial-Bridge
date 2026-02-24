#!/usr/bin/env node
/**
 * Derives the Mesh operator change address from RELAYER_CARDANO_WALLET_MNEMONIC, funds it via
 * Yaci DevKit admin (addressTopup), and prints suggested RELAYER_DEMO_* / lock / bridge lines.
 *
 * Run from repo root with zk-stables-relayer/.env loaded, e.g.:
 *   set -a && source zk-stables-relayer/.env 2>/dev/null || set -a && . zk-stables-relayer/.env; set +a
 *   node scripts/fund-cardano-demo-from-yaci.mjs
 *
 * Requires: RELAYER_YACI_URL, RELAYER_YACI_ADMIN_URL, RELAYER_CARDANO_WALLET_MNEMONIC
 * Optional: RELAYER_CARDANO_TOPUP_ADA (default 50000), RELAYER_CARDANO_NETWORK_ID (default 0)
 */
import { MeshWallet, YaciProvider } from '@meshsdk/core';

const yaci = (process.env.RELAYER_YACI_URL ?? process.env.YACI_URL ?? '').trim().replace(/\/$/, '');
const admin = (process.env.RELAYER_YACI_ADMIN_URL ?? process.env.YACI_ADMIN_URL ?? '').trim().replace(/\/$/, '');
const rawMn = (process.env.RELAYER_CARDANO_WALLET_MNEMONIC ?? '').trim();
const adaAmount = String(process.env.RELAYER_CARDANO_TOPUP_ADA ?? '50000');
const networkId = Number(process.env.RELAYER_CARDANO_NETWORK_ID ?? 0);

if (!yaci || !admin) {
  console.error('Missing RELAYER_YACI_URL and RELAYER_YACI_ADMIN_URL (or YACI_*).');
  process.exit(1);
}
if (!rawMn) {
  console.error('Missing RELAYER_CARDANO_WALLET_MNEMONIC.');
  process.exit(1);
}

const words = rawMn.split(/\s+/u);
const fs = new YaciProvider(yaci, admin);
const wallet = new MeshWallet({
  networkId: networkId === 1 ? 1 : 0,
  fetcher: fs,
  submitter: fs,
  key: { type: 'mnemonic', words },
});

const change = await wallet.getChangeAddress();
console.log(`Derived operator change address:\n  ${change}\n`);

let topupResult;
try {
  topupResult = await fs.addressTopup(change, adaAmount);
  console.log('Yaci admin topup:', topupResult, '\n');
} catch (e) {
  console.error('Topup failed (is Yaci DevKit admin up on RELAYER_YACI_ADMIN_URL?):', e?.message ?? e);
  process.exit(1);
}

const quotedMn = JSON.stringify(rawMn);
console.log('Add or merge into zk-stables-relayer/.env:\n');
console.log(`RELAYER_DEMO_MNEMONIC_CARDANO=${quotedMn}`);
console.log(`RELAYER_DEMO_CARDANO_ADDRESS_SRC=${change}`);
console.log(`RELAYER_DEMO_CARDANO_ADDRESS_DST=${change}`);
console.log(`RELAYER_CARDANO_LOCK_ADDRESS=${change}`);
console.log(`RELAYER_BRIDGE_CARDANO_RECIPIENT=${change}`);
console.log('');
