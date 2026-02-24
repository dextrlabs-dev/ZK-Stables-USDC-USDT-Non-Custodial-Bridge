import { randomBytes } from 'node:crypto';
import { encodePacked, keccak256 } from 'viem';
import type { BridgeIntent, RelayerJob } from '../types.js';
import { finalityDelayMs } from '../adapters/finality.js';
import { buildStubProofBundle } from '../zk/stubProof.js';
import { evmMintWrapped } from '../adapters/evmMint.js';
import { evmUnlockWithInclusionProof } from '../adapters/evmUnlock.js';
import { waitEvmConfirmations } from '../adapters/evmFinality.js';
import { buildMerkleInclusionProof } from '../zk/evmInclusion.js';
import { computeBurnDepositCommitmentHexFromIntent } from '../zk/evmBurnCommitment.js';
import {
  getJob,
  patchJob,
  saveJob,
  markEvmEventProcessed,
  releaseEvmEvent,
  reserveEvmEvent,
  markCardanoUtxoProcessed,
  releaseCardanoUtxo,
  reserveCardanoUtxo,
} from '../store.js';
import type { BridgeDedupeKeys } from './dedupe.js';
import { bridgeDedupeKeysFromIntent } from './dedupe.js';
import { waitCardanoConfirmations, waitCardanoConfirmationsYaci } from '../adapters/cardanoFinality.js';
import {
  blockfrostNetwork,
  blockfrostProjectId,
  cardanoIndexerMode,
  resolveYaciBaseUrl,
} from '../adapters/cardanoIndexer.js';
import type { Logger } from 'pino';
import { isMidnightBridgeEnabled, runMidnightMintPipeline } from '../midnight/service.js';
import { parseDecimalAmountToUnits } from '../adapters/amount.js';
import {
  cardanoPayoutToRecipient,
  cardanoRecipientMatchesNetwork,
  ensureCardanoBridgeWallet,
  isCardanoBridgeEnabled,
  looksLikeCardanoAddress,
} from '../adapters/cardanoPayout.js';
import { buildLockRefFromIntent } from './lockRef.js';

function destLabel(intent: BridgeIntent): string {
  return (intent.destinationChain ?? '').toLowerCase();
}

function looksLikeEvmAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/u.test(addr.trim());
}

function relayerCardanoNetworkId(): 0 | 1 {
  const n = Number(process.env.RELAYER_CARDANO_NETWORK_ID ?? process.env.CARDANO_NETWORK_ID ?? 0);
  return n === 1 ? 1 : 0;
}

function destinationHint(intent: BridgeIntent, digest: string): string {
  const dest = destLabel(intent);
  if (dest.includes('midnight')) {
    return `Midnight: proof digest ${digest.slice(0, 16)}… → recipient ${intent.recipient}. When RELAYER_MIDNIGHT_ENABLED=true, the relayer runs proveHolder + mintWrappedUnshielded on the zk-stables contract.`;
  }
  if (dest.includes('eth') || dest.includes('evm')) {
    if (intent.operation === 'BURN') {
      return `EVM: burn proven (merkle-inclusion-v1); underlying unlocked to ${intent.recipient} when RELAYER_EVM_POOL_LOCK and recipient is 0x-prefixed.`;
    }
    return `EVM destination: ZkStablesBridgeMint.mintWrapped to ${intent.recipient} when RELAYER_EVM_BRIDGE_MINT + RELAYER_EVM_WRAPPED_TOKEN + RELAYER_EVM_PRIVATE_KEY are set (nonce from proof digest if omitted on intent).`;
  }
  if (dest.includes('cardano')) {
    return `Cardano destination: operator payout to ${intent.recipient} when RELAYER_CARDANO_BRIDGE_ENABLED and a funded mnemonic + Yaci/Blockfrost are configured (lovelace/asset per env).`;
  }
  return `Destination ${intent.destinationChain ?? 'unknown'}: submit proofBundle to chain verifier, then mint/release per bridge rules.`;
}

