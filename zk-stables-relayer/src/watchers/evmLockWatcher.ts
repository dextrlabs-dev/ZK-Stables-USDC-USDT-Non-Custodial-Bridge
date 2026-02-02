import type { Logger } from 'pino';
import type { Address } from 'viem';
import { fetchLockEvents } from '../adapters/evmLocks.js';
import { enqueueLockIntent } from '../pipeline/runJob.js';

/**
 * Phase 2: ingest real EVM Lock events and enqueue lock intents.
 *
 * This is a simple poller (Anvil-friendly). Production will use websockets,
 * durable cursors, and reorg handling.
 */
export async function runEvmLockWatcher(logger: Logger): Promise<void> {
  const rpcUrl = process.env.RELAYER_EVM_RPC_URL ?? 'http://127.0.0.1:8545';
  const pool = process.env.RELAYER_EVM_LOCK_ADDRESS as Address | undefined;
  if (!pool) {
    logger.info('evmLockWatcher skipped (RELAYER_EVM_LOCK_ADDRESS not set)');
    return;
  }

  const pollMs = Number(process.env.RELAYER_EVM_POLL_MS ?? 2000);
  const confirmations = BigInt(process.env.RELAYER_EVM_CONFIRMATIONS ?? 1);

  let cursor = BigInt(process.env.RELAYER_EVM_FROM_BLOCK ?? 0);

  for (;;) {
    try {
      const latest = await (await fetch(`${rpcUrl}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      })).json();
      const tip = BigInt(latest.result);
      const safeTo = tip > confirmations ? tip - confirmations : 0n;
      if (safeTo >= cursor) {
        const events = await fetchLockEvents({ rpcUrl, poolLockAddress: pool, fromBlock: cursor, toBlock: safeTo });
        for (const e of events) {
          const job = await enqueueLockIntent(logger, {
            operation: 'LOCK',
            sourceChain: 'evm',
            destinationChain: 'evm',
            asset: 'USDC',
            assetKind: 0,
            amount: e.amount.toString(),
            recipient: e.recipient,
            source: {
              evm: {
                txHash: e.txHash,
                logIndex: e.logIndex,
                blockNumber: e.blockNumber.toString(),
                poolLockAddress: pool,
                token: e.token,
                nonce: e.nonce,
              },
            },
            note: 'ingested from EVM Locked event',
          });
          if (!job) continue;
        }
        cursor = safeTo + 1n;
      }
    } catch (err) {
      logger.warn({ err }, 'evmLockWatcher error');
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

