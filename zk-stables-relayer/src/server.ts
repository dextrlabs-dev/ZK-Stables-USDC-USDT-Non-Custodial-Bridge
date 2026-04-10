import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import pino from 'pino';
import type { BurnIntent, LockIntent } from './types.js';
import { validateAndNormalizeEvmLockSource } from './config/evmLockIntentValidation.js';
import { enqueueLockIntent } from './pipeline/runJob.js';
import { getJob, listJobs } from './store.js';
import { buildDemoWallets } from './demo/buildDemoWallets.js';
import { serializeRelayerJob } from './jobSerialization.js';
import { evmRpcOk, midnightIndexerPing } from './adapters/chainHealth.js';
import { blockfrostLatestBlock } from './adapters/cardanoBlockfrost.js';
import { yaciLatestBlock } from './adapters/cardanoYaci.js';
import {
  blockfrostNetwork,
  blockfrostProjectId,
  cardanoIndexerMode,
  resolveYaciBaseUrl,
} from './adapters/cardanoIndexer.js';
import { runEvmLockWatcher } from './watchers/evmLockWatcher.js';
import { runCardanoLockWatcher } from './watchers/cardanoLockWatcher.js';
import { runEvmBurnWatcher } from './watchers/evmBurnWatcher.js';
import {
  effectiveBurnRecipient,
  effectiveLockRecipient,
  mergeRelayerBridgeIntoConnected,
  relayerBridgeSnapshot,
} from './config/bridgeRecipients.js';
import { isMidnightRelayerInitEnabled } from './adapters/midnightOperatorConsoleTx.js';
import {
  getMidnightContractAddress,
  readMidnightRegistryDepositBurnPreflight,
  submitMidnightInitiateBurnHttp,
  warmupMidnightRelayer,
} from './midnight/service.js';
import { assertRelayerStartupConfig } from './config/srsCompliance.js';
import { validateCardanoBurnIntentLockDatum } from './adapters/cardanoAiken/validateCardanoBurnIntent.js';
import { loadBlueprint } from './adapters/cardanoAiken/blueprint.js';
import { getLockPoolScript } from './adapters/cardanoAiken/scripts.js';
import { handleBridgeConsoleState } from './http/bridgeConsoleState.js';
import { handleEvmRecentLocks } from './http/evmRecentLocks.js';
import { handleCardanoRecentBurnHints } from './http/cardanoRecentBurnHints.js';
import { handleEvmRecentBurnHints } from './http/evmRecentBurnHints.js';
import { handleMidnightRecentBurnHints } from './http/midnightRecentBurnHints.js';
import {
  handlePostEvmExecuteBurn,
  handlePostEvmExecuteLock,
  handlePostEvmOperatorMint,
  handlePostEvmOperatorRedeemToEvm,
} from './http/evmOperatorConsoleHttp.js';
import { handlePostCardanoOperatorMint, handlePostCardanoOperatorRedeemToEvm, handlePostCardanoOperatorSweepLocks } from './http/cardanoOperatorConsoleHttp.js';
import { handlePostMidnightOperatorRedeemToEvm } from './http/midnightOperatorConsoleHttp.js';
import { handleGetBalances } from './http/balances.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

function looksLikeEvmAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/u.test(addr.trim());
}

/** JSON may decode numeric fields as JS numbers; downstream uses string amounts and `parseLockNonceDecimal`. */
function normalizeBurnIntentBody(body: BurnIntent): void {
  const a = body.amount;
  body.amount =
    typeof a === 'number' && Number.isFinite(a)
      ? String(a)
      : String(a ?? '').trim();
  const c = body.source?.cardano;
  if (c && c.lockNonce != null && c.lockNonce !== '') {
    const ln = c.lockNonce as unknown;
    c.lockNonce =
      typeof ln === 'number' && Number.isFinite(ln)
        ? String(Math.trunc(ln))
        : String(ln).trim();
  }
  const m = body.source?.midnight;
  if (m && m.lockNonce != null && m.lockNonce !== '') {
    const ln = m.lockNonce as unknown;
    m.lockNonce =
      typeof ln === 'number' && Number.isFinite(ln)
        ? String(Math.trunc(ln))
        : String(ln).trim();
  }
}
assertRelayerStartupConfig(logger);
const port = Number(process.env.RELAYER_PORT ?? 8787);

{
  const yaci = resolveYaciBaseUrl();
  const bf = blockfrostProjectId();
  if (yaci && bf) {
    logger.info('RELAYER_YACI_URL or YACI_URL is set: Cardano indexer uses Yaci Store only; Blockfrost is ignored for Cardano health, watcher, and finality');
  }
}

