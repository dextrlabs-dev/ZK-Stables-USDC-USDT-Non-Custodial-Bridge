import type { Logger } from 'pino';
import type { Context } from 'hono';
import type { Address, Hex } from 'viem';
import { fetchLockEvents } from '../adapters/evmLocks.js';
import { parseDecimalAmountToUnits } from '../adapters/amount.js';
import { resolveUnderlyingTokenForAsset } from '../adapters/evmUnderlying.js';
import { relayerBridgeEvmRecipient } from '../config/bridgeRecipients.js';

export type EvmResolvedLock = {
  txHash: Hex;
  logIndex: number;
  blockNumber: string;
  poolLockAddress: Address;
  token: Address;
  nonce: Hex;
  recipient: Address;
  amountRaw: string;
  asset: 'USDC' | 'USDT';
};

/**
 * Find recent `Locked` logs on `RELAYER_EVM_LOCK_ADDRESS` matching human `amount` + `asset`
 * (for bridge-operator-console auto-anchor; avoids pasting tx / log / block).
 */
export async function handleEvmRecentLocks(c: Context, logger: Logger) {
  const rpcUrl = process.env.RELAYER_EVM_RPC_URL ?? 'http://127.0.0.1:8545';
  const pool = process.env.RELAYER_EVM_LOCK_ADDRESS?.trim() as Address | undefined;
  if (!pool) {
    return c.json({ error: 'RELAYER_EVM_LOCK_ADDRESS not set — cannot scan pool locks' }, 503);
  }

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

  const tokenAddr = resolveUnderlyingTokenForAsset(asset);
  if (!tokenAddr) {
    return c.json(
      {
        error:
          'Underlying token not configured — set RELAYER_EVM_UNDERLYING_TOKEN (and RELAYER_EVM_UNDERLYING_TOKEN_USDT for USDT)',
      },
      503,
    );
  }
  const wantToken = tokenAddr.toLowerCase() as Address;

  const lookback = BigInt(process.env.RELAYER_EVM_LOCK_LOOKBACK_BLOCKS ?? '8000');
  const confirmations = BigInt(process.env.RELAYER_EVM_CONFIRMATIONS ?? 1);

  const bridgeRecipientOnly = relayerBridgeEvmRecipient()?.trim().toLowerCase();

  try {
    const latestRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    });
    const latestJson = (await latestRes.json()) as { result?: string };
    const tip = BigInt(latestJson.result ?? '0');
    const safeTo = tip > confirmations ? tip - confirmations : 0n;
    const fromBlock = safeTo > lookback ? safeTo - lookback : 0n;

    const events = await fetchLockEvents({
      rpcUrl,
      poolLockAddress: pool,
      fromBlock,
      toBlock: safeTo,
    });

    const matched: EvmResolvedLock[] = [];
    for (const e of events) {
      if (e.amount !== wantUnits) continue;
      if (e.token.toLowerCase() !== wantToken) continue;
      const recLc = String(e.recipient).trim().toLowerCase();
      if (bridgeRecipientOnly && recLc !== bridgeRecipientOnly) continue;

      matched.push({
        txHash: e.txHash,
        logIndex: e.logIndex,
        blockNumber: e.blockNumber.toString(),
        poolLockAddress: pool,
        token: e.token,
        nonce: e.nonce,
        recipient: e.recipient,
        amountRaw: e.amount.toString(),
        asset,
      });
    }

    matched.sort((a, b) => {
      const bn = BigInt(b.blockNumber) - BigInt(a.blockNumber);
      if (bn !== 0n) return bn > 0n ? 1 : -1;
      return b.logIndex - a.logIndex;
    });

    const limit = Math.min(25, Math.max(1, Number(process.env.RELAYER_EVM_RECENT_LOCKS_LIMIT ?? 15)));
    const locks = matched.slice(0, limit);

    return c.json({
      rpcUrl,
      poolLockAddress: pool,
      scanned: { fromBlock: fromBlock.toString(), toBlock: safeTo.toString() },
      want: { asset, amount: amountStr, amountRaw: wantUnits.toString(), token: wantToken },
      count: locks.length,
      locks,
    });
  } catch (e) {
    logger.warn({ err: e }, 'GET /v1/evm/recent-locks failed');
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
