#!/usr/bin/env node
/**
 * Full parity with `discoverCardanoBridgeLocks` (minus Vite import.meta):
 * Yaci JSON → Mesh deserializeDatum → parse LockDatum → recipient vkh ∈ demo wallet.
 *
 *   npm run verify:discover-parity -w @zk-stables/ui
 */
import { MeshWallet, deserializeAddress, deserializeDatum, YaciProvider } from '@meshsdk/core';

const RELAYER_URL = (process.env.VITE_RELAYER_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const YACI_API_BASE = (process.env.YACI_API_BASE ?? 'http://127.0.0.1:8080/api/v1').replace(/\/$/, '');

function normalizeUnit(u) {
  return String(u ?? '')
    .replace(/^0x/i, '')
    .trim()
    .toLowerCase();
}

function unitsMatch(a, b) {
  const na = normalizeUnit(a);
  const nb = normalizeUnit(b);
  if (na === nb) return true;
  if (na.length < 56 || nb.length < 56) return false;
  if (na.slice(0, 56) !== nb.slice(0, 56)) return false;
  return na.slice(56) === nb.slice(56);
}

function datumNativeUnit(p) {
  const pol = p.policyIdHex.replace(/^0x/i, '').toLowerCase();
  const name = p.assetNameHex.replace(/^0x/i, '').toLowerCase();
  return `${pol}${name}`;
}

/** Same as `lockDatumParse.ts` (Mesh Data + JSON Plutus from `deserializeDatum`). */
function readHexBytesField(field) {
  if (typeof field === 'string') return field.replace(/^0x/i, '').trim().toLowerCase();
  if (field && typeof field === 'object' && 'bytes' in field) return String(field.bytes).toLowerCase();
  throw new Error('Expected hex or bytes field');
}
function readBigIntField(field) {
  if (typeof field === 'bigint') return field;
  if (typeof field === 'number') return BigInt(field);
  if (field && typeof field === 'object' && 'int' in field) return BigInt(String(field.int));
  return BigInt(String(field));
}
function parseBridgeOperatorOption(opField) {
  const tag = opField.alternative ?? opField.constructor;
  const inner = opField.fields ?? [];
  if (tag === 1 && inner.length === 0) return null;
  if (tag === 0 && inner.length === 1) return readHexBytesField(inner[0]);
  throw new Error('Unexpected bridge_operator option');
}
function parseLockDatumFromMeshData(d) {
  const f = d.fields;
  if (!Array.isArray(f) || f.length < 10) throw new Error('Unexpected LockDatum shape');
  return {
    depositorVkeyHashHex56: readHexBytesField(f[0]),
    recipientVkeyHashHex56: readHexBytesField(f[1]),
    policyIdHex: readHexBytesField(f[2]),
    assetNameHex: readHexBytesField(f[3]),
    amount: readBigIntField(f[4]),
    lockNonce: readBigIntField(f[5]),
    recipientCommitmentHex: readHexBytesField(f[6]),
    sourceChainId: readBigIntField(f[7]),
    destinationChainId: readBigIntField(f[8]),
    bridgeOperatorVkeyHashHex56: parseBridgeOperatorOption(f[9]),
  };
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const mnemonic = String(process.env.VITE_DEMO_CARDANO_WALLET_MNEMONIC ?? '')
    .trim()
    .replace(/^["']|["']$/g, '');
  const words = mnemonic.split(/\s+/u).filter(Boolean);
  if (words.length < 12) {
    console.error('Set VITE_DEMO_CARDANO_WALLET_MNEMONIC in .env.production');
    process.exit(1);
  }

  const wusdc = normalizeUnit(process.env.VITE_CARDANO_WUSDC_UNIT);
  const wusdt = normalizeUnit(process.env.VITE_CARDANO_WUSDT_UNIT);
  const allowed = [wusdc, wusdt].filter(Boolean);
  if (allowed.length === 0) {
    console.error('Set VITE_CARDANO_WUSDC_UNIT / WUSDT_UNIT');
    process.exit(1);
  }

  const networkId = Number(process.env.VITE_CARDANO_NETWORK_ID ?? '0') === 1 ? 1 : 0;
  const fetcher = new YaciProvider(YACI_API_BASE);
  const wallet = new MeshWallet({
    networkId,
    fetcher,
    submitter: fetcher,
    key: { type: 'mnemonic', words },
  });

  const used = await wallet.getUsedAddresses();
  let unused = [];
  try {
    unused = await wallet.getUnusedAddresses();
  } catch {
    /* optional */
  }
  const walletVkhs = new Set();
  for (const raw of [...used, ...unused]) {
    const a = raw?.trim();
    if (!a) continue;
    try {
      walletVkhs.add(deserializeAddress(a).pubKeyHash.replace(/^0x/i, '').trim().toLowerCase());
    } catch {
      /* skip */
    }
  }
  console.log('Demo wallet payment key hashes:', walletVkhs.size);

  const meta = await fetchJson(`${RELAYER_URL}/v1/cardano/bridge-metadata`);
  const addr = meta.lockScriptAddress;
  const enc = encodeURIComponent(addr);

  const all = [];
  for (let page = 1; page < 5000; page++) {
    const rows = await fetchJson(`${YACI_API_BASE}/addresses/${enc}/utxos?page=${page}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
  }

  const candidates = [];
  let skippedNoDatum = 0;
  let skippedDeserialize = 0;
  let skippedParse = 0;
  let skippedOperator = 0;
  let skippedRecipient = 0;
  let skippedUnit = 0;

  for (const row of all) {
    const amounts = row.amount ?? [];
    const hasZk = amounts.some((a) => a.unit !== 'lovelace' && allowed.some((u) => unitsMatch(a.unit, u)));
    if (!hasZk) continue;

    const hex = row.inline_datum;
    if (!hex) {
      skippedNoDatum++;
      continue;
    }

    let datumData;
    try {
      datumData = deserializeDatum(hex);
    } catch {
      skippedDeserialize++;
      continue;
    }

    let p;
    try {
      p = parseLockDatumFromMeshData(datumData);
    } catch {
      skippedParse++;
      continue;
    }

    if (p.bridgeOperatorVkeyHashHex56 !== null) {
      skippedOperator++;
      continue;
    }

    const recip = p.recipientVkeyHashHex56.replace(/^0x/i, '').trim().toLowerCase();
    if (!walletVkhs.has(recip)) {
      skippedRecipient++;
      continue;
    }

    const du = datumNativeUnit(p);
    const okUsdc = wusdc && unitsMatch(du, wusdc);
    const okUsdt = wusdt && unitsMatch(du, wusdt);
    if (!okUsdc && !okUsdt) {
      skippedUnit++;
      continue;
    }

    candidates.push({
      tx: row.tx_hash,
      idx: row.output_index,
      asset: okUsdc ? 'USDC' : 'USDT',
    });
  }

  console.log('Locks passing full UI filters (same as discoverCardanoBridgeLocks):', candidates.length);
  if (skippedNoDatum) console.log('  skipped (no inline_datum):', skippedNoDatum);
  if (skippedDeserialize) console.log('  skipped (deserializeDatum failed):', skippedDeserialize);
  if (skippedParse) console.log('  skipped (LockDatum parse failed):', skippedParse);
  if (skippedOperator) console.log('  skipped (bridge operator in datum):', skippedOperator);
  if (skippedRecipient) console.log('  skipped (recipient vkh not in demo wallet):', skippedRecipient);
  if (skippedUnit) console.log('  skipped (datum unit not WUSDC/WUSDT env):', skippedUnit);

  for (const c of candidates.slice(0, 10)) {
    console.log(`  ✓ ${c.tx}#${c.idx} (${c.asset})`);
  }

  if (candidates.length > 0) {
    console.log('\nPASS: discovery logic finds recipient-only locks for the demo wallet.');
    process.exit(0);
  }
  console.log('\nFAIL: no locks matched — check mnemonic vs lock creator, or env units.');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
