import { createHash, randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import type { Logger } from 'pino';
import { isAddress } from 'viem';
import { isRelayerCardanoOperatorConsoleTxEnabled } from '../adapters/cardanoOperatorConsoleTx.js';
import { lockMintThenBridgeRelease } from '../adapters/cardanoAiken/lockPoolBridge.js';
import { cardanoBurnNativeFromOperator } from '../adapters/cardanoMintPayout.js';
import { parseDecimalAmountToUnits } from '../adapters/amount.js';
import { mergeRelayerBridgeIntoConnected, relayerBridgeCardanoRecipient, relayerBridgeEvmRecipient } from '../config/bridgeRecipients.js';
import { enqueueLockIntent } from '../pipeline/runJob.js';
import { serializeRelayerJob } from '../jobSerialization.js';
import type { BurnIntent } from '../types.js';

function assetKindN(asset: 'USDC' | 'USDT'): number {
  return asset === 'USDT' ? 1 : 0;
}

function cardanoRecipientCommitmentHexForConsole(amountStr: string, asset: string): string {
  const env = process.env.RELAYER_CARDANO_RECIPIENT_COMMITMENT_HEX?.trim();
  if (env && /^[0-9a-fA-F]{64}$/u.test(env)) return env.toLowerCase();
  return createHash('sha256').update(`operator-console-cardano-mint:${asset}:${amountStr}`, 'utf8').digest('hex');
}

export async function handlePostCardanoOperatorMint(c: Context, logger: Logger) {
  if (!isRelayerCardanoOperatorConsoleTxEnabled()) {
    return c.json(
      {
        error:
          'Operator Cardano txs disabled. Set RELAYER_OPERATOR_CONSOLE_CARDANO_TX=1 (or RELAYER_OPERATOR_CONSOLE_ALL) with RELAYER_CARDANO_WALLET_MNEMONIC + Cardano indexer (Yaci/Blockfrost).',
      },
      503,
    );
  }
  type Body = { asset?: string; amount?: string; recipientBech32?: string };
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
  const recipient = String(body.recipientBech32 ?? relayerBridgeCardanoRecipient() ?? '').trim();
  if (!recipient.startsWith('addr')) {
    return c.json(
      { error: 'recipientBech32 required (Cardano payment address) or set RELAYER_BRIDGE_CARDANO_RECIPIENT on the relayer.' },
      400,
    );
  }

  try {
    const r = await lockMintThenBridgeRelease({
      recipientBech32: recipient,
      amountStr: amount,
      asset,
      recipientCommitmentHex: cardanoRecipientCommitmentHexForConsole(amount, asset),
      logger,
    });
    logger.info({ lockTxHash: r.lockTxHash, asset, amount }, 'POST /v1/cardano/operator/mint');
    return c.json({ ok: true, asset, amount, recipient, ...r }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e }, 'POST /v1/cardano/operator/mint failed');
    return c.json({ error: msg }, 400);
  }
}

export async function handlePostCardanoOperatorRedeemToEvm(c: Context, logger: Logger) {
  if (!isRelayerCardanoOperatorConsoleTxEnabled()) {
    return c.json(
      {
        error:
          'Operator Cardano txs disabled. Set RELAYER_OPERATOR_CONSOLE_CARDANO_TX=1 (or RELAYER_OPERATOR_CONSOLE_ALL) with RELAYER_CARDANO_WALLET_MNEMONIC + indexer.',
      },
      503,
    );
  }
  type Body = { asset?: string; amount?: string; evmPayout?: string };
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
  const payoutRaw = String(body.evmPayout ?? relayerBridgeEvmRecipient() ?? '').trim();
  if (!isAddress(payoutRaw)) {
    return c.json({ error: 'evmPayout must be a 0x + 40 hex EVM address (or set RELAYER_BRIDGE_EVM_RECIPIENT)' }, 400);
  }
  const payout = payoutRaw as `0x${string}`;

  try {
    const assetDecimals = Number(process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);
    const burnQty = parseDecimalAmountToUnits(amount, assetDecimals);
    if (burnQty <= 0n) {
      return c.json({ error: 'amount must be positive' }, 400);
    }

    let burnTxHash: string | null = null;
    let burnPolicyId: string | undefined;
    try {
      logger.info({ asset, amount, burnQty: burnQty.toString() }, 'POST /v1/cardano/operator/redeem-to-evm: burning native tokens');
      const burn = await cardanoBurnNativeFromOperator({ asset, quantity: burnQty, logger });
      burnTxHash = burn.txHash;
      burnPolicyId = burn.policyId;
    } catch (burnErr) {
      const msg = burnErr instanceof Error ? burnErr.message : String(burnErr);
      const isInsufficient = /insufficient|coins in inputs.*0/i.test(msg);
      if (!isInsufficient) throw burnErr;
      logger.warn(
        { asset, amount, err: msg },
        'POST /v1/cardano/operator/redeem-to-evm: wallet has no native tokens to burn (tokens may be at recipient address) — proceeding to enqueue BURN job for EVM unlock',
      );
    }

    const nonce = randomBytes(16).toString('hex');
    const burnCommHex = createHash('sha256')
      .update(`operator-console-cardano-burn:${asset}:${amount}:${burnTxHash ?? nonce}:${nonce}`, 'utf8')
      .digest('hex');

    const spendRef = burnTxHash ?? createHash('sha256').update(`operator-burn:${nonce}:${Date.now()}`, 'utf8').digest('hex');

    const burnIntent: BurnIntent = {
      operation: 'BURN',
      sourceChain: 'cardano',
      destinationChain: 'evm',
      asset,
      assetKind: assetKindN(asset),
      amount: amount.trim(),
      recipient: payout,
      burnCommitmentHex: burnCommHex,
      note: burnTxHash
        ? 'BURN via POST /v1/cardano/operator/redeem-to-evm (native tokens burned by operator)'
        : 'BURN via POST /v1/cardano/operator/redeem-to-evm (operator attestation — native burn skipped, tokens at recipient)',
      source: {
        cardano: {
          txHash: spendRef,
          outputIndex: 0,
          spendTxHash: spendRef,
          ...(burnPolicyId ? { policyIdHex: burnPolicyId } : {}),
        },
      },
    };
    mergeRelayerBridgeIntoConnected(burnIntent);

    const job = await enqueueLockIntent(logger, burnIntent);
    if (!job) {
      return c.json({ error: 'duplicate or skipped', burnTxHash }, 409);
    }
    logger.info(
      { jobId: job.id, asset, amount, burnTxHash, nativeBurned: Boolean(burnTxHash) },
      'POST /v1/cardano/operator/redeem-to-evm: BURN job enqueued',
    );
    return c.json({ jobId: job.id, job: serializeRelayerJob(job), burnTxHash, nativeBurned: Boolean(burnTxHash) }, 202);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e }, 'POST /v1/cardano/operator/redeem-to-evm failed');
    return c.json({ error: msg }, 400);
  }
}
