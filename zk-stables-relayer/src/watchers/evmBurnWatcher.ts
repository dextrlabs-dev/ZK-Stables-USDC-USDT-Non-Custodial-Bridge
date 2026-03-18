import type { Logger } from 'pino';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { foundry } from 'viem/chains';
import type { Address, Hex } from 'viem';
import { mergeRelayerBridgeIntoConnected } from '../config/bridgeRecipients.js';
import { enqueueLockIntent } from '../pipeline/runJob.js';

const burnedEvent = parseAbiItem(
  'event Burned(address indexed from,address indexed recipientOnSource,uint256 amount,bytes32 nonce,bytes32 burnCommitment)',
);

type WrappedPair = { address: Address; asset: 'USDC' | 'USDT' };

/** Prefer `RELAYER_EVM_WRAPPED_TOKEN_USDC` / `_USDT` when both zk tokens are deployed; else legacy single `RELAYER_EVM_WRAPPED_TOKEN`. */
function wrappedTokensForBurnWatcher(): WrappedPair[] {
  const usdc = process.env.RELAYER_EVM_WRAPPED_TOKEN_USDC as Address | undefined;
  const usdt = process.env.RELAYER_EVM_WRAPPED_TOKEN_USDT as Address | undefined;
  const legacy = process.env.RELAYER_EVM_WRAPPED_TOKEN as Address | undefined;
  const out: WrappedPair[] = [];
  if (usdc) out.push({ address: usdc, asset: 'USDC' });
  if (usdt) out.push({ address: usdt, asset: 'USDT' });
  if (out.length === 0 && legacy) {
    const burnAsset = (process.env.RELAYER_EVM_BURN_ASSET ?? 'USDC').toUpperCase();
    out.push({ address: legacy, asset: burnAsset === 'USDT' ? 'USDT' : 'USDC' });
  }
  return out;
}

export async function runEvmBurnWatcher(logger: Logger): Promise<void> {
  const rpcUrl = process.env.RELAYER_EVM_RPC_URL ?? 'http://127.0.0.1:8545';
  const pairs = wrappedTokensForBurnWatcher();
  if (pairs.length === 0) {
    logger.info(
      'evmBurnWatcher skipped (set RELAYER_EVM_WRAPPED_TOKEN or RELAYER_EVM_WRAPPED_TOKEN_USDC / RELAYER_EVM_WRAPPED_TOKEN_USDT)',
    );
    return;
  }

  const pollMs = Number(process.env.RELAYER_EVM_POLL_MS ?? 2000);
  const confirmations = BigInt(process.env.RELAYER_EVM_CONFIRMATIONS ?? 0);
  let cursor = BigInt(process.env.RELAYER_EVM_BURN_FROM_BLOCK ?? 0);

  const client = createPublicClient({ chain: foundry, transport: http(rpcUrl) });

  for (;;) {
    try {
      const tip = await client.getBlockNumber();
      const safeTo = tip > confirmations ? tip - confirmations : 0n;
      if (safeTo >= cursor) {
        for (const { address: wrapped, asset } of pairs) {
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
            const isUsdt = asset === 'USDT';
            const intent = {
              operation: 'BURN' as const,
              sourceChain: 'evm' as const,
              destinationChain: 'evm',
              asset,
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
        }
        cursor = safeTo + 1n;
      }
    } catch (err) {
      logger.warn({ err }, 'evmBurnWatcher error');
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