const app = new Hono();

app.use('/*', cors({ origin: '*' }));

app.get('/health', (c) => c.json({ ok: true, service: 'zk-stables-relayer' }));

app.get('/v1/health/chains', async (c) => {
  /** Default: Foundry Anvil / local dev node (see `scripts/anvil-docker.sh`). */
  const evm = process.env.RELAYER_EVM_RPC_URL ?? 'http://127.0.0.1:8545';
  /** Default matches Brick Towers / local standalone indexer 4.x (`api/v4/graphql`; v3 path still exists but v4 is the current stack). */
  const indexer = process.env.RELAYER_MIDNIGHT_INDEXER_URL ?? 'http://127.0.0.1:8088/api/v4/graphql';
  const cMode = cardanoIndexerMode();
  const yaciBase = resolveYaciBaseUrl();
  const bfId = blockfrostProjectId();
  const bfNet = blockfrostNetwork();

  const cardanoPromise =
    cMode === 'yaci' && yaciBase
      ? yaciLatestBlock(yaciBase).then((st) => ({ kind: 'yaci' as const, st, yaciBase }))
      : bfId
        ? blockfrostLatestBlock(bfId, bfNet).then((st) => ({ kind: 'blockfrost' as const, st, bfId }))
        : Promise.resolve({ kind: 'skipped' as const });

  const [evmH, mid, cardanoRes] = await Promise.all([
    evmRpcOk(evm),
    midnightIndexerPing(indexer),
    cardanoPromise,
  ]);

  const evmSerialized =
    evmH.ok && evmH.blockNumber !== undefined
      ? { ...evmH, blockNumber: evmH.blockNumber.toString() }
      : evmH;

  let cardano: Record<string, unknown>;
  if (cardanoRes.kind === 'yaci') {
    const base = cardanoRes.yaciBase;
    cardano = {
      provider: 'yaci',
      baseUrlPreview: `${base.slice(0, 28)}${base.length > 28 ? '…' : ''}`,
      blockfrostIgnored: Boolean(bfId),
      ...cardanoRes.st,
    };
  } else if (cardanoRes.kind === 'blockfrost') {
    cardano = {
      provider: 'blockfrost',
      ...cardanoRes.st,
      projectIdPreview: `${cardanoRes.bfId.slice(0, 8)}…`,
    };
  } else {
    cardano = {
      skipped: true,
      note:
        'Set RELAYER_YACI_URL or YACI_URL (Yaci Store API base, e.g. http://127.0.0.1:8080/api/v1) for local dev, or RELAYER_BLOCKFROST_PROJECT_ID for Preprod/Mainnet. Never commit API keys.',
    };
  }

  return c.json({
    evm: { rpcUrl: evm, ...evmSerialized },
    midnightIndexer: { url: indexer, ...mid },
    cardano,
    relayerBridge: {
      ...relayerBridgeSnapshot().configured,
      midnight: relayerBridgeSnapshot().configured.midnight || isMidnightRelayerInitEnabled(),
    },
  });
});

app.get('/v1/bridge/recipients', (c) => c.json(relayerBridgeSnapshot()));

/** Operator-console: UTxO/balance snapshots + recent job anchors (selectors; no indexer scraping of arbitrary addresses). */
app.get('/v1/bridge/console-state', (c) => handleBridgeConsoleState(c, logger));
/** Alias (same payload) — easier to spot in older deployments or reverse proxies. */
app.get('/v1/console/bridge-state', (c) => handleBridgeConsoleState(c, logger));

/** Scan `Locked` logs for `amount` + `asset` (operator console auto-anchor). */
app.get('/v1/evm/recent-locks', (c) => handleEvmRecentLocks(c, logger));

/** Scan `lock_pool` UTxOs (inline datum) for `amount` + `asset` (operator console Cardano→EVM BURN auto-anchor). */
app.get('/v1/cardano/recent-burn-hints', (c) => handleCardanoRecentBurnHints(c, logger));

/** Scan wrapped-token `Burned` logs for `amount` + `asset` (operator console EVM BURN auto-anchor). */
app.get('/v1/evm/recent-burn-hints', (c) => handleEvmRecentBurnHints(c, logger));

/** Registry ledger deposits for `amount` + `asset` (operator console Midnight→EVM BURN auto-anchor; indexer only). */
app.get('/v1/midnight/recent-burn-hints', (c) => handleMidnightRecentBurnHints(c, logger));

