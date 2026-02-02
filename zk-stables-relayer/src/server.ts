import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import pino from 'pino';
import type { BurnIntent, LockIntent } from './types.js';
import { enqueueLockIntent } from './pipeline/runJob.js';
import { getJob, listJobs } from './store.js';
import { evmRpcOk, midnightIndexerPing } from './adapters/chainHealth.js';
import { blockfrostLatestBlock } from './adapters/cardanoBlockfrost.js';
import { runEvmLockWatcher } from './watchers/evmLockWatcher.js';
import { runCardanoLockWatcher } from './watchers/cardanoLockWatcher.js';
import { runEvmBurnWatcher } from './watchers/evmBurnWatcher.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const port = Number(process.env.RELAYER_PORT ?? 8787);

const app = new Hono();

app.use('/*', cors({ origin: '*' }));

app.get('/health', (c) => c.json({ ok: true, service: 'zk-stables-relayer' }));

app.get('/v1/health/chains', async (c) => {
  /** Default: Foundry Anvil / local dev node (see `scripts/anvil-docker.sh`). */
  const evm = process.env.RELAYER_EVM_RPC_URL ?? 'http://127.0.0.1:8545';
  const indexer = process.env.RELAYER_MIDNIGHT_INDEXER_URL ?? 'http://127.0.0.1:8088/api/v1/graphql';
  const bfId = process.env.RELAYER_BLOCKFROST_PROJECT_ID ?? process.env.BLOCKFROST_PROJECT_ID;
  const bfNet = (process.env.RELAYER_BLOCKFROST_NETWORK ?? 'preprod') as 'preprod' | 'mainnet';

  const [evmH, mid, cardanoBf] = await Promise.all([
    evmRpcOk(evm),
    midnightIndexerPing(indexer),
    bfId ? blockfrostLatestBlock(bfId, bfNet) : Promise.resolve(null),
  ]);

  const evmSerialized =
    evmH.ok && evmH.blockNumber !== undefined
      ? { ...evmH, blockNumber: evmH.blockNumber.toString() }
      : evmH;

  const cardano = bfId
    ? {
        provider: 'blockfrost',
        ...cardanoBf!,
        projectIdPreview: `${bfId.slice(0, 8)}…`,
      }
    : {
        skipped: true,
        note:
          'Set RELAYER_BLOCKFROST_PROJECT_ID (Preprod/Mainnet project id) for Cardano health. Never commit API keys.',
      };

  return c.json({
    evm: { rpcUrl: evm, ...evmSerialized },
    midnightIndexer: { url: indexer, ...mid },
    cardano,
  });
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
  if (!body.recipient?.trim()) return c.json({ error: 'recipient required' }, 400);

  const job = await enqueueLockIntent(logger, body);
  if (!job) return c.json({ error: 'duplicate or skipped' }, 409);
  return c.json({ jobId: job.id, job }, 202);
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
  if (!body.recipient?.trim()) return c.json({ error: 'recipient required' }, 400);

  const job = await enqueueLockIntent(logger, body);
  if (!job) return c.json({ error: 'duplicate or skipped' }, 409);
  return c.json({ jobId: job.id, job }, 202);
});

app.get('/v1/jobs', (c) => c.json({ jobs: listJobs() }));

app.get('/v1/jobs/:id', (c) => {
  const j = getJob(c.req.param('id'));
  if (!j) return c.json({ error: 'not found' }, 404);
  return c.json(j);
});

logger.info({ port }, 'zk-stables-relayer listening');

// Phase 2: optional watcher (polls when configured).
void runEvmLockWatcher(logger);
void runEvmBurnWatcher(logger);
// Phase 3: optional scaffold watcher (disabled by default).
void runCardanoLockWatcher(logger);

serve({ fetch: app.fetch, port });
