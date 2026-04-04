#!/usr/bin/env node
/**
 * Production-style ops matrix (EVM pool lock → relayer):
 *   - Mint: USDC/USDT → cardano + midnight (4 jobs)
 *   - Redeem: cardano → EVM (2 jobs, uses lock/release + commitment from mint jobs)
 *   - Redeem: midnight → EVM (2 jobs: initiateBurn via POST /v1/midnight/initiate-burn on OPS_RELAYER_URL — same LevelDB/mutex as relayer; CLI tsx fallback if OPS_INITIATE_BURN_VIA_CLI=1 — then zk-bridge redeem midnight)
 *
 * Prereqs: bridge-cli built (`npm run build -w @zk-stables/bridge-cli`), relayer up, Anvil + env,
 *   BRIDGE_CLI_* + same deploy addresses as relayer. Optional: source `zk-stables-relayer/.env` before run.
 *
 * Env:
 *   OPS_RELAYER_URL — default http://127.0.0.1:8787
 *   OPS_AMOUNT — human decimal per mint (default 0.05)
 *   OPS_SKIP_MIDNIGHT — if 1, skip midnight mint + redeem (Cardano-only matrix)
 *   OPS_SKIP_CARDANO — if 1, skip cardano mint + redeem
 *   OPS_REDEEM_ONLY — if 1, skip mints and load prior `mint-*-*.json` from OPS_REPORT_DIR (must exist, finalJob.phase=completed)
 *   OPS_MIDNIGHT_RECIPIENT — bech32 `mn_addr…` override for mint --recipient (when RELAYER_BRIDGE_MIDNIGHT_RECIPIENT unset/invalid)
 *   OPS_MIDNIGHT_FROM_DEMO — if 1 (default when midnight bridge env missing), use GET /v1/demo/wallets midnight.shieldedExample
 *   OPS_ZK_BRIDGE_EXTRA — extra args passed to every zk-bridge invocation (e.g. --json)
 *   OPS_ZK_BRIDGE_WAIT_TIMEOUT_MS — forwarded as --wait-timeout-ms when not already set (bridge-cli default 900000)
 *   OPS_ZK_BRIDGE_POLL_MS — forwarded as --poll-ms when not already set
 *   OPS_SKIP_BALANCES — if 1, do not run `zk-bridge balances` before/after (faster / no mnemonic)
 *   OPS_SKIP_MIDNIGHT_BALANCE — if 1, do not set demo Midnight mnemonic for snapshots (faster; EVM+Cardano only)
 *
 * Note: zk-bridge writes wait heartbeats to stderr. This script uses stderr=inherit so those lines
 * appear live and the child cannot deadlock on a full stderr pipe (stdio pipe+pipe would).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, fetch as undiciFetch } from 'undici';

/** Long-running `initiateBurn` holds the HTTP response until proof+submit finish; disable Undici timeouts (global `fetch` can fail mid-proof). */
const initiateBurnDispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  connectTimeout: 120_000,
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RELAYER_URL = (process.env.OPS_RELAYER_URL || process.env.BRIDGE_CLI_RELAYER_URL || 'http://127.0.0.1:8787').replace(
  /\/$/,
  '',
);
const AMOUNT = process.env.OPS_AMOUNT || '0.05';
let skipMidnight = process.env.OPS_SKIP_MIDNIGHT === '1' || process.env.OPS_SKIP_MIDNIGHT === 'true';
let skipCardano = process.env.OPS_SKIP_CARDANO === '1' || process.env.OPS_SKIP_CARDANO === 'true';
const redeemOnly = process.env.OPS_REDEEM_ONLY === '1' || process.env.OPS_REDEEM_ONLY === 'true';
const REPORT_DIR = process.env.OPS_REPORT_DIR || join(ROOT, 'tmp', 'ops-matrix-report');
const EXTRA = (process.env.OPS_ZK_BRIDGE_EXTRA || '')
  .trim()
  .split(/\s+/u)
  .filter(Boolean);

const bridgeCli = join(ROOT, 'bridge-cli', 'dist', 'cli.js');
const midnightInitScript = join(ROOT, 'zk-stables-relayer', 'scripts', 'midnight-initiate-burn-only.ts');

/** Env passed to bridge-cli (mint/redeem/balances) so RPC, keys, Cardano indexer, and Midnight mnemonic match the relayer demo. */
function bridgeCliChildEnv() {
  const addrs = process.env.BRIDGE_CLI_ADDRESSES_JSON || '/tmp/zk-stables-anvil-addrs.json';
  const pk = process.env.BRIDGE_CLI_EVM_PRIVATE_KEY || process.env.RELAYER_EVM_PRIVATE_KEY || '';
  return {
    ...process.env,
    BRIDGE_CLI_RELAYER_URL: RELAYER_URL,
    BRIDGE_CLI_ADDRESSES_JSON: addrs,
    ...(pk ? { BRIDGE_CLI_EVM_PRIVATE_KEY: pk } : {}),
  };
}

