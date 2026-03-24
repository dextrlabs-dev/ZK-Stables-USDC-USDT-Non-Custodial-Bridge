#!/usr/bin/env node
/**
 * One-shot local check: same data path as `fetchAddressUtxosBlockfrostDirect` + env units.
 * Usage (from repo root):
 *   node --env-file=zk-stables-ui/.env.production zk-stables-ui/scripts/verify-bridge-lock-discovery.mjs
 * Or set RELAYER_URL / YACI_API_BASE yourself.
 */
const RELAYER_URL = (process.env.VITE_RELAYER_URL ?? process.env.RELAYER_URL ?? 'http://127.0.0.1:8787').replace(
  /\/$/,
  '',
);
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
  const pa = na.slice(0, 56);
  const pb = nb.slice(0, 56);
  if (pa !== pb) return false;
  return na.slice(56) === nb.slice(56);
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const wusdc = normalizeUnit(process.env.VITE_CARDANO_WUSDC_UNIT);
  const wusdt = normalizeUnit(process.env.VITE_CARDANO_WUSDT_UNIT);
  const allowed = [wusdc, wusdt].filter(Boolean);
  if (allowed.length === 0) {
    console.error('Set VITE_CARDANO_WUSDC_UNIT and/or VITE_CARDANO_WUSDT_UNIT (e.g. via --env-file=zk-stables-ui/.env.production)');
    process.exit(1);
  }

  console.log('Relayer:', RELAYER_URL);
  console.log('Yaci API:', YACI_API_BASE);
  console.log('Allowed native units:', allowed.map((u) => `${u.slice(0, 12)}…(${u.length} hex)`).join(', '));

  const meta = await fetchJson(`${RELAYER_URL}/v1/cardano/bridge-metadata`);
  const addr = meta.lockScriptAddress;
  console.log('Lock script:', addr);

  const enc = encodeURIComponent(addr);
  const all = [];
  for (let page = 1; page < 5000; page++) {
    const rows = await fetchJson(`${YACI_API_BASE}/addresses/${enc}/utxos?page=${page}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
  }

  console.log('Total UTxOs at script (all pages):', all.length);

  const withZk = all.filter((u) =>
    (u.amount ?? []).some((a) => allowed.some((unit) => unitsMatch(a.unit, unit))),
  );
  console.log('UTxOs holding WUSDC/WUSDT (env):', withZk.length);

  const withDatum = withZk.filter((u) => u.inline_datum);
  console.log('…with inline_datum:', withDatum.length);

  for (const u of withDatum.slice(0, 8)) {
    const units = (u.amount ?? [])
      .filter((a) => a.unit !== 'lovelace')
      .map((a) => normalizeUnit(a.unit).slice(0, 20) + '…')
      .join(', ');
    console.log(`  - ${u.tx_hash}#${u.output_index} assets=${units || '(none)'}`);
  }

  if (withDatum.length > 0) {
    console.log('\nOK: Yaci lists lock-shaped outputs; the UI discovery can list them if wallet vkh + datum parse match.');
    process.exit(0);
  }

  console.log('\nNo matching UTxOs — fund the demo wallet, run Step 2 lock in the UI, or mint with relayer.');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
