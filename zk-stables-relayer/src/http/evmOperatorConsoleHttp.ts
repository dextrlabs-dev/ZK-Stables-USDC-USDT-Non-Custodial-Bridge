import type { Context } from 'hono';
import type { Logger } from 'pino';
import { isAddress, type Address } from 'viem';
import { validateCardanoBurnIntentLockDatum } from '../adapters/cardanoAiken/validateCardanoBurnIntent.js';
import {
  isRelayerEvmOperatorConsoleTxEnabled,
  relayerEvmExecutePoolLock,
  relayerEvmExecuteWrappedBurn,
} from '../adapters/evmOperatorConsoleTx.js';
import { validateAndNormalizeEvmLockSource } from '../config/evmLockIntentValidation.js';
import {
  effectiveBurnRecipient,
  effectiveLockRecipient,
  mergeRelayerBridgeIntoConnected,
} from '../config/bridgeRecipients.js';
import { ensureCardanoBridgeWallet } from '../adapters/cardanoPayout.js';
import { serializeRelayerJob } from '../jobSerialization.js';
import { enqueueLockIntent } from '../pipeline/runJob.js';
import type { BurnIntent, LockIntent } from '../types.js';

type Dest = 'cardano' | 'midnight' | 'evm';

function assetKindN(asset: 'USDC' | 'USDT'): number {
  return asset === 'USDT' ? 1 : 0;
}

function normalizeBurnIntentBody(body: BurnIntent): void {
  const a = body.amount;
  body.amount =
    typeof a === 'number' && Number.isFinite(a)
      ? String(a)
      : String(a ?? '').trim();
}

