import { deserializeDatum } from '@meshsdk/core';
import type { Data } from '@meshsdk/common';
import type { Logger } from 'pino';
import type { BurnIntent } from '../../types.js';
import { ensureCardanoBridgeWallet } from '../cardanoPayout.js';
import { parseDecimalAmountToUnits } from '../amount.js';
import {
  normalizeBurnCommitmentHex64,
  normalizeDatumRecipientCommitment,
  parseLockDatumFromMeshData,
} from './cardanoLockDatum.js';
import { fetchUtxo } from './fetchUtxo.js';

/**
 * When `source.cardano` is set, ensure `burnCommitmentHex` matches lock datum `recipient_commitment`.
 * If the lock UTxO is already spent, require `spendTxHash` (optional lax mode) or fail.
 */
export async function validateCardanoBurnIntentLockDatum(
  intent: BurnIntent,
  logger: Logger,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (intent.sourceChain !== 'cardano') return { ok: true };
  const src = intent.source?.cardano;
  if (!src?.txHash || src.outputIndex === undefined) {
    return { ok: true };
  }

  let expectedBc: string;
  try {
    expectedBc = normalizeBurnCommitmentHex64(intent.burnCommitmentHex);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const ctx = await ensureCardanoBridgeWallet(logger);
  if (!ctx) {
    logger.warn(
      { txHash: src.txHash, outputIndex: src.outputIndex },
      'Cardano bridge/indexer not configured — skipping BURN lock datum validation',
    );
    return { ok: true };
  }

  try {
    const u = await fetchUtxo(ctx.fetcher, src.txHash.trim(), src.outputIndex);
    const rawDatum = u.output.plutusData;
    if (!rawDatum) {
      return { ok: false, error: 'Lock UTxO has no inline Plutus datum' };
    }
    let datumData: Data;
    try {
      datumData = deserializeDatum(rawDatum) as Data;
    } catch (e) {
      return { ok: false, error: `Failed to deserialize lock datum: ${e instanceof Error ? e.message : String(e)}` };
    }
    const params = parseLockDatumFromMeshData(datumData);
    let datumBc: string;
    try {
      datumBc = normalizeDatumRecipientCommitment(params.recipientCommitmentHex);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (datumBc !== expectedBc) {
      return {
        ok: false,
        error: 'burnCommitmentHex does not match lock datum recipient_commitment',
      };
    }
    const decimals = Number(process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);
    const want = parseDecimalAmountToUnits(intent.amount, decimals);
    if (want !== params.amount) {
      logger.warn(
        { intentAmount: intent.amount, datumAmount: params.amount.toString() },
        'Cardano BURN intent amount differs from lock datum amount (continuing — check policy)',
      );
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (src.spendTxHash?.trim()) {
      logger.info(
        { lockRef: `${src.txHash}#${src.outputIndex}`, spendTxHash: src.spendTxHash },
        'Lock UTxO not found as unspent; spendTxHash provided — assuming user BridgeRelease (datum not re-verified)',
      );
      return { ok: true };
    }
    return {
      ok: false,
      error: `Cannot load lock UTxO ${src.txHash}#${src.outputIndex}: ${msg}. If you already submitted BridgeRelease, include source.cardano.spendTxHash.`,
    };
  }
}
