import { deserializeDatum } from '@meshsdk/core';
import type { Data } from '@meshsdk/common';
import type { Context } from 'hono';
import type { Logger } from 'pino';
import { ForgeScript, resolveScriptHash, stringToHex } from '@meshsdk/core';
import { blockfrostAddressUtxos, primaryFungibleUnit } from '../adapters/cardanoBlockfrost.js';
import { yaciAddressUtxos } from '../adapters/cardanoYaci.js';
import {
  blockfrostNetwork,
  blockfrostProjectId,
  cardanoIndexerMode,
  resolveYaciBaseUrl,
} from '../adapters/cardanoIndexer.js';
import { ensureCardanoBridgeWallet } from '../adapters/cardanoPayout.js';
import { parseDecimalAmountToUnits, formatTokenUnitsToDecimal } from '../adapters/amount.js';
import {
  normalizeDatumRecipientCommitment,
  parseLockDatumFromMeshData,
} from '../adapters/cardanoAiken/cardanoLockDatum.js';
import { cardanoBridgeTokenName } from '../adapters/cardanoMintPayout.js';
import { loadBlueprint } from '../adapters/cardanoAiken/blueprint.js';
import { getLockPoolScript } from '../adapters/cardanoAiken/scripts.js';
import type { BurnIntent } from '../types.js';

export type CardanoBurnHintScanRow = {
  jobId: string;
  asset: 'USDC' | 'USDT';
  amount: string;
  recipient: string;
  burnCommitmentHex: string;
  cardano: NonNullable<BurnIntent['source']>['cardano'];
  createdAt: string;
  phase: string;
};

type RawUtxo = {
  tx_hash: string;
  output_index: number;
  amount: Array<{ unit: string; quantity: string }>;
  inline_datum?: string | null;
};

async function utxosAtLockScript(logger: Logger, scriptAddr: string): Promise<{ rows: RawUtxo[]; provider: string } | null> {
  const mode = cardanoIndexerMode();
  const yaci = resolveYaciBaseUrl();
  const bfId = blockfrostProjectId();
  const bfNet = blockfrostNetwork();
  try {
    if (mode === 'yaci' && yaci) {
      const raw = await yaciAddressUtxos(yaci, scriptAddr);
      return {
        provider: 'yaci',
        rows: raw.map((u) => ({
          tx_hash: u.tx_hash,
          output_index: u.output_index,
          amount: u.amount,
          inline_datum: u.inline_datum,
        })),
      };
    }
    if (bfId) {
      const raw = await blockfrostAddressUtxos(bfId, bfNet, scriptAddr);
      return {
        provider: 'blockfrost',
        rows: raw.map((u) => ({
          tx_hash: u.tx_hash,
          output_index: u.output_index,
          amount: u.amount,
          inline_datum: u.inline_datum,
        })),
      };
    }
  } catch (e) {
    logger.warn({ err: e, scriptAddr }, 'cardanoRecentBurnHints: UTxO fetch failed');
    return null;
  }
  return null;
}

/**
 * Shared scan for `lock_pool` UTxOs (used by GET recent-burn-hints and operator redeem HTTP).
 */