export async function handlePostEvmExecuteLock(c: Context, logger: Logger) {
  if (!isRelayerEvmOperatorConsoleTxEnabled()) {
    return c.json(
      {
        error:
          'Operator EVM txs disabled. Set RELAYER_OPERATOR_CONSOLE_EVM_TX=1 (or true) and RELAYER_EVM_PRIVATE_KEY + RELAYER_EVM_LOCK_ADDRESS + underlying token envs.',
      },
      503,
    );
  }
  type Body = {
    asset?: string;
    amount?: string;
    destinationChain?: string;
    recipientIntent?: string;
  };
  let body: Body;
  try {
    body = (await c.req.json()) as Body;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const assetRaw = String(body.asset ?? 'USDC').trim().toUpperCase();
  if (assetRaw !== 'USDC' && assetRaw !== 'USDT') {
    return c.json({ error: 'asset must be USDC or USDT' }, 400);
  }
  const asset = assetRaw as 'USDC' | 'USDT';
  const amount = String(body.amount ?? '').trim();
  if (!amount) return c.json({ error: 'amount required (decimal string)' }, 400);
  const destRaw = String(body.destinationChain ?? 'cardano').trim().toLowerCase();
  if (destRaw !== 'cardano' && destRaw !== 'midnight' && destRaw !== 'evm') {
    return c.json({ error: 'destinationChain must be cardano, midnight, or evm' }, 400);
  }
  const destination = destRaw as Dest;
  const recipientIntent = String(body.recipientIntent ?? '').trim();
  if (!recipientIntent) {
    return c.json({ error: 'recipientIntent required (destination payout: bech32 / Midnight / 0x per destinationChain)' }, 400);
  }

  try {
    const out = await relayerEvmExecutePoolLock({ asset, amountHuman: amount, destination, recipientIntent });
    logger.info({ lockTxHash: out.lockTxHash, asset, amount }, 'POST /v1/evm/execute-lock: pool lock submitted');
    return c.json({
      asset,
      amount,
      destinationChain: destination,
      ...out,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e }, 'POST /v1/evm/execute-lock failed');
    return c.json({ error: msg }, 400);
  }
}

export async function handlePostEvmExecuteBurn(c: Context, logger: Logger) {
  if (!isRelayerEvmOperatorConsoleTxEnabled()) {
    return c.json(
      {
        error:
          'Operator EVM txs disabled. Set RELAYER_OPERATOR_CONSOLE_EVM_TX=1 (or true) and RELAYER_EVM_PRIVATE_KEY + RELAYER_EVM_LOCK_ADDRESS + wrapped token envs.',
      },
      503,
    );
  }
  type Body = {
    asset?: string;
    amount?: string;
    evmPayout?: string;
    burnCommitmentHex?: string;
  };
  let body: Body;
  try {
    body = (await c.req.json()) as Body;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const assetRaw = String(body.asset ?? 'USDC').trim().toUpperCase();
  if (assetRaw !== 'USDC' && assetRaw !== 'USDT') {
    return c.json({ error: 'asset must be USDC or USDT' }, 400);
  }
  const asset = assetRaw as 'USDC' | 'USDT';
  const amount = String(body.amount ?? '').trim();
  if (!amount) return c.json({ error: 'amount required (decimal string)' }, 400);
  const payout = String(body.evmPayout ?? '').trim();
  if (!isAddress(payout)) {
    return c.json({ error: 'evmPayout must be a 0x + 40 hex EVM address (recipientOnSource for burn)' }, 400);
  }

  try {
    const out = await relayerEvmExecuteWrappedBurn({
      asset,
      amountHuman: amount,
      payoutAddress: payout as Address,
      burnCommitmentHex: body.burnCommitmentHex?.trim(),
    });
    logger.info({ burnTxHash: out.burnTxHash, asset, amount }, 'POST /v1/evm/execute-burn: wrapped burn submitted');
    return c.json({
      asset,
      amount,
      evmPayout: payout,
      ...out,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e }, 'POST /v1/evm/execute-burn failed');
    return c.json({ error: msg }, 400);
  }
}

/** Pool lock + enqueue LOCK intent (operator console single round-trip). */
export async function handlePostEvmOperatorMint(c: Context, logger: Logger) {
  if (!isRelayerEvmOperatorConsoleTxEnabled()) {
    return c.json(
      {
        error:
          'Operator EVM txs disabled. Set RELAYER_OPERATOR_CONSOLE_EVM_TX=1 (or true) and RELAYER_EVM_PRIVATE_KEY + RELAYER_EVM_LOCK_ADDRESS + underlying token envs.',
      },
      503,
    );
  }
  type Body = {
    asset?: string;
    amount?: string;
    destinationChain?: string;
    recipientIntent?: string;
  };
  let bodyIn: Body;
  try {
    bodyIn = (await c.req.json()) as Body;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const assetRaw = String(bodyIn.asset ?? 'USDC').trim().toUpperCase();
  if (assetRaw !== 'USDC' && assetRaw !== 'USDT') {
    return c.json({ error: 'asset must be USDC or USDT' }, 400);
  }
  const asset = assetRaw as 'USDC' | 'USDT';
  const amount = String(bodyIn.amount ?? '').trim();
  if (!amount) return c.json({ error: 'amount required (decimal string)' }, 400);
  const destRaw = String(bodyIn.destinationChain ?? 'cardano').trim().toLowerCase();
  if (destRaw !== 'cardano' && destRaw !== 'midnight' && destRaw !== 'evm') {
    return c.json({ error: 'destinationChain must be cardano, midnight, or evm' }, 400);
  }
  const destination = destRaw as Dest;
  let recipientIntent = String(bodyIn.recipientIntent ?? '').trim();
  if (!recipientIntent) {
    return c.json({ error: 'recipientIntent required (destination payout: bech32 / Midnight / 0x per destinationChain)' }, 400);
  }

  if (destination === 'cardano') {
    try {
      const ctx = await ensureCardanoBridgeWallet(logger);
      if (ctx) {
        const walletAddr = ctx.wallet.getChangeAddress()?.trim();
        if (walletAddr && walletAddr.startsWith('addr')) {
          recipientIntent = walletAddr;
          logger.info({ walletAddr }, 'POST /v1/evm/operator/mint: Cardano dest — using wallet change address so tokens are burneable for redeem');
        }
      }
    } catch { /* fall through to original recipient */ }
  }

  try {
    const exec = await relayerEvmExecutePoolLock({ asset, amountHuman: amount, destination, recipientIntent });
    const lk = exec.locked;
    const asAddr = (x: string): `0x${string}` | undefined => {
      const t = x.trim();
      if (!t) return undefined;
      const h = (t.startsWith('0x') ? t : `0x${t}`) as `0x${string}`;
      const lc = h.toLowerCase() as `0x${string}`;
      if (/^0x[0-9a-f]{64}$/u.test(lc)) return lc;
      if (/^0x[0-9a-f]{40}$/u.test(lc)) return lc;
      return undefined;
    };
    const nonceRaw = lk.nonce?.trim() ?? '';
    const nonceHex =
      nonceRaw.startsWith('0x') && nonceRaw.length === 66
        ? (nonceRaw.toLowerCase() as `0x${string}`)
        : nonceRaw.length === 64 && /^[0-9a-fA-F]+$/u.test(nonceRaw)
          ? (`0x${nonceRaw.toLowerCase()}` as `0x${string}`)
          : undefined;
    const th = (lk.txHash.startsWith('0x') ? lk.txHash : `0x${lk.txHash}`).toLowerCase() as `0x${string}`;
    const lockIntent: LockIntent = {
      operation: 'LOCK',
      sourceChain: 'evm',
      destinationChain: destination,
      asset,
      assetKind: assetKindN(asset),
      amount: amount.trim(),
      recipient: recipientIntent,
      note: 'LOCK via POST /v1/evm/operator/mint',
      source: {
        evm: {
          txHash: th,
          logIndex: lk.logIndex,
          blockNumber: lk.blockNumber.trim(),
          ...(asAddr(lk.poolLockAddress) ? { poolLockAddress: asAddr(lk.poolLockAddress)! } : {}),
          ...(asAddr(lk.token) ? { token: asAddr(lk.token)! } : {}),
          ...(nonceHex && nonceHex.length === 66 ? { nonce: nonceHex } : {}),
        },
      },
    };
    mergeRelayerBridgeIntoConnected(lockIntent);
    const recipient = effectiveLockRecipient(lockIntent);
    if (!recipient) {
      return c.json(
        {
          error:
            'recipient required (or set RELAYER_BRIDGE_EVM_RECIPIENT / RELAYER_BRIDGE_CARDANO_RECIPIENT for LOCK when sourceChain is midnight)',
        },
        400,
      );
    }
    lockIntent.recipient = recipient;
    const lockErr = validateAndNormalizeEvmLockSource(lockIntent);
    if (lockErr) return c.json({ error: lockErr }, 400);

    const job = await enqueueLockIntent(logger, lockIntent);
    if (!job) {
      return c.json({ error: 'duplicate or skipped', approveTxHash: exec.approveTxHash, lockTxHash: exec.lockTxHash }, 409);
    }
    logger.info({ jobId: job.id, asset, amount }, 'POST /v1/evm/operator/mint: lock + job enqueued');
    return c.json(
      {
        jobId: job.id,
        job: serializeRelayerJob(job),
        approveTxHash: exec.approveTxHash,
        lockTxHash: exec.lockTxHash,
        locked: lk,
      },
      202,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e }, 'POST /v1/evm/operator/mint failed');
    return c.json({ error: msg }, 400);
  }
}

/** Wrapped burn + enqueue BURN intent (operator console single round-trip). */
export async function handlePostEvmOperatorRedeemToEvm(c: Context, logger: Logger) {
  if (!isRelayerEvmOperatorConsoleTxEnabled()) {
    return c.json(
      {
        error:
          'Operator EVM txs disabled. Set RELAYER_OPERATOR_CONSOLE_EVM_TX=1 (or true) and RELAYER_EVM_PRIVATE_KEY + RELAYER_EVM_LOCK_ADDRESS + wrapped token envs.',
      },
      503,
    );
  }
  type Body = {
    asset?: string;
    amount?: string;
    evmPayout?: string;
    burnCommitmentHex?: string;
  };
  let bodyIn: Body;
  try {
    bodyIn = (await c.req.json()) as Body;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const assetRaw = String(bodyIn.asset ?? 'USDC').trim().toUpperCase();
  if (assetRaw !== 'USDC' && assetRaw !== 'USDT') {
    return c.json({ error: 'asset must be USDC or USDT' }, 400);
  }
  const asset = assetRaw as 'USDC' | 'USDT';
  const amount = String(bodyIn.amount ?? '').trim();
  if (!amount) return c.json({ error: 'amount required (decimal string)' }, 400);
  const payout = String(bodyIn.evmPayout ?? '').trim();
  if (!isAddress(payout)) {
    return c.json({ error: 'evmPayout must be a 0x + 40 hex EVM address (recipientOnSource for burn)' }, 400);
  }

  try {
    const exec = await relayerEvmExecuteWrappedBurn({
      asset,
      amountHuman: amount,
      payoutAddress: payout as Address,
      burnCommitmentHex: bodyIn.burnCommitmentHex?.trim(),
    });
    const b = exec.burned;
    const th = b.txHash.trim().toLowerCase() as `0x${string}`;
    const nonceRaw = b.nonce?.trim();
    const nonceHex =
      nonceRaw.startsWith('0x') && nonceRaw.length === 66
        ? (nonceRaw.toLowerCase() as `0x${string}`)
        : nonceRaw.length === 64 && /^[0-9a-fA-F]+$/u.test(nonceRaw)
          ? (`0x${nonceRaw.toLowerCase()}` as `0x${string}`)
          : undefined;
    const fromRaw = b.fromAddress?.trim();
    const fromHex =
      fromRaw && fromRaw.startsWith('0x') && fromRaw.length === 42
        ? (fromRaw.toLowerCase() as `0x${string}`)
        : fromRaw && /^[0-9a-fA-F]{40}$/u.test(fromRaw)
          ? (`0x${fromRaw.toLowerCase()}` as `0x${string}`)
          : undefined;
    const wrapRaw = b.wrappedTokenAddress?.trim();
    const wrapHex =
      wrapRaw && wrapRaw.startsWith('0x') && wrapRaw.length === 42
        ? (wrapRaw.toLowerCase() as `0x${string}`)
        : wrapRaw && /^[0-9a-fA-F]{40}$/u.test(wrapRaw)
          ? (`0x${wrapRaw.toLowerCase()}` as `0x${string}`)
          : undefined;

    const burnIntent: BurnIntent = {
      operation: 'BURN',
      sourceChain: 'evm',
      destinationChain: 'evm',
      asset,
      assetKind: assetKindN(asset),
      amount: amount.trim(),
      recipient: payout as `0x${string}`,
      burnCommitmentHex: exec.burnCommitmentHex.replace(/^0x/i, ''),
      note: 'BURN via POST /v1/evm/operator/redeem-to-evm',
      source: {
        evm: {
          txHash: th,
          logIndex: Number(b.logIndex),
          ...(b.blockNumber?.trim() ? { blockNumber: b.blockNumber.trim() } : {}),
          ...(wrapHex ? { wrappedTokenAddress: wrapHex } : {}),
          ...(nonceHex && nonceHex.length === 66 ? { nonce: nonceHex } : {}),
          ...(fromHex ? { fromAddress: fromHex } : {}),
        },
      },
    };
    normalizeBurnIntentBody(burnIntent);
    mergeRelayerBridgeIntoConnected(burnIntent);
    const recipient = effectiveBurnRecipient(burnIntent);
    if (!recipient) {
      return c.json({ error: 'recipient required (or set RELAYER_BRIDGE_EVM_RECIPIENT)' }, 400);
    }
    burnIntent.recipient = recipient;

    const val = await validateCardanoBurnIntentLockDatum(burnIntent, logger);
    if (!val.ok) {
      return c.json({ error: val.error }, 400);
    }

    const job = await enqueueLockIntent(logger, burnIntent);
    if (!job) {
      return c.json({ error: 'duplicate or skipped', burnTxHash: exec.burnTxHash }, 409);
    }
    logger.info({ jobId: job.id, asset, amount }, 'POST /v1/evm/operator/redeem-to-evm: burn + job enqueued');
    return c.json(
      {
        jobId: job.id,
        job: serializeRelayerJob(job),
        burnTxHash: exec.burnTxHash,
        burnCommitmentHex: exec.burnCommitmentHex,
        burned: b,
      },
      202,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e }, 'POST /v1/evm/operator/redeem-to-evm failed');
    return c.json({ error: msg }, 400);
  }
}