/** Operator console: submit pool `approve` + `lock` with RELAYER_EVM_PRIVATE_KEY (gated by RELAYER_OPERATOR_CONSOLE_EVM_TX). */
app.post('/v1/evm/execute-lock', (c) => handlePostEvmExecuteLock(c, logger));

/** Operator console: submit wrapped-token `burn` with RELAYER_EVM_PRIVATE_KEY (same gate as execute-lock). */
app.post('/v1/evm/execute-burn', (c) => handlePostEvmExecuteBurn(c, logger));

/** Operator console: pool lock + enqueue LOCK (RELAYER_OPERATOR_CONSOLE_EVM_TX). */
app.post('/v1/evm/operator/mint', (c) => handlePostEvmOperatorMint(c, logger));

/** Operator console: wrapped burn + enqueue BURN (same gate as execute-burn). */
app.post('/v1/evm/operator/redeem-to-evm', (c) => handlePostEvmOperatorRedeemToEvm(c, logger));

/** Operator console: Cardano mint+lock+release (RELAYER_OPERATOR_CONSOLE_CARDANO_TX / RELAYER_OPERATOR_CONSOLE_ALL). */
app.post('/v1/cardano/operator/mint', (c) => handlePostCardanoOperatorMint(c, logger));

/** Operator console: scan lock_pool + enqueue BURN to EVM (same Cardano operator gate). */
app.post('/v1/cardano/operator/redeem-to-evm', (c) => handlePostCardanoOperatorRedeemToEvm(c, logger));

/** Burn-release all stale lock UTxOs at the Cardano lock_pool script (negative mint + ADA back to wallet). */
app.post('/v1/cardano/operator/sweep-locks', (c) => handlePostCardanoOperatorSweepLocks(c, logger));

app.get('/v1/midnight/contract', async (c) => {
  const addr = await getMidnightContractAddress();
  return c.json({ contractAddress: addr, enabled: isMidnightRelayerInitEnabled() });
});

/**
 * Ops / bridge-cli helper: run `initiateBurn` inside the relayer process (same LevelDB + pipeline mutex as mint/burn).
 * Avoids a second `npx tsx …/midnight-initiate-burn-only.ts` process blocking on `abstract-level` while the relayer proves.
 */
