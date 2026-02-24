import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import pino from 'pino';
import type { BurnIntent, LockIntent } from './types.js';
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
import { isMidnightBridgeEnabled, warmupMidnightRelayer } from './midnight/service.js';
import { assertRelayerStartupConfig } from './config/srsCompliance.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
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
    relayerBridge: relayerBridgeSnapshot().configured,
  });
});

app.get('/v1/bridge/recipients', (c) => c.json(relayerBridgeSnapshot()));

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
  mergeRelayerBridgeIntoConnected(body);
  const recipient = effectiveBurnRecipient(body);
  if (!recipient) {
    return c.json(
      {
        error:
          'recipient required (or set RELAYER_BRIDGE_EVM_RECIPIENT for BURN from evm, RELAYER_BRIDGE_CARDANO_RECIPIENT from cardano, or either for BURN from midnight)',
      },
      400,
    );
  }
  body.recipient = recipient;
  const bc = body.burnCommitmentHex?.replace(/^0x/i, '') ?? '';
  if (bc.length !== 64 || !/^[0-9a-fA-F]+$/.test(bc)) {
    return c.json({ error: 'burnCommitmentHex required: 64 hex chars (32-byte Midnight burn binding)' }, 400);
  }

  const job = await enqueueLockIntent(logger, body);
  if (!job) return c.json({ error: 'duplicate or skipped' }, 409);
  return c.json({ jobId: job.id, job: serializeRelayerJob(job) }, 202);
});

app.get('/v1/jobs', (c) => c.json({ jobs: listJobs().map(serializeRelayerJob) }));

app.get('/v1/jobs/:id', (c) => {
  const j = getJob(c.req.param('id'));
  if (!j) return c.json({ error: 'not found' }, 404);
  return c.json(serializeRelayerJob(j));
});

logger.info({ port }, 'zk-stables-relayer listening');

if (isMidnightBridgeEnabled()) {
  void warmupMidnightRelayer(logger)
    .then((h) => {
      if (h) logger.info({ contract: h.contractAddress }, 'Midnight relayer ready');
      else logger.warn('RELAYER_MIDNIGHT_ENABLED but Midnight relayer did not initialize (check BIP39_MNEMONIC / contract address / deploy flag)');
    })
    .catch((e) => logger.error({ err: e }, 'Midnight relayer warmup failed'));
}

// EVM + Cardano watchers (required when RELAYER_SRS_STRICT — env must list addresses/tokens; see docs/SRS_RELAYER_REQUIREMENTS.md).
void runEvmLockWatcher(logger);
void runEvmBurnWatcher(logger);
void runCardanoLockWatcher(logger);

serve({ fetch: app.fetch, port });
