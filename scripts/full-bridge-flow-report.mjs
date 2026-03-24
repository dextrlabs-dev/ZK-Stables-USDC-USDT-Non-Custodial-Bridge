#!/usr/bin/env node
/**
 * One-shot bridge flow driver + report: EVM mUSDC/mUSDT pool locks, HTTP LOCK → Cardano / Midnight,
 * HTTP BURN (Cardano + Midnight sources) → EVM payout when relayer env is set.
 *
 * Prerequisites: Anvil (8545), zk-stables-relayer (RELAYER_PORT), optional Yaci + Midnight for real settlement.
 * Recipients default from GET /v1/demo/wallets when RELAYER_ENABLE_DEMO_WALLETS=true.
 *
 * Usage (repo root):
 *   npm run bridge-flow-report
 *   RELAYER_URL=http://127.0.0.1:8787 BRIDGE_FLOW_SKIP_DEPLOY=1 npm run bridge-flow-report
 *
 * Outputs: BRIDGE_FLOW_REPORT_JSON (default /tmp/zk-stables-bridge-flow-report.json)
 *          BRIDGE_FLOW_REPORT_MD   (default /tmp/zk-stables-bridge-flow-report.md)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RELAYER_URL = (process.env.RELAYER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const EVM_RPC = process.env.EVM_RPC_URL || process.env.RELAYER_EVM_RPC_URL || 'http://127.0.0.1:8545';
const ADDRS_JSON = process.env.DEPLOY_ADDRS_JSON || '/tmp/zk-stables-anvil-addrs.json';
const REPORT_JSON = process.env.BRIDGE_FLOW_REPORT_JSON || '/tmp/zk-stables-bridge-flow-report.json';
const REPORT_MD = process.env.BRIDGE_FLOW_REPORT_MD || '/tmp/zk-stables-bridge-flow-report.md';
const SKIP_DEPLOY = process.env.BRIDGE_FLOW_SKIP_DEPLOY === '1' || process.env.BRIDGE_FLOW_SKIP_DEPLOY === 'true';
const JOB_WAIT_MS = Number(process.env.BRIDGE_FLOW_JOB_WAIT_MS || 180000);
const POLL_MS = 800;

function m(re, s) {
  const x = re.exec(s ?? '');
  return x?.[1];
}

/** Aligns with zk-stables-ui/src/lib/relayerTxParsing.ts */
function parseDestinationHintTxs(hint) {
  const h = hint ?? '';
  const out = {};
  const unlockTx = m(/Unlock tx:\s*(0x[a-fA-F0-9]{64})/u, h);
  const mintTx = m(/Auto-mint tx:\s*(0x[a-fA-F0-9]{64})/u, h);
  const operatorUnlockTx = m(/EVM underlying payout \(operator unlock\):\s*(0x[a-fA-F0-9]{64})/u, h);
  if (unlockTx || mintTx || operatorUnlockTx) {
    out.evm = { ...(unlockTx ? { unlockTx } : {}), ...(mintTx ? { mintTx } : {}), ...(operatorUnlockTx ? { operatorUnlockTx } : {}) };
  }
  const cardanoPayout = m(/Cardano payout tx:\s*([0-9a-fA-F]{64})/u, h);
  const cardanoUnlockPayout = m(/Cardano unlock\/payout tx:\s*([0-9a-fA-F]{64})/u, h);
  if (cardanoPayout || cardanoUnlockPayout) {
    out.cardano = {
      ...(cardanoPayout ? { payoutTx: cardanoPayout } : {}),
      ...(cardanoUnlockPayout ? { unlockTx: cardanoUnlockPayout } : {}),
    };
  }
  const contract = m(/Contract\s+([0-9a-fA-F]{64})/u, h);
  const proveTxId = m(/proveHolder txId=([0-9a-fA-F]{66,})/u, h);
  const proveTxHash = m(/proveHolder txId=[0-9a-fA-F]{66,}\s+txHash=([0-9a-fA-F]{64})/u, h);
  const mintTxId = m(/mintWrappedUnshielded txId=([0-9a-fA-F]{66,})/u, h);
  const mintTxHash = m(/mintWrappedUnshielded txId=[0-9a-fA-F]{66,}\s+txHash=([0-9a-fA-F]{64})/u, h);
  if (contract || proveTxId || proveTxHash || mintTxId || mintTxHash) {
    out.midnight = {
      ...(contract ? { contract } : {}),
      ...(proveTxId || proveTxHash
        ? { proveHolder: { ...(proveTxId ? { txId: proveTxId } : {}), ...(proveTxHash ? { txHash: proveTxHash } : {}) } }
        : {}),
      ...(mintTxId || mintTxHash
        ? { mintWrappedUnshielded: { ...(mintTxId ? { txId: mintTxId } : {}), ...(mintTxHash ? { txHash: mintTxHash } : {}) } }
        : {}),
    };
  }
  return out;
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'content-type': 'application/json', ...opts.headers },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${res.status} ${url}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function execEvmHardhat(script, extraEnv = {}) {
  const env = {
    ...process.env,
    EVM_RPC_URL: EVM_RPC,
    DEPLOY_ADDRS_JSON: ADDRS_JSON,
    ...extraEnv,
  };
  return execFileSync('npx', ['hardhat', 'run', script, '--network', 'anvil'], {
    cwd: join(ROOT, 'evm'),
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function deployAnvil() {
  const out = execEvmHardhat('scripts/deploy-anvil.js');
  const start = out.indexOf('{');
  if (start < 0) throw new Error('deploy-anvil: no JSON in output');
  const json = out.slice(start);
  writeFileSync(ADDRS_JSON, json.trim() + '\n', 'utf8');
  return JSON.parse(json.trim());
}

function emitLockToken(token, amountRaw = '1000000') {
  const raw = execEvmHardhat('scripts/integration-emit-lock.js', {
    LOCK_TOKEN: token,
    LOCK_AMOUNT_RAW: String(amountRaw),
  });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error(`integration-emit-lock (${token}): no JSON`);
  return JSON.parse(raw.slice(start).trim());
}

async function tryDemoWallets() {
  try {
    return await fetchJson(`${RELAYER_URL}/v1/demo/wallets`);
  } catch {
    return null;
  }
}

async function postLock(payload) {
  return fetchJson(`${RELAYER_URL}/v1/intents/lock`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function postBurn(payload) {
  return fetchJson(`${RELAYER_URL}/v1/intents/burn`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function getJob(id) {
  return fetchJson(`${RELAYER_URL}/v1/jobs/${encodeURIComponent(id)}`);
}

async function listJobs() {
  const data = await fetchJson(`${RELAYER_URL}/v1/jobs`);
  return data.jobs ?? [];
}

async function waitJob(id) {
  const deadline = Date.now() + JOB_WAIT_MS;
  while (Date.now() < deadline) {
    const j = await getJob(id);
    if (j.phase === 'completed' || j.phase === 'failed') return j;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return getJob(id);
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

async function main() {
  const started = new Date().toISOString();
  const report = {
    generatedAt: started,
    relayerUrl: RELAYER_URL,
    evmRpc: EVM_RPC,
    steps: [],
    evmOnChain: [],
    relayerJobs: [],
    errors: [],
    aggregated: { evm: [], cardano: [], midnight: [] },
  };

  const logStep = (name, detail) => {
    report.steps.push({ t: new Date().toISOString(), name, detail });
  };

  // --- Preflight ---
  try {
    await fetchJson(`${RELAYER_URL}/v1/health/chains`);
    logStep('preflight', 'relayer /v1/health/chains OK');
  } catch (e) {
    report.errors.push({ step: 'preflight', message: String(e.message) });
    logStep('preflight', `FAIL: ${e.message}`);
    mkdirSync(dirname(REPORT_JSON), { recursive: true });
    writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
    console.error('Relayer unreachable. Start zk-stables-relayer and set RELAYER_URL.');
    process.exit(1);
  }

  // --- EVM deploy + locks ---
  if (!SKIP_DEPLOY) {
    try {
      const addrs = deployAnvil();
      logStep('evm_deploy', { addrs });
      report.evmDeploy = addrs;
    } catch (e) {
      report.errors.push({ step: 'evm_deploy', message: String(e.message) });
      logStep('evm_deploy', `SKIP/FAIL: ${e.message}`);
    }
    /* Per-scenario locks happen below with matching amounts (HTTP LOCK now requires source.evm). */
  } else {
    logStep('evm', 'BRIDGE_FLOW_SKIP_DEPLOY=1 — skipped deploy + pool.lock');
  }

  // --- Recipients ---
  let cardanoRecipient = process.env.BRIDGE_CARDANO_RECIPIENT?.trim();
  let midnightRecipient = process.env.BRIDGE_MIDNIGHT_RECIPIENT?.trim();
  let evmPayout = process.env.BRIDGE_EVM_PAYOUT_RECIPIENT?.trim();
  const demo = await tryDemoWallets();
  if (demo?.cardano?.addresses?.length) {
    const dst = demo.cardano.addresses.find((a) => a.role === 'destination') ?? demo.cardano.addresses[0];
    cardanoRecipient = cardanoRecipient || dst?.bech32;
  }
  if (demo?.midnight?.shieldedExample) {
    midnightRecipient = midnightRecipient || demo.midnight.shieldedExample;
  }
  if (demo?.evm?.accounts?.[0]?.address) {
    evmPayout = evmPayout || demo.evm.accounts[0].address;
  }
  if (!cardanoRecipient) {
    cardanoRecipient =
      'addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn';
  }
  if (!midnightRecipient) {
    midnightRecipient =
      'mn_addr_undeployed1ry6lnrfldz80fdvwrpxf5yyfftej5mjjj466dfpgcymh955j3gusey46r3';
  }
  if (!evmPayout || !/^0x[a-fA-F0-9]{40}$/.test(evmPayout)) {
    evmPayout = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  }
  report.recipients = { cardanoRecipient, midnightRecipient, evmPayout };
  logStep('recipients', report.recipients);

  const syntheticMidnightTxId =
    process.env.BRIDGE_FLOW_SYNTHETIC_MIDNIGHT_TX_ID?.replace(/^0x/i, '') || 'a'.repeat(64);

  const jobIds = [];

  // --- HTTP LOCK evm → cardano / midnight (zk path labels match UI: destinationChain = chain id string) ---
  const lockScenarios = [
    { destinationChain: 'cardano', asset: 'USDC', assetKind: 0, amount: '1.01' },
    { destinationChain: 'cardano', asset: 'USDT', assetKind: 1, amount: '1.02' },
    { destinationChain: 'midnight', asset: 'USDC', assetKind: 0, amount: '1.03' },
    { destinationChain: 'midnight', asset: 'USDT', assetKind: 1, amount: '1.04' },
  ];

  for (const s of lockScenarios) {
    const recipient = s.destinationChain === 'cardano' ? cardanoRecipient : midnightRecipient;
    const amountRaw = String(Math.round(parseFloat(s.amount) * 1e6));
    let lock = null;
    try {
      if (!existsSync(ADDRS_JSON)) throw new Error(`missing ${ADDRS_JSON}`);
      const tokenKey = s.asset === 'USDT' ? 'usdt' : 'usdc';
      lock = emitLockToken(tokenKey, amountRaw);
      report.evmOnChain.push({ kind: 'pool_lock', token: tokenKey, ...lock });
      logStep(`evm_lock_${s.asset}_${s.destinationChain}`, lock.txHash);
    } catch (e) {
      report.errors.push({
        step: `evm_lock_before_http_${s.asset}_${s.destinationChain}`,
        message: String(e.message),
      });
      logStep(`evm_lock_before_http_${s.asset}_${s.destinationChain}`, `FAIL: ${e.message}`);
    }
    const body = {
      operation: 'LOCK',
      sourceChain: 'evm',
      destinationChain: s.destinationChain,
      asset: s.asset,
      assetKind: s.assetKind,
      amount: s.amount,
      recipient,
      note: `full-bridge-flow-report.mjs LOCK ${s.asset} → ${s.destinationChain}`,
      ...(lock
        ? {
            source: {
              evm: {
                txHash: lock.txHash,
                logIndex: lock.logIndex,
                blockNumber: lock.blockNumber,
                poolLockAddress: lock.poolLock,
                token: lock.underlyingToken,
                nonce: lock.nonce,
              },
            },
          }
        : {}),
    };
    try {
      const res = await postLock(body);
      jobIds.push(res.jobId);
      logStep(`lock_http_${s.asset}_${s.destinationChain}`, res.jobId);
    } catch (e) {
      report.errors.push({
        step: `lock_http_${s.asset}_${s.destinationChain}`,
        message: e.message,
        body: e.body,
      });
      logStep(`lock_http_${s.asset}_${s.destinationChain}`, `FAIL: ${e.message}`);
    }
  }

  // --- HTTP BURN → EVM (relayer uses proof-digest fallback when burnCommitmentHex empty) ---
  const burnScenarios = [
    { sourceChain: 'cardano', asset: 'USDC', assetKind: 0, amount: '0.51' },
    { sourceChain: 'cardano', asset: 'USDT', assetKind: 1, amount: '0.52' },
    { sourceChain: 'midnight', asset: 'USDC', assetKind: 0, amount: '0.53' },
    { sourceChain: 'midnight', asset: 'USDT', assetKind: 1, amount: '0.54' },
  ];

  for (const s of burnScenarios) {
    const body = {
      operation: 'BURN',
      sourceChain: s.sourceChain,
      destinationChain: 'evm',
      asset: s.asset,
      assetKind: s.assetKind,
      amount: s.amount,
      recipient: evmPayout,
      burnCommitmentHex: '',
      note: `full-bridge-flow-report.mjs BURN ${s.sourceChain} ${s.asset} → EVM`,
      ...(s.sourceChain === 'midnight'
        ? {
            source: {
              midnight: {
                txId: syntheticMidnightTxId,
                destChainId: 0,
              },
            },
          }
        : {}),
    };
    try {
      const res = await postBurn(body);
      jobIds.push(res.jobId);
      logStep(`burn_http_${s.sourceChain}_${s.asset}`, res.jobId);
    } catch (e) {
      report.errors.push({
        step: `burn_http_${s.sourceChain}_${s.asset}`,
        message: e.message,
        body: e.body,
      });
      logStep(`burn_http_${s.sourceChain}_${s.asset}`, `FAIL: ${e.message}`);
    }
  }

  // --- Wait for submitted jobs ---
  for (const id of jobIds) {
    try {
      const j = await waitJob(id);
      report.relayerJobs.push(j);
      logStep(`wait_${id}`, j.phase);
    } catch (e) {
      report.errors.push({ step: `wait_${id}`, message: String(e.message) });
    }
  }

  // --- Full job list snapshot ---
  try {
    report.allJobsSnapshot = await listJobs();
  } catch (e) {
    report.allJobsSnapshotError = String(e.message);
  }

  // --- Aggregate txs from hints ---
  const evmSet = new Set();
  const adaSet = new Set();
  const midSet = new Set();
  for (const j of report.relayerJobs) {
    const parsed = parseDestinationHintTxs(j.destinationHint);
    if (parsed.evm?.unlockTx) evmSet.add(parsed.evm.unlockTx);
    if (parsed.evm?.mintTx) evmSet.add(parsed.evm.mintTx);
    if (parsed.evm?.operatorUnlockTx) evmSet.add(parsed.evm.operatorUnlockTx);
    if (parsed.cardano?.payoutTx) adaSet.add(parsed.cardano.payoutTx);
    if (parsed.cardano?.unlockTx) adaSet.add(parsed.cardano.unlockTx);
    if (parsed.midnight?.contract) midSet.add(`contract:${parsed.midnight.contract}`);
    if (parsed.midnight?.proveHolder?.txId) midSet.add(`proveHolder_txId:${parsed.midnight.proveHolder.txId}`);
    if (parsed.midnight?.proveHolder?.txHash) midSet.add(`proveHolder_txHash:${parsed.midnight.proveHolder.txHash}`);
    if (parsed.midnight?.mintWrappedUnshielded?.txId) {
      midSet.add(`mintWU_txId:${parsed.midnight.mintWrappedUnshielded.txId}`);
    }
    if (parsed.midnight?.mintWrappedUnshielded?.txHash) {
      midSet.add(`mintWU_txHash:${parsed.midnight.mintWrappedUnshielded.txHash}`);
    }
  }
  for (const x of report.evmOnChain) {
    if (x.txHash) evmSet.add(x.txHash);
  }
  report.aggregated.evm = [...evmSet];
  report.aggregated.cardano = [...adaSet];
  report.aggregated.midnight = [...midSet];

  // --- Markdown ---
  const lines = [];
  lines.push('# ZK-Stables full bridge flow report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Relayer: \`${RELAYER_URL}\` · EVM RPC: \`${EVM_RPC}\``);
  lines.push('');
  lines.push('## Scope');
  lines.push('');
  lines.push(
    '- **LOCK (HTTP):** `sourceChain: evm` plus **`source.evm`** (`txHash`, `logIndex`, `blockNumber` from `ZkStablesPoolLock.lock`) → **Cardano** / **Midnight** zk mint; this script runs `pool.lock` per scenario then posts the anchored intent.',
  );
  lines.push(
    '- **BURN (HTTP):** Cardano / Midnight → **EVM** underlying payout when `RELAYER_EVM_POOL_LOCK` + private key + underlying tokens are configured; empty `burnCommitmentHex` uses proof-digest fallback when allowed.',
  );
  lines.push(
    '- **On-chain zk burns** on Cardano / Midnight (user-signed `BridgeRelease`, `initiateBurn`, etc.) are **not** automated here; this script drives **relayer jobs** only. Use the UI + funded wallets for full SRS parity.',
  );
  lines.push('');
  lines.push('## EVM transactions (script-driven)');
  lines.push('');
  lines.push('| Kind | Token | tx hash |');
  lines.push('|------|-------|---------|');
  for (const x of report.evmOnChain) {
    lines.push(`| pool.lock | ${x.token ?? '—'} | \`${x.txHash}\` |`);
  }
  if (report.evmOnChain.length === 0) lines.push('| — | — | *(none — set BRIDGE_FLOW_SKIP_DEPLOY=0 and run Anvil)* |');
  lines.push('');
  lines.push('## Relayer jobs (this run)');
  lines.push('');
  lines.push('| Job id | Op | Src→Dst | Asset | Phase | Parsed txs |');
  lines.push('|--------|----|---------|-------|-------|--------------|');
  for (const j of report.relayerJobs) {
    const op = j.intent?.operation ?? '—';
    const src = j.intent?.sourceChain ?? '—';
    const dst = j.intent?.destinationChain ?? '—';
    const asset = j.intent?.asset ?? '—';
    const parsed = parseDestinationHintTxs(j.destinationHint);
    const txSummary = [
      parsed.evm && Object.values(parsed.evm).filter(Boolean).join(', '),
      parsed.cardano && Object.values(parsed.cardano).filter(Boolean).join(', '),
      parsed.midnight && JSON.stringify(parsed.midnight),
    ]
      .filter(Boolean)
      .join(' | ');
    lines.push(`| \`${j.id}\` | ${op} | ${src}→${dst} | ${asset} | **${j.phase}** | ${txSummary || '—'} |`);
  }
  lines.push('');
  lines.push('## Aggregated transaction references (from destination hints + EVM locks)');
  lines.push('');
  lines.push('### EVM');
  lines.push('');
  for (const h of report.aggregated.evm) lines.push(`- \`${h}\``);
  if (report.aggregated.evm.length === 0) lines.push('- *(none)*');
  lines.push('');
  lines.push('### Cardano');
  lines.push('');
  for (const h of report.aggregated.cardano) lines.push(`- \`${h}\``);
  if (report.aggregated.cardano.length === 0) lines.push('- *(none — enable Cardano bridge + indexer)*');
  lines.push('');
  lines.push('### Midnight (relayer pipeline: proveHolder / mintWrappedUnshielded / contract)');
  lines.push('');
  for (const h of report.aggregated.midnight) lines.push(`- ${h}`);
  if (report.aggregated.midnight.length === 0) lines.push('- *(none — enable RELAYER_MIDNIGHT_ENABLED + working wallet/indexer)*');
  lines.push('');
  lines.push('## Errors');
  lines.push('');
  if (report.errors.length === 0) lines.push('None.');
  else lines.push('```json\n' + JSON.stringify(report.errors, null, 2) + '\n```');
  lines.push('');
  lines.push('## Steps (timeline)');
  lines.push('');
  for (const s of report.steps) {
    lines.push(`- **${s.name}** (${s.t}): ${typeof s.detail === 'object' ? JSON.stringify(s.detail) : s.detail}`);
  }
  lines.push('');

  mkdirSync(dirname(REPORT_JSON), { recursive: true });
  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(REPORT_MD, lines.join('\n'), 'utf8');

  console.log(`Wrote ${REPORT_JSON}`);
  console.log(`Wrote ${REPORT_MD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