export async function collectCardanoBurnHintsForAssetAmount(
  logger: Logger,
  asset: 'USDC' | 'USDT',
  amountStr: string,
): Promise<{
  hints: CardanoBurnHintScanRow[];
  lockScriptAddress?: string;
  scanNote?: string;
  indexer?: string;
  want?: { asset: 'USDC' | 'USDT'; amount: string; amountRaw: string; expectedUnit: string };
}> {
  const decimals = Number(process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);
  let wantUnits: bigint;
  try {
    wantUnits = parseDecimalAmountToUnits(amountStr, decimals);
  } catch (e) {
    return { hints: [], scanNote: e instanceof Error ? e.message : 'invalid amount' };
  }

  const ctx = await ensureCardanoBridgeWallet(logger);
  if (!ctx) {
    return {
      hints: [],
      scanNote:
        'Cardano bridge wallet not configured — cannot derive forging policy / match WUSDC·WUSDT units on lock UTxOs (set RELAYER_CARDANO_WALLET_MNEMONIC + indexer).',
    };
  }

  const change = ctx.wallet.getChangeAddress();
  if (!change?.trim()) {
    return { hints: [], scanNote: 'Mesh wallet has no change address.' };
  }

  const forgingScript = ForgeScript.withOneSignature(change);
  const forgingPolicyId = resolveScriptHash(forgingScript);
  const tokenNameHex = stringToHex(cardanoBridgeTokenName(asset));
  const expectedUnit = `${forgingPolicyId}${tokenNameHex}`;

  let scriptAddr: string;
  try {
    const networkId = Number(process.env.RELAYER_CARDANO_NETWORK_ID ?? process.env.CARDANO_NETWORK_ID ?? 0) === 1 ? 1 : 0;
    const bp = loadBlueprint();
    scriptAddr = getLockPoolScript(bp, networkId).address;
  } catch (e) {
    logger.warn({ err: e }, 'cardanoRecentBurnHints: lock script address failed');
    return { hints: [], scanNote: 'Could not derive lock_pool script address (blueprint / network id).' };
  }

  const pack = await utxosAtLockScript(logger, scriptAddr);
  if (!pack) {
    const mode = cardanoIndexerMode();
    return {
      hints: [],
      scanNote:
        mode === 'yaci'
          ? 'Set RELAYER_YACI_URL (or YACI_URL) so the relayer can list UTxOs at the lock script.'
          : 'Set RELAYER_BLOCKFROST_PROJECT_ID so the relayer can list UTxOs at the lock script.',
    };
  }

  const hints: CardanoBurnHintScanRow[] = [];
  for (const u of pack.rows) {
    const inline = u.inline_datum?.trim();
    if (!inline) continue;
    let datumData: Data;
    try {
      datumData = deserializeDatum(inline.replace(/^0x/i, '')) as Data;
    } catch {
      continue;
    }
    let params: ReturnType<typeof parseLockDatumFromMeshData>;
    try {
      params = parseLockDatumFromMeshData(datumData);
    } catch {
      continue;
    }
    if (params.amount !== wantUnits) continue;
    const unit = primaryFungibleUnit(u.amount)?.unit;
    if (!unit || unit !== expectedUnit) continue;
    let burnCommitmentHex: string;
    try {
      burnCommitmentHex = normalizeDatumRecipientCommitment(params.recipientCommitmentHex);
    } catch {
      continue;
    }

    hints.push({
      jobId: `chain:${u.tx_hash}:${u.output_index}`,
      asset,
      amount: formatTokenUnitsToDecimal(wantUnits, decimals),
      recipient: '',
      burnCommitmentHex,
      cardano: {
        txHash: u.tx_hash,
        outputIndex: u.output_index,
        policyIdHex: params.policyIdHex,
        assetNameHex: params.assetNameHex,
        lockNonce: params.lockNonce.toString(),
      },
      createdAt: new Date().toISOString(),
      phase: 'on-chain',
    });
  }

  const limit = Math.min(25, Math.max(1, Number(process.env.RELAYER_CARDANO_RECENT_BURN_HINTS_LIMIT ?? 15)));
  const out = hints.slice(0, limit);

  return {
    hints: out,
    lockScriptAddress: scriptAddr,
    indexer: pack.provider,
    want: { asset, amount: amountStr, amountRaw: wantUnits.toString(), expectedUnit },
  };
}

/**
 * List `lock_pool` UTxOs with inline datums matching `amount` + `asset` (operator console auto-anchor for Cardano→EVM BURN).
 */
export async function handleCardanoRecentBurnHints(c: Context, logger: Logger) {
  const assetRaw = (c.req.query('asset') ?? 'USDC').trim().toUpperCase();
  if (assetRaw !== 'USDC' && assetRaw !== 'USDT') {
    return c.json({ error: 'asset must be USDC or USDT' }, 400);
  }
  const asset = assetRaw as 'USDC' | 'USDT';

  const amountStr = (c.req.query('amount') ?? '').trim();
  if (!amountStr) {
    return c.json({ error: 'amount query required (decimal, e.g. 0.05)' }, 400);
  }

  const pack = await collectCardanoBurnHintsForAssetAmount(logger, asset, amountStr);
  return c.json({
    lockScriptAddress: pack.lockScriptAddress,
    indexer: pack.indexer,
    want: pack.want,
    count: pack.hints.length,
    hints: pack.hints,
    ...(pack.scanNote ? { scanNote: pack.scanNote } : {}),
  });
}