app.post('/v1/midnight/initiate-burn', async (c) => {
  if (!isMidnightRelayerInitEnabled()) {
    return c.json(
      {
        error:
          'Midnight wallet/bootstrap disabled. Set RELAYER_MIDNIGHT_ENABLED=true or RELAYER_OPERATOR_CONSOLE_MIDNIGHT_TX / RELAYER_OPERATOR_CONSOLE_ALL with GENESIS_SEED_HASH_HEX or BIP39_MNEMONIC + RELAYER_MIDNIGHT_CONTRACT_ADDRESS.',
      },
      503,
    );
  }
  type Body = {
    depositCommitmentHex?: string;
    recipientCommitmentHex?: string;
    destChainId?: string | number;
  };
  let body: Body;
  try {
    body = (await c.req.json()) as Body;
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  const dh = body.depositCommitmentHex?.trim().replace(/^0x/i, '') ?? '';
  const rh = body.recipientCommitmentHex?.trim().replace(/^0x/i, '') ?? '';
  if (dh.length !== 64 || !/^[0-9a-fA-F]+$/u.test(dh) || rh.length !== 64 || !/^[0-9a-fA-F]+$/u.test(rh)) {
    return c.json(
      { error: 'depositCommitmentHex and recipientCommitmentHex required (64 hex chars each, ledger deposit key + recipientComm)' },
      400,
    );
  }
  const destStr = body.destChainId != null ? String(body.destChainId).trim() : '2';
  let destChainId: bigint;
  try {
    destChainId = BigInt(destStr);
  } catch {
    return c.json({ error: 'invalid destChainId' }, 400);
  }
  const depositCommitment = Uint8Array.from(Buffer.from(dh, 'hex'));
  const recipientCommitment = Uint8Array.from(Buffer.from(rh, 'hex'));

  const skipPreflight =
    process.env.RELAYER_MIDNIGHT_INITIATE_BURN_SKIP_PREFLIGHT === '1' ||
    process.env.RELAYER_MIDNIGHT_INITIATE_BURN_SKIP_PREFLIGHT === 'true';
  if (!skipPreflight) {
    const pre = await readMidnightRegistryDepositBurnPreflight(logger, depositCommitment);
    if (!pre.okForInitiateBurn) {
      return c.json({ error: 'deposit_not_ready_for_initiateBurn', preflight: pre }, 409);
    }
  }

  try {
    const out = await submitMidnightInitiateBurnHttp(logger, {
      depositCommitment,
      destChainId,
      recipientCommitment,
    });
    return c.json(out, 200);
  } catch (e) {
    logger.error({ err: e }, 'POST /v1/midnight/initiate-burn failed');
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/** Operator console: scan registry + optional initiateBurn + enqueue BURN (Midnight relayer init). */
app.post('/v1/midnight/operator/redeem-to-evm', (c) => handlePostMidnightOperatorRedeemToEvm(c, logger));

/** Lock pool script CBOR + address for Mesh in the browser (same blueprint as relayer). */
app.get('/v1/cardano/bridge-metadata', (c) => {
  try {
    const networkId = Number(process.env.RELAYER_CARDANO_NETWORK_ID ?? process.env.CARDANO_NETWORK_ID ?? 0) === 1 ? 1 : 0;
    const bp = loadBlueprint();
    const { scriptCbor, address } = getLockPoolScript(bp, networkId);
    return c.json({
      networkId,
      meshNetwork: process.env.RELAYER_CARDANO_MESH_NETWORK ?? process.env.CARDANO_MESH_NETWORK ?? 'preprod',
      lockScriptAddress: address,
      lockScriptCborHex: scriptCbor,
    });
  } catch (e) {
    logger.error({ err: e }, 'GET /v1/cardano/bridge-metadata failed');
    return c.json({ error: 'Cardano blueprint / lock script not available on this server' }, 503);
  }
});

/** Demo wallets (mnemonics + derived EVM keys) — local integration only. */
app.get('/v1/demo/wallets', (c) => {
  if (process.env.RELAYER_ENABLE_DEMO_WALLETS !== 'true') {
    return c.json({ error: 'Demo wallets disabled. Set RELAYER_ENABLE_DEMO_WALLETS=true on the relayer.' }, 404);
  }
  return c.json(buildDemoWallets());
});

app.post('/v1/intents/lock', async (c) => {
  let body: LockIntent;
  try {
    body = (await c.req.json()) as LockIntent;
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (body.operation !== 'LOCK') return c.json({ error: 'operation must be LOCK' }, 400);
  if (!body.sourceChain || !['evm', 'cardano', 'midnight'].includes(body.sourceChain)) {
    return c.json({ error: 'invalid sourceChain' }, 400);
  }
  if (body.sourceChain !== 'evm') {
    return c.json(
      {
        error:
          'HTTP LOCK mint path: sourceChain must be evm (lock USDC/USDT on EVM → zk on Cardano/Midnight). Cardano lock UTxOs are picked up by RELAYER_CARDANO_WATCHER_ENABLED only.',
      },
      400,
    );
  }
  mergeRelayerBridgeIntoConnected(body);
  const recipient = effectiveLockRecipient(body);
  if (!recipient) {
    return c.json(
      {
        error:
          'recipient required (or set RELAYER_BRIDGE_EVM_RECIPIENT / RELAYER_BRIDGE_CARDANO_RECIPIENT for LOCK when sourceChain is midnight)',
      },
      400,
    );
  }
  body.recipient = recipient;

  const lockErr = validateAndNormalizeEvmLockSource(body);
  if (lockErr) return c.json({ error: lockErr }, 400);

  const job = await enqueueLockIntent(logger, body);
  if (!job) return c.json({ error: 'duplicate or skipped' }, 409);
  return c.json({ jobId: job.id, job: serializeRelayerJob(job) }, 202);
});

app.post('/v1/intents/burn', async (c) => {
  let body: BurnIntent;
  try {
    body = (await c.req.json()) as BurnIntent;
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (body.operation !== 'BURN') return c.json({ error: 'operation must be BURN' }, 400);
  if (!body.sourceChain || !['evm', 'cardano', 'midnight'].includes(body.sourceChain)) {
    return c.json({ error: 'invalid sourceChain' }, 400);
  }
  normalizeBurnIntentBody(body);
  mergeRelayerBridgeIntoConnected(body);
  const recipient = effectiveBurnRecipient(body);
  if (!recipient) {
    return c.json(
      {
        error:
          'recipient required (or set RELAYER_BRIDGE_EVM_RECIPIENT — BURN from Cardano/Midnight pays underlying on EVM only)',
      },
      400,
    );
  }
  body.recipient = recipient;
  if (
    (body.sourceChain === 'cardano' || body.sourceChain === 'midnight') &&
    !looksLikeEvmAddress(body.recipient)
  ) {
    return c.json(
      {
        error:
          'BURN from Cardano or Midnight requires recipient as an Ethereum 0x address (underlying USDC/USDT is claimed on EVM)',
      },
      400,
    );
  }
  const bc = body.burnCommitmentHex?.replace(/^0x/i, '') ?? '';
  if (bc.length !== 64 || !/^[0-9a-fA-F]+$/.test(bc)) {
    return c.json({ error: 'burnCommitmentHex required: 64 hex chars (32-byte burn binding)' }, 400);
  }

  if (body.sourceChain === 'midnight') {
    const mid = body.source?.midnight;
    const tid = mid?.txId?.trim() || mid?.txHash?.trim();
    if (!tid) {
      return c.json(
        {
          error:
            'Midnight BURN requires source.midnight.txId (or txHash) from the transaction that included initiateBurn',
        },
        400,
      );
    }
    const dch = mid?.depositCommitmentHex?.replace(/^0x/i, '').trim() ?? '';
    if (dch.length !== 64 || !/^[0-9a-fA-F]+$/.test(dch)) {
      return c.json(
        {
          error:
            'Midnight BURN requires source.midnight.depositCommitmentHex: 64 hex chars — the registry ledger deposit key (not the same as burnCommitmentHex / recipientComm)',
        },
        400,
      );
    }
  }

  const cardanoCheck = await validateCardanoBurnIntentLockDatum(body, logger);
  if (!cardanoCheck.ok) {
    return c.json({ error: cardanoCheck.error }, 400);
  }

  const job = await enqueueLockIntent(logger, body);
  if (!job) return c.json({ error: 'duplicate or skipped' }, 409);
  return c.json({ jobId: job.id, job: serializeRelayerJob(job) }, 202);
});

app.get('/v1/jobs', (c) => c.json({ jobs: listJobs().map(serializeRelayerJob) }));

app.get('/v1/balances', (c) => handleGetBalances(c, logger));

app.get('/v1/jobs/:id', (c) => {
  const j = getJob(c.req.param('id'));
  if (!j) return c.json({ error: 'not found' }, 404);
  return c.json(serializeRelayerJob(j));
});

// Record current EVM block so watchers only process events from this session forward.
{
  const rpc = process.env.RELAYER_EVM_RPC_URL ?? 'http://127.0.0.1:8545';
  const { createPublicClient: cpc, http: httpT } = await import('viem');
  const { foundry: f } = await import('viem/chains');
  const { setEvmStartBlock } = await import('./store.js');
  try {
    const pub = cpc({ chain: f, transport: httpT(rpc) });
    const tip = await pub.getBlockNumber();
    setEvmStartBlock(tip);
    logger.info({ evmStartBlock: tip.toString() }, 'watchers will only process events from this block onward');
  } catch (e) {
    logger.warn({ err: e }, 'could not fetch EVM block number for watcher start — watchers will scan from block 0');
  }
}

// EVM + Cardano watchers (SRS still allows HTTP POST anchors; pool watcher is optional).
if (process.env.RELAYER_EVM_LOCK_WATCHER_ENABLED === 'true' || process.env.RELAYER_EVM_LOCK_WATCHER_ENABLED === '1') {
  void runEvmLockWatcher(logger);
} else {
  logger.info(
    'evmLockWatcher disabled (set RELAYER_EVM_LOCK_WATCHER_ENABLED=true only for bridge-recipient pool locks; HTTP CLI/UI mints must not race watcher dedupe)',
  );
}
void runEvmBurnWatcher(logger);
void runCardanoLockWatcher(logger);

/** HTTP must come up immediately; `findDeployedContract` can take many minutes — never block `serve()` on it. */
serve({ fetch: app.fetch, port });
logger.info({ port }, 'zk-stables-relayer listening');

if (isMidnightRelayerInitEnabled()) {
  void warmupMidnightRelayer(logger)
    .then((h) => {
      if (h) logger.info({ contract: h.contractAddress }, 'Midnight relayer ready');
      else
        logger.warn(
          'Midnight relayer did not initialize (check RELAYER_MIDNIGHT_ENABLED or operator-console Midnight flags, BIP39_MNEMONIC / contract address / deploy flag)',
        );
    })
    .catch((e) => logger.error({ err: e }, 'Midnight relayer warmup failed'));
}