function zkBridge(args) {
  const mergedForCheck = [...args, ...EXTRA].join(' ');
  const injected = [];
  const waitMs = process.env.OPS_ZK_BRIDGE_WAIT_TIMEOUT_MS?.trim();
  if (waitMs && !/--wait-timeout-ms/u.test(mergedForCheck)) {
    injected.push('--wait-timeout-ms', waitMs);
  }
  const pollMs = process.env.OPS_ZK_BRIDGE_POLL_MS?.trim();
  if (pollMs && !/--poll-ms/u.test(mergedForCheck)) {
    injected.push('--poll-ms', pollMs);
  }
  const cmd = [bridgeCli, ...args, ...injected, ...EXTRA];
  return execFileSync(process.execPath, cmd, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: bridgeCliChildEnv(),
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

/** One JSON snapshot from `zk-bridge balances --json` (EVM underlying, Cardano native zk, Midnight unshielded zk). */
function captureBalanceSnapshotJson() {
  const raw = execFileSync(process.execPath, [bridgeCli, 'balances', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: bridgeCliChildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return JSON.parse(raw);
}

/** EVM underlying on the pool-lock signer only (no `BRIDGE_CLI_EVM_VIEWER_ADDRESS`, no Midnight — fast). */
function capturePoolLockerEvmOnlyJson() {
  const base = bridgeCliChildEnv();
  const env = { ...base };
  delete env.BRIDGE_CLI_EVM_VIEWER_ADDRESS;
  delete env.BRIDGE_CLI_MIDNIGHT_MNEMONIC;
  delete env.BIP39_MNEMONIC;
  const raw = execFileSync(process.execPath, [bridgeCli, 'balances', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return JSON.parse(raw).evm;
}

/**
 * One merged snapshot: `evmPoolLocker` (signer, locks), `evmBridgeRecipient` (payout redeems), plus Cardano + Midnight from full CLI run.
 */
function captureMergedBalanceSnapshotJson() {
  console.error('[ops-matrix] balance: EVM pool-locker (signer, no Midnight sync)…');
  const evmPoolLocker = capturePoolLockerEvmOnlyJson();
  console.error('[ops-matrix] balance: bridge recipient + Cardano + Midnight…');
  const full = captureBalanceSnapshotJson();
  return {
    updatedAt: full.updatedAt,
    evmPoolLocker,
    evmBridgeRecipient: full.evm,
    cardano: full.cardano,
    midnight: full.midnight,
    relayer: full.relayer,
    ...(full.notes ? { notes: full.notes } : {}),
  };
}

function numOrNaN(s) {
  const t = String(s ?? '').trim();
  if (t === '' || t === '—' || t.startsWith('(')) return NaN;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
}

function deltaCell(before, after) {
  const x = numOrNaN(before);
  const y = numOrNaN(after);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '—';
  const d = y - x;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(6)}`;
}

async function fetchRecipients() {
  const res = await fetch(`${RELAYER_URL}/v1/bridge/recipients`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /v1/bridge/recipients ${res.status}`);
  return res.json();
}

/**
 * Fill bridge-cli env for `zk-bridge balances` when ops runs with only relayer `.env`
 * (recipients + Yaci live on relayer; native asset units match UI dev defaults).
 */
function applyBalanceSnapshotBridgeCliEnv(snap) {
  const ada = typeof snap.cardanoRecipient === 'string' ? snap.cardanoRecipient.trim() : '';
  const evmR = typeof snap.evmRecipient === 'string' ? snap.evmRecipient.trim() : '';
  if (ada && !process.env.BRIDGE_CLI_CARDANO_ADDRESS?.trim()) process.env.BRIDGE_CLI_CARDANO_ADDRESS = ada;
  if (evmR && !process.env.BRIDGE_CLI_EVM_VIEWER_ADDRESS?.trim()) process.env.BRIDGE_CLI_EVM_VIEWER_ADDRESS = evmR;

  const yaci = process.env.RELAYER_YACI_URL?.trim() || process.env.YACI_URL?.trim();
  if (yaci && !process.env.BRIDGE_CLI_YACI_STORE_URL?.trim()) process.env.BRIDGE_CLI_YACI_STORE_URL = yaci;

  const relPk = process.env.RELAYER_EVM_PRIVATE_KEY?.trim();
  if (relPk && !process.env.BRIDGE_CLI_EVM_PRIVATE_KEY?.trim()) process.env.BRIDGE_CLI_EVM_PRIVATE_KEY = relPk;

  if (!process.env.BRIDGE_CLI_CARDANO_WUSDC_UNIT?.trim() || !process.env.BRIDGE_CLI_CARDANO_WUSDT_UNIT?.trim()) {
    const devEnv = join(ROOT, 'zk-stables-ui', '.env.development');
    let wu = process.env.BRIDGE_CLI_CARDANO_WUSDC_UNIT?.trim();
    let wt = process.env.BRIDGE_CLI_CARDANO_WUSDT_UNIT?.trim();
    if (existsSync(devEnv)) {
      const text = readFileSync(devEnv, 'utf8');
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*VITE_CARDANO_WUSDC_UNIT\s*=\s*(.+)/u);
        const m2 = line.match(/^\s*VITE_CARDANO_WUSDT_UNIT\s*=\s*(.+)/u);
        if (m) wu = wu || m[1].trim().replace(/^["']|["']$/gu, '');
        if (m2) wt = wt || m2[1].trim().replace(/^["']|["']$/gu, '');
      }
    }
    if (!process.env.BRIDGE_CLI_CARDANO_WUSDC_UNIT?.trim() && wu) process.env.BRIDGE_CLI_CARDANO_WUSDC_UNIT = wu;
    if (!process.env.BRIDGE_CLI_CARDANO_WUSDT_UNIT?.trim() && wt) process.env.BRIDGE_CLI_CARDANO_WUSDT_UNIT = wt;
  }
}

/** When demo wallets are enabled, use the same Midnight mnemonic the UI uses so `balances` can read unshielded zk (local only). */
async function applyMidnightBalanceEnvFromDemo() {
  if (process.env.OPS_SKIP_MIDNIGHT_BALANCE === '1' || process.env.OPS_SKIP_MIDNIGHT_BALANCE === 'true') return;
  if (process.env.BRIDGE_CLI_MIDNIGHT_MNEMONIC?.trim() || process.env.BIP39_MNEMONIC?.trim()) return;
  try {
    const res = await fetch(`${RELAYER_URL}/v1/demo/wallets`, { cache: 'no-store' });
    if (!res.ok) return;
    const j = await res.json();
    const m = j.midnight?.mnemonic;
    if (typeof m === 'string' && m.trim().split(/\s+/u).length >= 12) {
      process.env.BRIDGE_CLI_MIDNIGHT_MNEMONIC = m.trim();
      console.error('[ops-matrix] Using GET /v1/demo/wallets midnight.mnemonic for balance snapshots (local demo only).');
    }
  } catch {
    /* optional */
  }
  if (!process.env.BRIDGE_CLI_MIDNIGHT_SYNC_TIMEOUT_MS?.trim()) {
    process.env.BRIDGE_CLI_MIDNIGHT_SYNC_TIMEOUT_MS = '300000';
  }
}

/** Same rules as relayer `isLikelyMidnightBech32` — avoids placeholder / non-bech32 strings. */
function isLikelyMidnightBech32(addr) {
  const t = String(addr || '').trim();
  if (!t.startsWith('mn_addr')) return false;
  const sep = t.indexOf('1');
  if (sep < 0) return false;
  const data = t.slice(sep + 1);
  return data.length >= 6 && !data.includes('_');
}

async function fetchDemoMidnightRecipient() {
  const res = await fetch(`${RELAYER_URL}/v1/demo/wallets`, { cache: 'no-store' });
  if (!res.ok) return null;
  const j = await res.json();
  if (j.error) return null;
  const useUn = process.env.OPS_MIDNIGHT_USE_UNSHIELDED === '1' || process.env.OPS_MIDNIGHT_USE_UNSHIELDED === 'true';
  const cand = useUn ? j.midnight?.unshieldedExample : j.midnight?.shieldedExample;
  return typeof cand === 'string' && isLikelyMidnightBech32(cand) ? cand.trim() : null;
}

async function resolveMidnightRecipient(snapMidnight) {
  const envOverride = process.env.OPS_MIDNIGHT_RECIPIENT?.trim();
  if (envOverride && isLikelyMidnightBech32(envOverride)) return envOverride;
  if (snapMidnight && isLikelyMidnightBech32(snapMidnight)) return snapMidnight.trim();
  const fromDemoDefault =
    process.env.OPS_MIDNIGHT_FROM_DEMO !== '0' && process.env.OPS_MIDNIGHT_FROM_DEMO !== 'false';
  if (fromDemoDefault) {
    const d = await fetchDemoMidnightRecipient();
    if (d) {
      console.warn(`Using Midnight mint recipient from GET /v1/demo/wallets (set RELAYER_BRIDGE_MIDNIGHT_RECIPIENT to persist)`);
      return d;
    }
  }
  return null;
}

/** Extract ledger deposit + tx ids from relayer Midnight mint destinationHint. */
function parseMidnightMintTxs(hint) {
  const h = hint || '';
  const depositHex = parseMidnightDepositHex(h);
  const txId = (label) => {
    const m = h.match(new RegExp(`${label} txId=([^\\s]+)`, 'i'));
    return m ? m[1] : undefined;
  };
  const txHash = (label) => {
    const m = h.match(new RegExp(`${label} txId=[^\\s]+\\s+txHash=([0-9a-fA-F]{64})`, 'i'));
    return m ? m[1].toLowerCase() : undefined;
  };
  return {
    depositCommitmentHex: depositHex,
    registerDeposit: { txId: txId('registerDeposit'), txHash: txHash('registerDeposit') },
    proveHolder: { txId: txId('proveHolder'), txHash: txHash('proveHolder') },
    mintWrappedUnshielded: { txId: txId('mintWrappedUnshielded'), txHash: txHash('mintWrappedUnshielded') },
  };
}

/** Extract finalize / sendWrapped lines from BURN job destinationHint. */
function parseMidnightBurnTxs(hint) {
  const h = hint || '';
  const txId = (label) => {
    const m = h.match(new RegExp(`${label} txId=([^\\s]+)`, 'i'));
    return m ? m[1] : undefined;
  };
  const txHash = (label) => {
    const m = h.match(new RegExp(`${label} txId=[^\\s]+\\s+txHash=([0-9a-fA-F]{64})`, 'i'));
    return m ? m[1].toLowerCase() : undefined;
  };
  return {
    initiateBurn: { txId: txId('initiateBurn'), txHash: txHash('initiateBurn') },
    sendWrappedUnshieldedToUser: { txId: txId('sendWrappedUnshieldedToUser'), txHash: txHash('sendWrappedUnshieldedToUser') },
    finalizeBurn: { txId: txId('finalizeBurn'), txHash: txHash('finalizeBurn') },
  };
}

function cardanoBurnCommitment(lockRef, digest) {
  const d = String(digest || '').replace(/^0x/i, '').trim();
  return createHash('sha256').update(`${lockRef}:${d}`, 'utf8').digest('hex');
}

function parseLockReleaseTxs(hint) {
  const h = hint || '';
  const lockM = h.match(/lock ([0-9a-f]{64})/iu);
  const relM = h.match(/release ([0-9a-f]{64})/iu);
  return { lockTx: lockM?.[1]?.toLowerCase(), releaseTx: relM?.[1]?.toLowerCase() };
}

function parseMidnightDepositHex(hint) {
  const m = (hint || '').match(/Deposit ([0-9a-f]{64})/iu);
  return m ? m[1].toLowerCase() : null;
}

function parseEvmUnlockTx(hint) {
  const m = (hint || '').match(/EVM underlying payout \(operator unlock\):\s*(0x[a-f0-9]{64})/iu);
  return m ? m[1] : undefined;
}

function parseBridgeReleaseCardanoTx(hint) {
  const h = hint || '';
  const m = h.match(/User BridgeRelease tx:\s*([0-9a-f]{64})/iu);
  if (m) return m[1].toLowerCase();
  const m2 = h.match(/BridgeRelease\+burn \(supply\):\s*([0-9a-f]{64})/iu);
  if (m2) return m2[1].toLowerCase();
  const m3 = h.match(/Aiken lock_pool BridgeRelease:\s*([0-9a-f]{64})/iu);
  return m3 ? m3[1].toLowerCase() : undefined;
}

/**
 * Human + ops-readable report: EVM, Cardano, Midnight tx hashes (best-effort from relayer hints + job JSON).
 */
function writeTxHashReport(report, reportDir, matrixMeta) {
  const lines = [];
  const iso = new Date().toISOString();
  lines.push(`# Cross-chain transaction hash report`);
  lines.push('');
  lines.push(`- **Generated:** ${iso}`);
  lines.push(`- **Relayer:** ${report.relayerUrl}`);
  lines.push(`- **Amount (per leg):** ${report.amount}`);
  lines.push(`- **Report directory:** ${reportDir}`);
  lines.push('');
  if (matrixMeta.partialRun) {
    lines.push(`> **Partial run:** ${matrixMeta.partialReason || 'matrix stopped before all legs finished — see summary.json'}`);
    lines.push('');
  }
  if (report.balanceSnapshots?.before || report.balanceSnapshots?.after) {
    const b = report.balanceSnapshots.before;
    const a = report.balanceSnapshots.after;
    lines.push(`## Balances (EVM mUSDC/mUSDT, Cardano native zk, Midnight unshielded zk)`);
    lines.push('');
    lines.push(
      `**EVM pool locker** = underlying on the signer that calls \`ZkStablesPoolLock.lock\` (no \`BRIDGE_CLI_EVM_VIEWER_ADDRESS\`). **EVM bridge payout** = \`RELAYER_BRIDGE_EVM_RECIPIENT\` (redeem unlocks). Cardano = \`BRIDGE_CLI_CARDANO_ADDRESS\`. Midnight = demo mnemonic when configured.`,
    );
    lines.push('');
    lines.push(`| Field | Before | After | Δ (after − before) |`);
    lines.push(`|-------|--------|-------|---------------------|`);
    const row = (label, fb, fa) => {
      const bb = fb ?? '—';
      const aa = fa ?? '—';
      lines.push(`| ${label} | ${bb} | ${aa} | ${deltaCell(bb, aa)} |`);
    };
    const legacyB = b?.evm && !b?.evmPoolLocker;
    if (b?.evmPoolLocker || a?.evmPoolLocker) {
      row('EVM USDC (pool locker)', b?.evmPoolLocker?.usdc, a?.evmPoolLocker?.usdc);
      row('EVM USDT (pool locker)', b?.evmPoolLocker?.usdt, a?.evmPoolLocker?.usdt);
    }
    if (b?.evmBridgeRecipient || a?.evmBridgeRecipient) {
      row('EVM USDC (bridge payout)', b?.evmBridgeRecipient?.usdc, a?.evmBridgeRecipient?.usdc);
      row('EVM USDT (bridge payout)', b?.evmBridgeRecipient?.usdt, a?.evmBridgeRecipient?.usdt);
    } else if (legacyB || (a?.evm && !a?.evmPoolLocker)) {
      row('EVM USDC', b?.evm?.usdc, a?.evm?.usdc);
      row('EVM USDT', b?.evm?.usdt, a?.evm?.usdt);
    }
    row('Cardano zkUSDC', b?.cardano?.zkUsdc, a?.cardano?.zkUsdc);
    row('Cardano zkUSDT', b?.cardano?.zkUsdt, a?.cardano?.zkUsdt);
    row('Midnight zkUSDC', b?.midnight?.zkUsdc, a?.midnight?.zkUsdc);
    row('Midnight zkUSDT', b?.midnight?.zkUsdt, a?.midnight?.zkUsdt);
    const evmErr = (x) => [x?.evmPoolLocker?.error, x?.evmBridgeRecipient?.error, x?.evm?.error].filter(Boolean).join(' / ') || '—';
    if (evmErr(b) !== '—' || evmErr(a) !== '—') {
      lines.push('');
      lines.push(`**EVM read errors:** before=${evmErr(b)} / after=${evmErr(a)}`);
    }
    if (b?.cardano?.error || a?.cardano?.error) {
      lines.push(`**Cardano read errors:** before=${b?.cardano?.error ?? '—'} / after=${a?.cardano?.error ?? '—'}`);
    }
    if (b?.midnight?.error || a?.midnight?.error) {
      lines.push(`**Midnight read errors:** before=${b?.midnight?.error ?? '—'} / after=${a?.midnight?.error ?? '—'}`);
    }
    lines.push('');
    lines.push(`- \`balance-before.json\`, \`balance-after.json\` — full CLI snapshots`);
    lines.push('');
  }

  lines.push(`## Matrix coverage`);
  lines.push('');
  lines.push(`| Chain / leg | Ran in this matrix |`);
  lines.push(`|-------------|---------------------|`);
  const anyMint = !matrixMeta.skipCardano || !matrixMeta.skipMidnight;
  lines.push(`| EVM (pool lock + unlock) | ${anyMint ? 'yes (via mint/redeem intents)' : 'no'} |`);
  lines.push(`| Cardano (lock_pool) | ${matrixMeta.skipCardano ? 'no' : 'yes'} |`);
  lines.push(`| Midnight (registry) | ${matrixMeta.skipMidnight ? 'no' : 'yes'} |`);
  if (matrixMeta.midnightSkipReason) {
    lines.push('');
    lines.push(`**Midnight not run:** ${matrixMeta.midnightSkipReason}`);
  }
  lines.push('');

  lines.push(`## EVM`);
  lines.push('');
  for (const row of report.mints) {
    if (row.evmLockTxHash) {
      lines.push(`### ${row.asset} — pool \`lock\` (mint → ${row.destination})`);
      lines.push('');
      lines.push(`| Field | Value |`);
      lines.push(`|-------|-------|`);
      lines.push(`| Relayer job | \`${row.jobId}\` |`);
      lines.push(`| EVM \`ZkStablesPoolLock.lock\` tx | \`${row.evmLockTxHash}\` |`);
      lines.push('');
    }
  }
  for (const r of report.redeems) {
    const fn =
      r.kind === 'midnight'
        ? join(reportDir, `redeem-midnight-${r.asset}.json`)
        : join(reportDir, `redeem-cardano-${r.asset}.json`);
    if (!existsSync(fn)) continue;
    const j = JSON.parse(readFileSync(fn, 'utf8'));
    const hint = j.finalJob?.destinationHint || '';
    const unlock = parseEvmUnlockTx(hint);
    if (unlock) {
      lines.push(`### ${r.asset} — underlying \`unlock\` (${r.kind} → EVM redeem)`);
      lines.push('');
      lines.push(`| Field | Value |`);
      lines.push(`|-------|-------|`);
      lines.push(`| Relayer job | \`${r.jobId}\` |`);
      lines.push(`| EVM \`ZkStablesPoolLock.unlock\` (operator) tx | \`${unlock}\` |`);
      lines.push('');
    }
  }

  lines.push(`## Cardano`);
  lines.push('');
  if (matrixMeta.skipCardano) {
    lines.push('_Cardano leg skipped in this run._');
    lines.push('');
  } else {
    for (const row of report.mints.filter((x) => x.destination === 'cardano')) {
      const hint = row.destinationHint || '';
      const { lockTx, releaseTx } = parseLockReleaseTxs(hint);
      lines.push(`### ${row.asset} — \`lock_pool\` mint + \`BridgeRelease\``);
      lines.push('');
      lines.push(`| Field | Value |`);
      lines.push(`|-------|-------|`);
      lines.push(`| Relayer job | \`${row.jobId}\` |`);
      if (lockTx) lines.push(`| Lock tx (Cardano) | \`${lockTx}\` |`);
      if (releaseTx) lines.push(`| BridgeRelease tx (Cardano) | \`${releaseTx}\` |`);
      lines.push('');
    }
    for (const r of report.redeems.filter((x) => x.kind === 'cardano')) {
      const fn = join(reportDir, `redeem-cardano-${r.asset}.json`);
      if (!existsSync(fn)) continue;
      const j = JSON.parse(readFileSync(fn, 'utf8'));
      const hint = j.finalJob?.destinationHint || '';
      const br = parseBridgeReleaseCardanoTx(hint);
      lines.push(`### ${r.asset} — redeem (BURN intent anchor + EVM payout)`);
      lines.push('');
      lines.push(`| Field | Value |`);
      lines.push(`|-------|-------|`);
      lines.push(`| Relayer job | \`${r.jobId}\` |`);
      const src = j.finalJob?.intent?.source?.cardano;
      if (src?.txHash) lines.push(`| Lock UTxO tx (anchor) | \`${String(src.txHash).toLowerCase()}\` |`);
      if (src?.spendTxHash) lines.push(`| BridgeRelease / spend tx (intent) | \`${String(src.spendTxHash).toLowerCase()}\` |`);
      if (br) lines.push(`| BridgeRelease line in hint | \`${br}\` |`);
      const u = parseEvmUnlockTx(hint);
      if (u) lines.push(`| EVM unlock tx | \`${u}\` |`);
      lines.push('');
    }
  }

  lines.push(`## Midnight`);
  lines.push('');
  if (matrixMeta.skipMidnight) {
    lines.push('_No Midnight transactions in this run._');
    lines.push('');
  } else {
    for (const row of report.mints.filter((x) => x.destination === 'midnight')) {
      const m = row.midnight || {};
      lines.push(`### ${row.asset} — registry mint pipeline`);
      lines.push('');
      lines.push(`| Step | txId | txHash (if present) |`);
      lines.push(`|------|------|---------------------|`);
      const rows = [
        ['registerDeposit', m.registerDeposit],
        ['proveHolder', m.proveHolder],
        ['mintWrappedUnshielded', m.mintWrappedUnshielded],
      ];
      for (const [label, o] of rows) {
        lines.push(`| ${label} | ${o?.txId ?? '—'} | ${o?.txHash ?? '—'} |`);
      }
      if (m.depositCommitmentHex) lines.push('');
      if (m.depositCommitmentHex) lines.push(`**Ledger deposit (hex):** \`${m.depositCommitmentHex}\``);
      lines.push('');
    }
    for (const r of report.redeems.filter((x) => x.kind === 'midnight')) {
      lines.push(`### ${r.asset} — registry burn / finalize pipeline`);
      lines.push('');
      lines.push(`| Step | txId | txHash |`);
      lines.push(`|------|------|--------|`);
      const b = r.midnightBurnTxs || {};
      for (const [label, o] of Object.entries(b)) {
        const x = o || {};
        lines.push(`| ${label} | ${x.txId ?? '—'} | ${x.txHash ?? '—'} |`);
      }
      if (r.initiateBurn?.txId) {
        lines.push('');
        lines.push(`**Pre-relayer \`initiateBurn\` (ops script):** txId \`${r.initiateBurn.txId}\` — txHash \`${r.initiateBurn.txHash ?? '—'}\``);
      }
      const fn = join(reportDir, `redeem-midnight-${r.asset}.json`);
      if (existsSync(fn)) {
        const j = JSON.parse(readFileSync(fn, 'utf8'));
        const u = parseEvmUnlockTx(j.finalJob?.destinationHint || '');
        if (u) {
          lines.push('');
          lines.push(`**EVM underlying unlock:** \`${u}\``);
        }
      }
      lines.push('');
    }
  }

  lines.push(`## Machine-readable`);
  lines.push('');
  lines.push(`- \`summary.json\` — full matrix summary`);
  lines.push(`- \`mint-*.json\`, \`redeem-*.json\` — per-step zk-bridge outputs`);
  lines.push('');

  writeFileSync(join(reportDir, 'TX_HASH_REPORT.md'), lines.join('\n'));
}

function randomHex64() {
  const b = Buffer.allocUnsafe(32);
  for (let i = 0; i < 32; i++) b[i] = Math.floor(Math.random() * 256);
  return b.toString('hex');
}

async function runMidnightInitiateBurn(depositHex, recipientCommHex, destChainIdStr = '2') {
  const viaCli = process.env.OPS_INITIATE_BURN_VIA_CLI === '1' || process.env.OPS_INITIATE_BURN_VIA_CLI === 'true';
  if (!viaCli) {
    const url = `${RELAYER_URL}/v1/midnight/initiate-burn`;
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await undiciFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', connection: 'close' },
          body: JSON.stringify({
            depositCommitmentHex: depositHex,
            recipientCommitmentHex: recipientCommHex,
            destChainId: destChainIdStr,
          }),
          dispatcher: initiateBurnDispatcher,
        });
        const text = await res.text();
        if (res.ok) {
          return JSON.parse(text);
        }
        if (res.status === 404) {
          console.warn('[ops-matrix] POST /v1/midnight/initiate-burn 404 — falling back to npx tsx (restart relayer after upgrade)');
          break;
        }
        let msg = text;
        try {
          msg = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          /* raw */
        }
        throw new Error(`initiate-burn HTTP ${res.status}: ${msg}`);
      } catch (e) {
        lastErr = e;
        const detail = e instanceof Error ? `${e.message}${e.cause ? `; cause=${String(e.cause)}` : ''}` : String(e);
        if (e instanceof Error && e.message.startsWith('initiate-burn HTTP 409')) {
          throw e;
        }
        if (attempt < 3) {
          console.warn(`[ops-matrix] initiate-burn fetch attempt ${attempt}/3 failed (${detail}) — retrying in 2s`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
    if (lastErr) {
      console.warn(`[ops-matrix] initiate-burn HTTP failed after retries (${lastErr instanceof Error ? lastErr.message : String(lastErr)}) — falling back to npx tsx`);
    }
  }
  const out = execFileSync('npx', ['tsx', midnightInitScript, depositHex, recipientCommHex, destChainIdStr], {
    cwd: join(ROOT, 'zk-stables-relayer'),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
  const line = out.split('\n').filter((l) => l.startsWith('{'))[0] || out;
  return JSON.parse(line);
}

async function main() {
  if (!existsSync(bridgeCli)) {
    console.error(`Missing ${bridgeCli} — run: npm run bridge-cli:build`);
    process.exit(1);
  }
  const addrs = process.env.BRIDGE_CLI_ADDRESSES_JSON || '/tmp/zk-stables-anvil-addrs.json';
  if (!existsSync(addrs)) {
    console.error(`Missing ${addrs} — run: npm run demo:write-anvil-addrs-tmp (or set BRIDGE_CLI_ADDRESSES_JSON)`);
    process.exit(1);
  }
  mkdirSync(REPORT_DIR, { recursive: true });
  /** Why Midnight mint/redeem was skipped (empty if Midnight ran or was never selected). */
  let midnightSkipReason = '';

  const snap = await fetchRecipients();
  applyBalanceSnapshotBridgeCliEnv(snap);
  await applyMidnightBalanceEnvFromDemo();
  const ada = snap.cardanoRecipient;
  const evm = snap.evmRecipient;
  let mid = await resolveMidnightRecipient(snap.midnightRecipient);
  if (!evm) throw new Error('Relayer has no RELAYER_BRIDGE_EVM_RECIPIENT (needed for redeem payout)');
  if (!skipCardano && !ada) {
    console.warn('No RELAYER_BRIDGE_CARDANO_RECIPIENT — skipping Cardano mint/redeem');
    skipCardano = true;
  }
  if (!skipMidnight && !mid) {
    midnightSkipReason =
      'No valid `mn_addr` Midnight recipient (set RELAYER_BRIDGE_MIDNIGHT_RECIPIENT, OPS_MIDNIGHT_RECIPIENT, or RELAYER_ENABLE_DEMO_WALLETS + /v1/demo/wallets).';
    console.warn(
      'No valid Midnight mn_addr recipient (set RELAYER_BRIDGE_MIDNIGHT_RECIPIENT, OPS_MIDNIGHT_RECIPIENT, or enable RELAYER_ENABLE_DEMO_WALLETS for /v1/demo/wallets) — skipping Midnight mint/redeem',
    );
    skipMidnight = true;
  }
  if (skipCardano && skipMidnight) {
    throw new Error('Nothing to run: both Cardano and Midnight skipped (configure bridge recipients)');
  }

  if (!skipMidnight) {
    const idxUrl = (process.env.RELAYER_MIDNIGHT_INDEXER_URL || 'http://127.0.0.1:8088/api/v4/graphql').trim();
    try {
      const res = await fetch(idxUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'query{__typename}' }),
      });
      if (!res.ok) {
        midnightSkipReason = `Midnight indexer HTTP ${res.status} at ${idxUrl} (start indexer or set RELAYER_MIDNIGHT_INDEXER_URL).`;
        console.warn(`Midnight indexer HTTP ${res.status} at ${idxUrl} — skipping Midnight (start local network or fix RELAYER_MIDNIGHT_INDEXER_URL)`);
        skipMidnight = true;
      }
    } catch (e) {
      midnightSkipReason = `Midnight indexer unreachable at ${idxUrl}: ${String(e)}`;
      console.warn(`Midnight indexer unreachable (${String(e)}). Skipping Midnight mint/redeem.`);
      skipMidnight = true;
    }
  }
  if (skipCardano && skipMidnight) {
    throw new Error('Nothing to run after Midnight indexer check');
  }

  const report = { relayerUrl: RELAYER_URL, amount: AMOUNT, midnightRecipientUsed: mid || undefined, mints: [], redeems: [] };

  const mintSpecs = [];
  if (!skipCardano) {
    mintSpecs.push({ asset: 'USDC', dest: 'cardano', recipient: ada });
    mintSpecs.push({ asset: 'USDT', dest: 'cardano', recipient: ada });
  }
  if (!skipMidnight) {
    mintSpecs.push({ asset: 'USDC', dest: 'midnight', recipient: mid });
    mintSpecs.push({ asset: 'USDT', dest: 'midnight', recipient: mid });
  }

  let balanceBefore;
  let balanceAfter;
  if (process.env.OPS_SKIP_BALANCES !== '1' && process.env.OPS_SKIP_BALANCES !== 'true') {
    try {
      console.error('[ops-matrix] capturing balance-before (merged EVM + Cardano + Midnight)…');
      balanceBefore = captureMergedBalanceSnapshotJson();
      writeFileSync(join(REPORT_DIR, 'balance-before.json'), JSON.stringify(balanceBefore, null, 2));
    } catch (e) {
      console.warn(`[ops-matrix] balance-before failed (${e instanceof Error ? e.message : String(e)}) — continuing matrix`);
    }
  }

  function writePartialMatrixReport(reason) {
    if (balanceBefore || balanceAfter) {
      report.balanceSnapshots = {
        ...(balanceBefore ? { before: balanceBefore } : {}),
        ...(balanceAfter ? { after: balanceAfter } : {}),
      };
    }
    report.matrixMeta = {
      skipCardano,
      skipMidnight,
      redeemOnly,
      ...(midnightSkipReason ? { midnightSkipReason } : {}),
      partialRun: true,
      partialReason: reason,
    };
    writeFileSync(join(REPORT_DIR, 'summary.json'), JSON.stringify(report, null, 2));
    writeTxHashReport(report, REPORT_DIR, report.matrixMeta);
    console.error(
      JSON.stringify(
        {
          partial: true,
          reportDir: REPORT_DIR,
          txHashReportMd: join(REPORT_DIR, 'TX_HASH_REPORT.md'),
          partialReason: reason,
        },
        null,
        2,
      ),
    );
  }

  function mintRowFromParsed(m, parsed) {
    const fj = parsed.finalJob;
    const mintRow = {
      asset: m.asset,
      destination: m.dest,
      jobId: parsed.relayerJobId,
      phase: fj?.phase,
      lockRef: fj?.lockRef,
      digest: fj?.proofBundle?.digest,
      evmLockTxHash: parsed.lockTxHash,
      destinationHint: fj?.destinationHint,
    };
    if (m.dest === 'midnight' && fj?.destinationHint) {
      mintRow.midnight = parseMidnightMintTxs(fj.destinationHint);
    }
    return mintRow;
  }

  if (redeemOnly) {
    for (const m of mintSpecs) {
      const p = join(REPORT_DIR, `mint-${m.asset}-${m.dest}.json`);
      if (!existsSync(p)) {
        throw new Error(
          `OPS_REDEEM_ONLY: missing ${p} — run a full matrix first or set OPS_REPORT_DIR to a directory that contains mint reports`,
        );
      }
      const parsed = JSON.parse(readFileSync(p, 'utf8'));
      const fj = parsed.finalJob;
      if (fj?.phase !== 'completed') {
        throw new Error(`OPS_REDEEM_ONLY: ${p} finalJob.phase=${fj?.phase} (need completed)`);
      }
      report.mints.push(mintRowFromParsed(m, parsed));
      console.error(`[ops-matrix] redeem-only: loaded mint ${m.asset} → ${m.dest} from ${p}`);
    }
  } else {
    for (const m of mintSpecs) {
      console.error(`[ops-matrix] mint ${m.asset} → ${m.dest} (zk-bridge --follow; stderr shows job heartbeats)`);
      const args = [
        'mint',
        '--destination',
        m.dest,
        '--asset',
        m.asset,
        '--amount',
        AMOUNT,
        '--recipient',
        m.recipient,
        '--follow',
        'true',
        '--json',
      ];
      let parsed;
      try {
        const raw = zkBridge(args);
        parsed = JSON.parse(raw);
      } catch (e) {
        writePartialMatrixReport(`zk-bridge mint ${m.asset}→${m.dest}: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      }
      const fj = parsed.finalJob;
      writeFileSync(join(REPORT_DIR, `mint-${m.asset}-${m.dest}.json`), JSON.stringify(parsed, null, 2));
      report.mints.push(mintRowFromParsed(m, parsed));
      if (fj?.phase !== 'completed') {
        writePartialMatrixReport(`mint job ${parsed.relayerJobId} ended phase=${fj?.phase} (expected completed)`);
        console.error(JSON.stringify({ error: 'mint job did not complete', parsed }, null, 2));
        process.exit(1);
      }
    }
  }

  if (!skipCardano) {
    for (const row of report.mints.filter((x) => x.destination === 'cardano')) {
      console.error(`[ops-matrix] redeem cardano ${row.asset} → EVM`);
      const full = JSON.parse(readFileSync(join(REPORT_DIR, `mint-${row.asset}-cardano.json`), 'utf8'));
      const fj = full.finalJob;
      const hint = fj.destinationHint || '';
      const { lockTx, releaseTx } = parseLockReleaseTxs(hint);
      if (!lockTx || !releaseTx) {
        console.error('Could not parse Cardano lock/release from destinationHint:', hint.slice(0, 400));
        process.exit(1);
      }
      const bc = cardanoBurnCommitment(fj.lockRef, fj.proofBundle?.digest);
      const args = [
        'redeem',
        'cardano',
        '--asset',
        row.asset,
        '--amount',
        AMOUNT,
        '--payout',
        evm,
        '--burn-commitment',
        bc,
        '--lock-tx',
        lockTx,
        '--lock-output-index',
        '0',
        '--spend-tx',
        releaseTx,
        '--follow',
        'true',
        '--json',
      ];
      const raw = zkBridge(args);
      const parsed = JSON.parse(raw);
      writeFileSync(join(REPORT_DIR, `redeem-cardano-${row.asset}.json`), JSON.stringify(parsed, null, 2));
      report.redeems.push({ kind: 'cardano', asset: row.asset, jobId: parsed.relayerJobId, phase: parsed.finalJob?.phase });
      if (parsed.finalJob?.phase !== 'completed') process.exit(1);
    }
  }

  if (!skipMidnight) {
    for (const row of report.mints.filter((x) => x.destination === 'midnight')) {
      console.error(`[ops-matrix] redeem midnight ${row.asset} → EVM (initiateBurn then zk-bridge)`);
      const full = JSON.parse(readFileSync(join(REPORT_DIR, `mint-${row.asset}-midnight.json`), 'utf8'));
      const fj = full.finalJob;
      const hint = fj.destinationHint || '';
      const depHex = parseMidnightDepositHex(hint);
      if (!depHex) {
        console.error('Could not parse Midnight Deposit hex from hint');
        process.exit(1);
      }
      const recipientComm = randomHex64();
      const init = await runMidnightInitiateBurn(depHex, recipientComm);
      const args = [
        'redeem',
        'midnight',
        '--asset',
        row.asset,
        '--amount',
        AMOUNT,
        '--payout',
        evm,
        '--burn-commitment',
        recipientComm,
        '--deposit-commitment',
        depHex,
        '--tx-id',
        init.txId,
        '--dest-chain-id',
        '2',
        '--follow',
        'true',
        '--json',
      ];
      const raw = zkBridge(args);
      const parsed = JSON.parse(raw);
      writeFileSync(join(REPORT_DIR, `redeem-midnight-${row.asset}.json`), JSON.stringify(parsed, null, 2));
      const burnHint = parsed.finalJob?.destinationHint || '';
      report.redeems.push({
        kind: 'midnight',
        asset: row.asset,
        initiateBurn: init,
        midnightBurnTxs: parseMidnightBurnTxs(burnHint),
        jobId: parsed.relayerJobId,
        phase: parsed.finalJob?.phase,
        destinationHint: burnHint,
      });
      if (parsed.finalJob?.phase !== 'completed') process.exit(1);
    }
  }

  if (process.env.OPS_SKIP_BALANCES !== '1' && process.env.OPS_SKIP_BALANCES !== 'true') {
    try {
      console.error('[ops-matrix] capturing balance-after (merged)…');
      balanceAfter = captureMergedBalanceSnapshotJson();
      writeFileSync(join(REPORT_DIR, 'balance-after.json'), JSON.stringify(balanceAfter, null, 2));
    } catch (e) {
      console.warn(`[ops-matrix] balance-after failed (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  if (balanceBefore || balanceAfter) {
    report.balanceSnapshots = {
      ...(balanceBefore ? { before: balanceBefore } : {}),
      ...(balanceAfter ? { after: balanceAfter } : {}),
    };
  }

  report.matrixMeta = {
    skipCardano,
    skipMidnight,
    redeemOnly,
    ...(midnightSkipReason ? { midnightSkipReason } : {}),
  };
  writeFileSync(join(REPORT_DIR, 'summary.json'), JSON.stringify(report, null, 2));
  writeTxHashReport(report, REPORT_DIR, {
    skipCardano,
    skipMidnight,
    midnightSkipReason,
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        reportDir: REPORT_DIR,
        txHashReportMd: join(REPORT_DIR, 'TX_HASH_REPORT.md'),
        ...report,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
