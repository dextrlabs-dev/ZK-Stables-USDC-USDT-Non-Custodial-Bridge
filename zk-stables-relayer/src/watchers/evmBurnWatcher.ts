import type { Logger } from 'pino';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { foundry } from 'viem/chains';
import type { Address, Hex } from 'viem';
import { mergeRelayerBridgeIntoConnected } from '../config/bridgeRecipients.js';
import { enqueueLockIntent } from '../pipeline/runJob.js';

const burnedEvent = parseAbiItem(
  'event Burned(address indexed from,address indexed recipientOnSource,uint256 amount,bytes32 nonce,bytes32 burnCommitment)',
);

export async function runEvmBurnWatcher(logger: Logger): Promise<void> {
  const rpcUrl = process.env.RELAYER_EVM_RPC_URL ?? 'http://127.0.0.1:8545';
  const wrapped = process.env.RELAYER_EVM_WRAPPED_TOKEN as Address | undefined;
  if (!wrapped) {
    logger.info('evmBurnWatcher skipped (RELAYER_EVM_WRAPPED_TOKEN not set)');
    return;
  }

  const pollMs = Number(process.env.RELAYER_EVM_POLL_MS ?? 2000);
  const confirmations = BigInt(process.env.RELAYER_EVM_CONFIRMATIONS ?? 0);
  let cursor = BigInt(process.env.RELAYER_EVM_BURN_FROM_BLOCK ?? 0);
  const burnAsset = (process.env.RELAYER_EVM_BURN_ASSET ?? 'USDC').toUpperCase();
  const isUsdt = burnAsset === 'USDT';

  const client = createPublicClient({ chain: foundry, transport: http(rpcUrl) });

  for (;;) {
    try {
      const tip = await client.getBlockNumber();
      const safeTo = tip > confirmations ? tip - confirmations : 0n;
      if (safeTo >= cursor) {
        const logs = await client.getLogs({
          address: wrapped,
          event: burnedEvent,
          fromBlock: cursor,
          toBlock: safeTo,
        });
        for (const l of logs) {
          const burnC = l.args.burnCommitment as Hex;
          const burnCommitmentHex = burnC.replace(/^0x/i, '');
          if (burnCommitmentHex.length !== 64) continue;
          const intent = {
            operation: 'BURN' as const,
            sourceChain: 'evm' as const,
            destinationChain: 'evm',
            asset: isUsdt ? ('USDT' as const) : ('USDC' as const),
            assetKind: isUsdt ? 1 : 0,
            amount: (l.args.amount as bigint).toString(),
            recipient: l.args.recipientOnSource as Address,
            burnCommitmentHex,
            source: {
              evm: {
                txHash: l.transactionHash as Hex,
                logIndex: Number(l.logIndex),
                blockNumber: (l.blockNumber ?? 0n).toString(),
                wrappedTokenAddress: wrapped,
                nonce: l.args.nonce as Hex,
                fromAddress: l.args.from as Address,
              },
            },
            note: 'ingested from EVM Burned event (mUSDC/mUSDT test wrapped token)',
          };
          mergeRelayerBridgeIntoConnected(intent);
          const job = await enqueueLockIntent(logger, intent);
          if (!job) continue;
        }
        cursor = safeTo + 1n;
      }
    } catch (err) {
      logger.warn({ err }, 'evmBurnWatcher error');
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

