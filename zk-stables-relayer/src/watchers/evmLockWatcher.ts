import type { Logger } from 'pino';
import type { Address } from 'viem';
import { fetchLockEvents } from '../adapters/evmLocks.js';
import { mergeRelayerBridgeIntoConnected, relayerBridgeEvmRecipient } from '../config/bridgeRecipients.js';
import { enqueueLockIntent } from '../pipeline/runJob.js';

/** Map pool-locked ERC20 to USDC vs USDT using the same env vars as the burn watcher / unlock paths. */
function assetFromLockedToken(token: Address, logger: Logger): { asset: 'USDC' | 'USDT'; assetKind: number } {
  const t = token.toLowerCase();
  const usdt = (process.env.RELAYER_EVM_UNDERLYING_TOKEN_USDT ?? '').trim().toLowerCase();
  const usdcExplicit = (process.env.RELAYER_EVM_UNDERLYING_TOKEN_USDC ?? '').trim().toLowerCase();
  const usdcLegacy = (process.env.RELAYER_EVM_UNDERLYING_TOKEN ?? '').trim().toLowerCase();
  const usdc = usdcExplicit || usdcLegacy;
  if (usdt && t === usdt) return { asset: 'USDT', assetKind: 1 };
  if (usdc && t === usdc) return { asset: 'USDC', assetKind: 0 };
  logger.warn(
    { token },
    'evmLockWatcher: locked token does not match RELAYER_EVM_UNDERLYING_TOKEN / _USDC / _USDT; defaulting to USDC',
  );
  return { asset: 'USDC', assetKind: 0 };
}

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
  /** Default `midnight` so EVM locks feed the Midnight mint pipeline; override e.g. `evm` for same-chain tests. */
  const destChain = (process.env.RELAYER_EVM_LOCK_DEST_CHAIN ?? 'midnight').trim() || 'midnight';
  /**
   * When `RELAYER_BRIDGE_EVM_RECIPIENT` is set, only ingest locks whose `Locked.recipient` is that address.
   * CLI / UI mints to Cardano or Midnight use the signer 0x as the pool-lock recipient while HTTP carries the
   * real bech32 / mn_addr recipient — ingesting those events here would race HTTP, reserve the dedupe key first,
   * and mis-route (wrong destinationChain, wrong asset). Bridge-operator locks should target the bridge EVM key.
   */
  const bridgeRecipientOnly = relayerBridgeEvmRecipient();
  if (bridgeRecipientOnly) {
    logger.info(
      { relayerBridgeEvmRecipient: bridgeRecipientOnly },
      'evmLockWatcher: ingesting only Locked events whose recipient matches RELAYER_BRIDGE_EVM_RECIPIENT',
    );
  } else {
    logger.warn(
      'evmLockWatcher: RELAYER_BRIDGE_EVM_RECIPIENT is unset — ingesting every pool lock (can race HTTP mint jobs that share tx+log dedupe; set RELAYER_BRIDGE_EVM_RECIPIENT to an operator 0x that is not your CLI signer)',
    );
  }

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
          const recLc = String(e.recipient).trim().toLowerCase();
          const bridgeLc = bridgeRecipientOnly ? bridgeRecipientOnly.trim().toLowerCase() : '';
          if (bridgeRecipientOnly && recLc !== bridgeLc) {
            logger.debug(
              { txHash: e.txHash, recipient: e.recipient },
              'evmLockWatcher skip: recipient is not RELAYER_BRIDGE_EVM_RECIPIENT (use HTTP LOCK for user wallet locks)',
            );
            continue;
          }
          const { asset, assetKind } = assetFromLockedToken(e.token, logger);
          const intent = {
            operation: 'LOCK' as const,
            sourceChain: 'evm' as const,
            destinationChain: destChain,
            asset,
            assetKind,
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
          };
          mergeRelayerBridgeIntoConnected(intent);
          const job = await enqueueLockIntent(logger, intent);
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

