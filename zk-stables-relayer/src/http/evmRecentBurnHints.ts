import type { Context } from 'hono';
import type { Logger } from 'pino';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { foundry } from 'viem/chains';
import type { Address, Hex } from 'viem';
import { parseDecimalAmountToUnits, formatTokenUnitsToDecimal } from '../adapters/amount.js';
import type { BurnIntent } from '../types.js';

const burnedEvent = parseAbiItem(
  'event Burned(address indexed from,address indexed recipientOnSource,uint256 amount,bytes32 nonce,bytes32 burnCommitment)',
);

type WrappedPair = { address: Address; asset: 'USDC' | 'USDT' };

function wrappedTokensForScan(): WrappedPair[] {
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

type EvmBurnHintRow = {
  jobId: string;
  asset: 'USDC' | 'USDT';
  amount: string;
  recipient: string;
  burnCommitmentHex: string;
  evm: NonNullable<BurnIntent['source']>['evm'];
  createdAt: string;
  phase: string;
};

/**
 * Scan `Burned` logs on wrapped zk tokens for `amount` + `asset` (operator console auto-anchor for EVM→EVM BURN).
 */
export async function handleEvmRecentBurnHints(c: Context, logger: Logger) {
  const rpcUrl = process.env.RELAYER_EVM_RPC_URL ?? 'http://127.0.0.1:8545';
  const pairs = wrappedTokensForScan();

  const assetRaw = (c.req.query('asset') ?? 'USDC').trim().toUpperCase();
  if (assetRaw !== 'USDC' && assetRaw !== 'USDT') {
    return c.json({ error: 'asset must be USDC or USDT' }, 400);
  }
  const asset = assetRaw as 'USDC' | 'USDT';

  const amountStr = (c.req.query('amount') ?? '').trim();
  if (!amountStr) {
    return c.json({ error: 'amount query required (decimal, e.g. 0.05)' }, 400);
  }

  const decimals = Number(process.env.RELAYER_EVM_TOKEN_DECIMALS ?? process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);
  let wantUnits: bigint;
  try {
    wantUnits = parseDecimalAmountToUnits(amountStr, decimals);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'invalid amount' }, 400);
  }

  if (pairs.length === 0) {
    return c.json({
      hints: [] as EvmBurnHintRow[],
      count: 0,
      scanNote:
        'No wrapped token addresses — set RELAYER_EVM_WRAPPED_TOKEN or RELAYER_EVM_WRAPPED_TOKEN_USDC / RELAYER_EVM_WRAPPED_TOKEN_USDT.',
    });
  }

  const lookback = BigInt(process.env.RELAYER_EVM_BURN_LOOKBACK_BLOCKS ?? process.env.RELAYER_EVM_LOCK_LOOKBACK_BLOCKS ?? '8000');
  const confirmations = BigInt(process.env.RELAYER_EVM_CONFIRMATIONS ?? 1);

  try {
    const client = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
    const tip = await client.getBlockNumber();
    const safeTo = tip > confirmations ? tip - confirmations : 0n;
    const fromBlock = safeTo > lookback ? safeTo - lookback : 0n;

    const matched: EvmBurnHintRow[] = [];
    for (const { address: wrapped, asset: a } of pairs) {
      if (a !== asset) continue;
      const logs = await client.getLogs({
        address: wrapped,
        event: burnedEvent,
        fromBlock,
        toBlock: safeTo,
      });
      for (const l of logs) {
        const amt = l.args.amount as bigint;
        if (amt !== wantUnits) continue;
        const burnC = l.args.burnCommitment as Hex;
        const burnCommitmentHex = burnC.replace(/^0x/i, '').toLowerCase();
        if (burnCommitmentHex.length !== 64) continue;
        matched.push({
          jobId: `chain:${l.transactionHash}:${Number(l.logIndex)}`,
          asset: a,
          amount: formatTokenUnitsToDecimal(amt, decimals),
          recipient: '',
          burnCommitmentHex,
          evm: {
            txHash: l.transactionHash as Hex,
            logIndex: Number(l.logIndex),
            blockNumber: (l.blockNumber ?? 0n).toString(),
            wrappedTokenAddress: wrapped,
            nonce: l.args.nonce as Hex,
            fromAddress: l.args.from as Address,
          },
          createdAt: new Date().toISOString(),
          phase: 'on-chain',
        });
      }
    }

    matched.sort((x, y) => {
      const ex = x.evm!;
      const ey = y.evm!;
      const bx = BigInt(ex.blockNumber ?? '0');
      const by = BigInt(ey.blockNumber ?? '0');
      if (bx !== by) return bx > by ? -1 : 1;
      return ey.logIndex - ex.logIndex;
    });

    const limit = Math.min(25, Math.max(1, Number(process.env.RELAYER_EVM_RECENT_BURN_HINTS_LIMIT ?? 15)));
    const hints = matched.slice(0, limit);

    return c.json({
      rpcUrl,
      scanned: { fromBlock: fromBlock.toString(), toBlock: safeTo.toString() },
      want: { asset, amount: amountStr, amountRaw: wantUnits.toString() },
      count: hints.length,
      hints,
    });
  } catch (e) {
    logger.warn({ err: e }, 'GET /v1/evm/recent-burn-hints failed');
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