export async function enqueueLockIntent(logger: Logger, intent: BridgeIntent): Promise<RelayerJob | null> {
  const keys = bridgeDedupeKeysFromIntent(intent);
  if (keys.evm && !reserveEvmEvent(keys.evm)) {
    logger.info({ dedupeKey: keys.evm }, 'skip duplicate evm event');
    return null;
  }
  if (keys.cardano && !reserveCardanoUtxo(keys.cardano)) {
    if (keys.evm) releaseEvmEvent(keys.evm);
    logger.info({ dedupeKey: keys.cardano }, 'skip duplicate cardano utxo');
    return null;
  }

  const id = `job_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const lockRef = buildLockRefFromIntent(intent);
  const now = new Date().toISOString();
  const job: RelayerJob = {
    id,
    intent,
    phase: 'received',
    createdAt: now,
    updatedAt: now,
    lockRef,
  };
  saveJob(job);
  void runPipeline(logger, id, keys).catch((e) => {
    logger.error({ err: e, id }, 'pipeline failed');
    patchJob(id, { phase: 'failed', error: e instanceof Error ? e.message : String(e) });
  });
  return getJob(id)!;
}

async function runPipeline(logger: Logger, id: string, keys: BridgeDedupeKeys): Promise<void> {
  try {
    const job = getJob(id);
    if (!job) return;

    patchJob(id, { phase: 'awaiting_finality' });
    const rpcUrl = process.env.RELAYER_EVM_RPC_URL ?? 'http://127.0.0.1:8545';
    const conf = BigInt(process.env.RELAYER_EVM_CONFIRMATIONS ?? 1);
    const cindexer = cardanoIndexerMode();
    const yaciBase = resolveYaciBaseUrl();
    const bfId = blockfrostProjectId();
    const bfNet = blockfrostNetwork();

    if (job.intent.source?.evm?.blockNumber) {
      const mined = BigInt(job.intent.source.evm.blockNumber);
      logger.info({ id, mined: mined.toString(), confirmations: conf.toString() }, 'awaiting_evm_finality');
      await waitEvmConfirmations({ rpcUrl, minedBlock: mined, confirmations: conf });
    } else if (
      cindexer !== 'none' &&
      job.intent.source?.cardano?.blockHeight !== undefined &&
      job.intent.source.cardano.blockHeight !== ''
    ) {
      const mined = Number(job.intent.source.cardano.blockHeight);
      const cconf = Number(process.env.RELAYER_CARDANO_CONFIRMATIONS ?? 8);
      if (cindexer === 'yaci' && yaciBase) {
        if (bfId) {
          logger.info(
            { id },
            'awaiting_cardano_finality via Yaci (RELAYER_YACI_URL or YACI_URL set; Blockfrost not used for Cardano)',
          );
        } else {
          logger.info({ id, mined, confirmations: cconf }, 'awaiting_cardano_finality (yaci)');
        }
        await waitCardanoConfirmationsYaci({
          baseUrl: yaciBase,
          minedBlockHeight: mined,
          confirmations: cconf,
        });
      } else if (bfId) {
        logger.info({ id, mined, confirmations: cconf }, 'awaiting_cardano_finality (blockfrost)');
        await waitCardanoConfirmations({
          projectId: bfId,
          network: bfNet,
          minedBlockHeight: mined,
          confirmations: cconf,
        });
      } else {
        const wait = finalityDelayMs(job.intent.sourceChain);
        logger.info(
          { id, sourceChain: job.intent.sourceChain, waitMs: wait },
          'awaiting_finality (simulated; Cardano blockHeight set but no indexer)',
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    } else {
      const wait = finalityDelayMs(job.intent.sourceChain);
      logger.info({ id, sourceChain: job.intent.sourceChain, waitMs: wait }, 'awaiting_finality (simulated)');
      await new Promise((r) => setTimeout(r, wait));
    }

    patchJob(id, { phase: 'proving' });
    logger.info({ id }, 'proving');

    let proofBundle: RelayerJob['proofBundle'];

    if (job.intent.source?.evm?.txHash !== undefined && job.intent.source.evm.logIndex !== undefined) {
      const inc = await buildMerkleInclusionProof({
        rpcUrl,
        txHash: job.intent.source.evm.txHash,
        logIndex: BigInt(job.intent.source.evm.logIndex),
      });
      const publicInputsHex = keccak256(
        encodePacked(['bytes32', 'bytes32', 'bytes32'], [inc.blockHash, inc.merkleRoot, inc.leaf]),
      ).slice(2);
      proofBundle = {
        algorithm: 'merkle-inclusion-v1',
        digest: inc.merkleRoot.slice(2),
        publicInputsHex,
        inclusion: inc,
      };
    } else {
      proofBundle = buildStubProofBundle(job.intent, job.lockRef);
    }

    await new Promise((r) => setTimeout(r, Number(process.env.RELAYER_PROVE_MS ?? 200)));

    const hint = destinationHint(job.intent, proofBundle.digest);
    const depositCommitmentHex = computeBurnDepositCommitmentHexFromIntent(job.intent, job.lockRef);
    patchJob(id, {
      phase: 'destination_handoff',
      proofBundle,
      destinationHint: hint,
      ...(depositCommitmentHex ? { depositCommitmentHex } : {}),
    });
    logger.info({ id, digest: proofBundle.digest, depositCommitmentHex }, 'destination_handoff');

    // FR-3.1.5: burn → prove → unlock on source pool (EVM) when recipient is an EVM address.
    let evmBurnUnlockDone = false;
    if (
      job.intent.operation === 'BURN' &&
      job.intent.source?.evm &&
      proofBundle.inclusion &&
      looksLikeEvmAddress(job.intent.recipient) &&
      process.env.RELAYER_EVM_POOL_LOCK &&
      process.env.RELAYER_EVM_UNDERLYING_TOKEN &&
      process.env.RELAYER_EVM_PRIVATE_KEY
    ) {
      try {
        const pk = process.env.RELAYER_EVM_PRIVATE_KEY as `0x${string}`;
        const pool = process.env.RELAYER_EVM_POOL_LOCK as `0x${string}`;
        const underlying = process.env.RELAYER_EVM_UNDERLYING_TOKEN as `0x${string}`;
        const wrapped = (process.env.RELAYER_EVM_WRAPPED_TOKEN ?? job.intent.source.evm.wrappedTokenAddress) as `0x${string}`;
        const decimals = Number(process.env.RELAYER_EVM_TOKEN_DECIMALS ?? 6);
        const amountUnits = parseDecimalAmountToUnits(job.intent.amount, decimals);
        const { txHash } = await evmUnlockWithInclusionProof({
          rpcUrl,
          privateKey: pk,
          poolLock: pool,
          underlyingToken: underlying,
          recipient: job.intent.recipient as `0x${string}`,
          amount: amountUnits,
          wrappedEmitter: wrapped,
          proof: proofBundle.inclusion,
        });
        evmBurnUnlockDone = true;
        if (keys.evm) markEvmEventProcessed(keys.evm);
        patchJob(id, { destinationHint: `${hint}\nUnlock tx: ${txHash}` });
      } catch (e) {
        logger.error({ err: e, id }, 'unlockWithInclusionProof failed');
        throw e;
      }
    }

    // BURN → Cardano recipient: settlement payout (stub / Cardano-sourced burn without EVM unlock).
    if (
      job.intent.operation === 'BURN' &&
      !evmBurnUnlockDone &&
      looksLikeCardanoAddress(job.intent.recipient) &&
      cardanoRecipientMatchesNetwork(job.intent.recipient, relayerCardanoNetworkId()) &&
      isCardanoBridgeEnabled()
    ) {
      const bridge = await ensureCardanoBridgeWallet(logger);
      if (bridge) {
        try {
          const lovelace = BigInt(process.env.RELAYER_CARDANO_PAYOUT_LOVELACE ?? '3000000');
          const assetUnit = process.env.RELAYER_CARDANO_ASSET_UNIT?.trim();
          const assetDecimals = Number(process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);
          const assetQty =
            assetUnit && assetUnit.length > 0
              ? parseDecimalAmountToUnits(job.intent.amount, assetDecimals)
              : undefined;
          const { txHash } = await cardanoPayoutToRecipient({
            recipientBech32: job.intent.recipient,
            lovelace,
            ...(assetUnit && assetQty !== undefined ? { assetUnit, assetQuantity: assetQty } : {}),
            logger,
          });
          patchJob(id, { destinationHint: `${hint}\nCardano unlock/payout tx: ${txHash}` });
        } catch (e) {
          logger.error({ err: e, id }, 'cardano BURN payout failed');
          throw e;
        }
      }
    }

    // LOCK → mint on EVM dest (demo): nonce defaults to proof digest (bytes32).
    if (job.intent.operation === 'LOCK' && destLabel(job.intent).includes('evm') && looksLikeEvmAddress(job.intent.recipient)) {
      const pk = process.env.RELAYER_EVM_PRIVATE_KEY as `0x${string}` | undefined;
      const bridgeMint = process.env.RELAYER_EVM_BRIDGE_MINT as `0x${string}` | undefined;
      const wrapped = process.env.RELAYER_EVM_WRAPPED_TOKEN as `0x${string}` | undefined;
      if (pk && bridgeMint && wrapped && proofBundle.publicInputsHex) {
        try {
          const digestHex = proofBundle.digest.length >= 64 ? proofBundle.digest.slice(0, 64) : proofBundle.digest.padStart(64, '0');
          const nonce = (job.intent.source?.evm?.nonce as `0x${string}` | undefined) ?? (`0x${digestHex}` as `0x${string}`);
          const decimals = Number(process.env.RELAYER_EVM_TOKEN_DECIMALS ?? 6);
          const amountUnits = parseDecimalAmountToUnits(job.intent.amount, decimals);
          const { txHash } = await evmMintWrapped({
            rpcUrl,
            privateKey: pk,
            bridgeMint,
            wrappedToken: wrapped,
            recipient: job.intent.recipient as `0x${string}`,
            amount: amountUnits,
            nonce,
            proofBytes: '0x',
            publicInputsHash: (`0x${proofBundle.publicInputsHex}`) as `0x${string}`,
          });
          patchJob(id, { destinationHint: `${hint}\nAuto-mint tx: ${txHash}` });
        } catch (e) {
          logger.error({ err: e, id }, 'EVM auto-mint failed');
          throw e;
        }
      }
    }

    // LOCK → Cardano dest: operator payout to bech32 recipient.
    if (
      job.intent.operation === 'LOCK' &&
      destLabel(job.intent).includes('cardano') &&
      looksLikeCardanoAddress(job.intent.recipient) &&
      cardanoRecipientMatchesNetwork(job.intent.recipient, relayerCardanoNetworkId()) &&
      isCardanoBridgeEnabled()
    ) {
      const bridge = await ensureCardanoBridgeWallet(logger);
      if (bridge) {
        try {
          const lovelace = BigInt(process.env.RELAYER_CARDANO_PAYOUT_LOVELACE ?? '3000000');
          const assetUnit = process.env.RELAYER_CARDANO_ASSET_UNIT?.trim();
          const assetDecimals = Number(process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);
          const assetQty =
            assetUnit && assetUnit.length > 0
              ? parseDecimalAmountToUnits(job.intent.amount, assetDecimals)
              : undefined;
          const { txHash } = await cardanoPayoutToRecipient({
            recipientBech32: job.intent.recipient,
            lovelace,
            ...(assetUnit && assetQty !== undefined ? { assetUnit, assetQuantity: assetQty } : {}),
            logger,
          });
          patchJob(id, { destinationHint: `${hint}\nCardano payout tx: ${txHash}` });
        } catch (e) {
          logger.error({ err: e, id }, 'cardano LOCK payout failed');
          throw e;
        }
      }
    }

    // LOCK → Midnight: relayer wallet runs proveHolder + mintWrappedUnshielded (same as local-cli demo sequence).
    if (job.intent.operation === 'LOCK' && destLabel(job.intent).includes('midnight') && isMidnightBridgeEnabled()) {
      try {
        const extra = await runMidnightMintPipeline(logger, job.intent.recipient);
        const j = getJob(id);
        const prev = j?.destinationHint ?? hint;
        patchJob(id, {
          destinationHint: extra ? `${prev}\n\n--- Midnight (relayer) ---\n${extra}` : prev,
        });
      } catch (e) {
        logger.error({ err: e, id }, 'midnight mint pipeline failed');
        throw e;
      }
    }

    await new Promise((r) => setTimeout(r, Number(process.env.RELAYER_HANDOFF_MS ?? 300)));

    patchJob(id, { phase: 'completed' });
    logger.info({ id }, 'completed');
    if (keys.cardano) markCardanoUtxoProcessed(keys.cardano);
  } finally {
    if (keys.evm) releaseEvmEvent(keys.evm);
    if (keys.cardano) releaseCardanoUtxo(keys.cardano);
  }
}
