import { createHash, randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import type { Logger } from 'pino';
import { isAddress } from 'viem';
import { isRelayerCardanoOperatorConsoleTxEnabled } from '../adapters/cardanoOperatorConsoleTx.js';
import { lockMintThenBridgeRelease, bridgeReleaseLockUtxo } from '../adapters/cardanoAiken/lockPoolBridge.js';
import { loadBlueprint } from '../adapters/cardanoAiken/blueprint.js';
import { getLockPoolScript } from '../adapters/cardanoAiken/scripts.js';
import { cardanoBurnNativeFromOperator } from '../adapters/cardanoMintPayout.js';
import { parseDecimalAmountToUnits } from '../adapters/amount.js';
import { mergeRelayerBridgeIntoConnected, relayerBridgeCardanoRecipient, relayerBridgeEvmRecipient } from '../config/bridgeRecipients.js';
import { ensureCardanoBridgeWallet } from '../adapters/cardanoPayout.js';
import { cardanoIndexerMode, resolveYaciBaseUrl, blockfrostProjectId, blockfrostNetwork } from '../adapters/cardanoIndexer.js';
import { yaciAddressUtxos } from '../adapters/cardanoYaci.js';
import { blockfrostAddressUtxos } from '../adapters/cardanoBlockfrost.js';
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

/**
 * Find a lock UTxO at the script whose native token unit matches and whose quantity >= wanted.
 * Returns the first match (exact preferred, then any >= wanted).
 */
async function findMatchingLockUtxo(
  scriptAddr: string,
  assetUnit: string,
  wantQty: bigint,
  logger: Logger,
): Promise<{ tx_hash: string; output_index: number; quantity: bigint } | null> {
  const mode = cardanoIndexerMode();
  const yaci = resolveYaciBaseUrl();
  const bfId = blockfrostProjectId();
  const bfNet = blockfrostNetwork();

  type RawUtxo = { tx_hash: string; output_index: number; amount: Array<{ unit: string; quantity: string }> };
  let utxos: RawUtxo[];
  try {
    utxos = mode === 'yaci' && yaci
      ? await yaciAddressUtxos(yaci, scriptAddr)
      : bfId
        ? await blockfrostAddressUtxos(bfId, bfNet, scriptAddr)
        : [];
  } catch (e) {
    logger.warn({ err: e }, 'findMatchingLockUtxo: failed to fetch script UTxOs');
    return null;
  }

  let bestExact: typeof utxos[number] | null = null;
  let bestAny: typeof utxos[number] | null = null;
  let bestAnyQty = 0n;

  for (const u of utxos) {
    const row = u.amount.find((a) => a.unit === assetUnit);
    if (!row) continue;
    const qty = BigInt(row.quantity);
    if (qty === wantQty && !bestExact) {
      bestExact = u;
    } else if (qty >= wantQty && (!bestAny || qty < bestAnyQty)) {
      bestAny = u;
      bestAnyQty = qty;
    }
  }

  const pick = bestExact ?? bestAny;
  if (!pick) return null;
  const pickRow = pick.amount.find((a) => a.unit === assetUnit)!;
  return { tx_hash: pick.tx_hash, output_index: pick.output_index, quantity: BigInt(pickRow.quantity) };
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
  let payoutRaw = String(body.evmPayout ?? '').trim();
  if (!payoutRaw) {
    const pk = process.env.RELAYER_EVM_PRIVATE_KEY?.trim();
    if (pk && /^0x[0-9a-fA-F]{64}$/u.test(pk)) {
      try {
        const { privateKeyToAccount } = await import('viem/accounts');
        payoutRaw = privateKeyToAccount(pk as `0x${string}`).address;
      } catch { /* fall through */ }
    }
  }
  if (!payoutRaw) {
    payoutRaw = relayerBridgeEvmRecipient() ?? '';
  }
  if (!isAddress(payoutRaw)) {
    return c.json({ error: 'evmPayout must be a 0x + 40 hex EVM address (or set RELAYER_EVM_PRIVATE_KEY / RELAYER_BRIDGE_EVM_RECIPIENT)' }, 400);
  }
  const payout = payoutRaw as `0x${string}`;

  try {
    const assetDecimals = Number(process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);
    const burnQty = parseDecimalAmountToUnits(amount, assetDecimals);
    if (burnQty <= 0n) {
      return c.json({ error: 'amount must be positive' }, 400);
    }

    const ctx = await ensureCardanoBridgeWallet(logger);
    if (!ctx) return c.json({ error: 'Cardano bridge wallet not configured' }, 503);
    const walletAddr = ctx.wallet.getChangeAddress();

    const networkId = Number(process.env.RELAYER_CARDANO_NETWORK_ID ?? process.env.CARDANO_NETWORK_ID ?? 0) === 1 ? 1 : 0;
    const bp = loadBlueprint();
    const { address: scriptAddr } = getLockPoolScript(bp, networkId);

    // Resolve the native token unit for this asset
    const { ForgeScript: FS, resolveScriptHash: rsh, stringToHex: s2h } = await import('@meshsdk/core');
    const { cardanoBridgeTokenName: ctn } = await import('../adapters/cardanoMintPayout.js');
    const forgingScript = FS.withOneSignature(walletAddr);
    const policyId = rsh(forgingScript);
    const tokenNameHex = s2h(ctn(asset));
    const assetUnit = `${policyId}${tokenNameHex}`;

    // Strategy 1: Find a matching lock UTxO at the script and BridgeRelease (burn mode)
    let burnTxHash: string | null = null;
    const lockUtxo = await findMatchingLockUtxo(scriptAddr, assetUnit, burnQty, logger);

    if (lockUtxo) {
      logger.info(
        { lockTx: lockUtxo.tx_hash, outputIndex: lockUtxo.output_index, lockQty: lockUtxo.quantity.toString(), wantQty: burnQty.toString() },
        'POST /v1/cardano/operator/redeem-to-evm: found lock UTxO — releasing via BridgeRelease (burn mode)',
      );
      try {
        const rel = await bridgeReleaseLockUtxo({
          lockTxHash: lockUtxo.tx_hash,
          lockOutputIndex: lockUtxo.output_index,
          payoutBech32: walletAddr,
          logger,
          releaseMode: 'burn',
        });
        burnTxHash = rel.txHash;
        logger.info({ releaseTx: rel.txHash }, 'POST /v1/cardano/operator/redeem-to-evm: lock UTxO burned via BridgeRelease');
      } catch (releaseErr) {
        const msg = releaseErr instanceof Error ? releaseErr.message : String(releaseErr);
        logger.warn({ err: msg }, 'POST /v1/cardano/operator/redeem-to-evm: BridgeRelease failed — falling back to free-standing burn');
      }
    }

    // Strategy 2: If no lock UTxO found or BridgeRelease failed, try free-standing negative mint from wallet
    if (!burnTxHash) {
      try {
        logger.info({ asset, amount, burnQty: burnQty.toString() }, 'POST /v1/cardano/operator/redeem-to-evm: burning native tokens from wallet');
        const burn = await cardanoBurnNativeFromOperator({ asset, quantity: burnQty, logger });
        burnTxHash = burn.txHash;
      } catch (burnErr) {
        const msg = burnErr instanceof Error ? burnErr.message : String(burnErr);
        const isInsufficient = /insufficient|coins in inputs.*0/i.test(msg);
        if (!isInsufficient) throw burnErr;
        logger.warn(
          { asset, amount, err: msg },
          'POST /v1/cardano/operator/redeem-to-evm: no native tokens to burn — proceeding to enqueue BURN job for EVM unlock',
        );
      }
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
        ? 'BURN via POST /v1/cardano/operator/redeem-to-evm (native tokens burned)'
        : 'BURN via POST /v1/cardano/operator/redeem-to-evm (operator attestation — native burn skipped)',
      source: {
        cardano: {
          txHash: spendRef,
          outputIndex: 0,
          spendTxHash: spendRef,
          ...(policyId ? { policyIdHex: policyId } : {}),
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

/**
 * Burn-release all stale lock UTxOs at the Cardano lock_pool script.
 * Each UTxO is spent via BridgeRelease in burn mode — the native tokens are
 * destroyed (negative mint) and only ADA is returned to the wallet.
 */
export async function handlePostCardanoOperatorSweepLocks(c: Context, logger: Logger) {
  if (!isRelayerCardanoOperatorConsoleTxEnabled()) {
    return c.json({ error: 'Operator Cardano txs disabled.' }, 503);
  }

  const ctx = await ensureCardanoBridgeWallet(logger);
  if (!ctx) return c.json({ error: 'Cardano bridge wallet not configured' }, 503);

  const walletAddr = ctx.wallet.getChangeAddress();
  if (!walletAddr?.trim()) return c.json({ error: 'MeshWallet has no change address' }, 500);

  const networkId = Number(process.env.RELAYER_CARDANO_NETWORK_ID ?? process.env.CARDANO_NETWORK_ID ?? 0) === 1 ? 1 : 0;
  const bp = loadBlueprint();
  const { address: scriptAddr } = getLockPoolScript(bp, networkId);

  const mode = cardanoIndexerMode();
  const yaci = resolveYaciBaseUrl();
  const bfId = blockfrostProjectId();
  const bfNet = blockfrostNetwork();

  type RawUtxo = { tx_hash: string; output_index: number; amount: Array<{ unit: string; quantity: string }> };
  let utxos: RawUtxo[];
  try {
    utxos = mode === 'yaci' && yaci
      ? await yaciAddressUtxos(yaci, scriptAddr)
      : bfId
        ? await blockfrostAddressUtxos(bfId, bfNet, scriptAddr)
        : [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: `Failed to fetch script UTxOs: ${msg}` }, 500);
  }

  if (utxos.length === 0) {
    return c.json({ released: 0, message: 'No lock UTxOs at script' }, 200);
  }

  const results: Array<{ txHash: string; lockTx: string; outputIndex: number; ok: boolean; error?: string }> = [];

  for (const u of utxos) {
    try {
      const r = await bridgeReleaseLockUtxo({
        lockTxHash: u.tx_hash,
        lockOutputIndex: u.output_index,
        payoutBech32: walletAddr,
        logger,
        releaseMode: 'burn',
      });
      results.push({ txHash: r.txHash, lockTx: u.tx_hash, outputIndex: u.output_index, ok: true });
      logger.info(
        { lockTx: u.tx_hash, outputIndex: u.output_index, releaseTx: r.txHash },
        'POST /v1/cardano/operator/sweep-locks: burned lock UTxO',
      );
      // Wait for the tx to propagate before processing the next one
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ txHash: '', lockTx: u.tx_hash, outputIndex: u.output_index, ok: false, error: msg });
      logger.warn(
        { lockTx: u.tx_hash, outputIndex: u.output_index, err: msg },
        'POST /v1/cardano/operator/sweep-locks: failed to release',
      );
    }
  }

  const released = results.filter((r) => r.ok).length;
  return c.json({ released, total: utxos.length, results }, 200);
}
