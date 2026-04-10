import { createHash, randomBytes } from 'node:crypto';
import { encodePacked, keccak256 } from 'viem';
import type { BridgeIntent, RelayerJob } from '../types.js';
import { finalityDelayMs } from '../adapters/finality.js';
import { intentAmountToTokenUnits } from '../adapters/amount.js';
import { buildStubProofBundle } from '../zk/stubProof.js';
import { evmMintWrapped } from '../adapters/evmMint.js';

let evmMutexQueue: Promise<void> = Promise.resolve();
async function withEvmMutex<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  const next = new Promise<void>((r) => { release = r; });
  const prev = evmMutexQueue;
  evmMutexQueue = next;
  await prev;
  try { return await fn(); } finally { release!(); }
}
import { evmUnlockWithInclusionProof } from '../adapters/evmUnlock.js';
import { evmPoolUnlockOperator } from '../adapters/evmPoolUnlockOperator.js';
import { resolveUnderlyingTokenForAsset } from '../adapters/evmUnderlying.js';
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
  reserveBurnCommitment,
  releaseBurnCommitment,
} from '../store.js';
import type { BridgeDedupeKeys } from './dedupe.js';
import { bridgeDedupeKeysFromIntent, findExistingJobForEvmDedupeKey } from './dedupe.js';
import { waitCardanoConfirmations, waitCardanoConfirmationsYaci } from '../adapters/cardanoFinality.js';
import {
  blockfrostNetwork,
  blockfrostProjectId,
  cardanoIndexerMode,
  resolveYaciBaseUrl,
} from '../adapters/cardanoIndexer.js';
import type { Logger } from 'pino';
import { isMidnightRelayerInitEnabled } from '../adapters/midnightOperatorConsoleTx.js';
import { ensureMidnightRelayer, runMidnightBurnPipeline, runMidnightMintPipeline } from '../midnight/service.js';
import type { MintPipelineArgs, BurnPipelineArgs } from '../midnight/service.js';
import { holderLedgerPublicKey } from '../midnight/holder-key.js';
import { AssetKind } from '@zk-stables/midnight-contract';
import { parseDecimalAmountToUnits } from '../adapters/amount.js';
import {
  cardanoRecipientMatchesNetwork,
  ensureCardanoBridgeWallet,
  isCardanoBridgeEnabled,
  looksLikeCardanoAddress,
} from '../adapters/cardanoPayout.js';
import {
  lockMintThenBridgeRelease,
  lockMintHoldAtScriptOnly,
  bridgeReleaseLockUtxo,
} from '../adapters/cardanoAiken/lockPoolBridge.js';
import { tryBurnSyntheticHeldByBridgeWallet } from '../adapters/cardanoMintPayout.js';
import { relayerBridgeCardanoRecipient } from '../config/bridgeRecipients.js';
import { buildLockRefFromIntent } from './lockRef.js';

function destLabel(intent: BridgeIntent): string {
  return (intent.destinationChain ?? '').toLowerCase();
}

function deriveBytes32HexFromGenesis(genesisHex: string, label: string): string {
  return createHash('sha256').update(`${label}:${genesisHex}`, 'utf8').digest('hex');
}

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 64) throw new Error('expected 32-byte hex string');
  return Uint8Array.from(Buffer.from(h, 'hex'));
}

function buildMintPipelineArgs(intent: BridgeIntent, lockRef: string): MintPipelineArgs {
  const genesisHex = (process.env.GENESIS_SEED_HASH_HEX ?? '').trim().replace(/^0x/i, '').toLowerCase();
  const holderSkHex = process.env.HOLDER_SK_HEX ?? (genesisHex ? deriveBytes32HexFromGenesis(genesisHex, 'zkstables:holderSk:v1') : '02'.repeat(32));
  const holderSk = hexToBytes32(holderSkHex);
  const holderPk = holderLedgerPublicKey(holderSk);

  const depositCommitmentHex = intent.source?.evm?.nonce
    ? intent.source.evm.nonce.replace(/^0x/, '')
    : createHash('sha256').update(`${lockRef}:deposit`, 'utf8').digest('hex');
  const depositCommitment = hexToBytes32(depositCommitmentHex.padStart(64, '0'));

  const assetKind = intent.asset === 'USDT' ? AssetKind.USDT : AssetKind.USDC;
  const sourceChainId = intent.sourceChain === 'cardano' ? 3n : intent.sourceChain === 'midnight' ? 4n : 1n;
  const decimals = Number(process.env.RELAYER_EVM_TOKEN_DECIMALS ?? 6);
  const amount = BigInt(Math.round(parseFloat(intent.amount) * 10 ** decimals));

  return { depositCommitment, assetKind, sourceChainId, amount, holderPk };
}

function buildBurnPipelineArgs(intent: BridgeIntent): BurnPipelineArgs | null {
  if (intent.operation !== 'BURN' || intent.sourceChain !== 'midnight') return null;
  const bc = intent.burnCommitmentHex?.replace(/^0x/i, '').trim().toLowerCase();
  if (!bc || bc.length !== 64 || !/^[0-9a-f]+$/u.test(bc)) return null;
  const recipientCommitment = hexToBytes32(bc);
  const destChainId = BigInt(intent.source?.midnight?.destChainId ?? 2);
  const depHex = intent.source?.midnight?.depositCommitmentHex?.replace(/^0x/i, '').trim().toLowerCase();
  if (!depHex || depHex.length !== 64 || !/^[0-9a-f]+$/u.test(depHex)) return null;
  const depositCommitment = hexToBytes32(depHex);
  return { depositCommitment, destChainId, recipientCommitment };
}

function looksLikeEvmAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/u.test(addr.trim());
}

function burnJobAmountRawUnits(intent: BridgeIntent): bigint {
  if (intent.operation !== 'BURN') throw new Error('burnJobAmountRawUnits: expected BURN');
  const evmFromLog =
    intent.sourceChain === 'evm' && Boolean(intent.source?.evm && typeof intent.source.evm.txHash === 'string');
  return intentAmountToTokenUnits(String(intent.amount), {
    operation: 'BURN',
    sourceChain: intent.sourceChain,
    evmBurnFromChainLog: evmFromLog,
  });
}

function relayerCardanoNetworkId(): 0 | 1 {
  const n = Number(process.env.RELAYER_CARDANO_NETWORK_ID ?? process.env.CARDANO_NETWORK_ID ?? 0);
  return n === 1 ? 1 : 0;
}

function destinationHint(intent: BridgeIntent, digest: string): string {
  if (
    intent.operation === 'BURN' &&
    (intent.sourceChain === 'cardano' || intent.sourceChain === 'midnight') &&
    looksLikeEvmAddress(intent.recipient)
  ) {
    return intent.sourceChain === 'midnight'
      ? `EVM claim: underlying ${intent.asset} to ${intent.recipient} via ZkStablesPoolLock.unlock (operator); pool burnNonce = depositCommitmentHex (unique per Midnight deposit).`
      : `EVM claim: underlying ${intent.asset} to ${intent.recipient} via ZkStablesPoolLock.unlock (operator) when RELAYER_EVM_POOL_LOCK + RELAYER_EVM_PRIVATE_KEY and per-asset underlying envs are set; burnNonce = burnCommitmentHex (32 bytes).`;
  }
  const dest = destLabel(intent);
  if (dest.includes('midnight')) {
    return `Midnight: proof digest ${digest.slice(0, 16)}… → recipient ${intent.recipient}. When RELAYER_MIDNIGHT_ENABLED=true, the relayer runs proveHolder + mintWrappedUnshielded on the zk-stables contract.`;
  }
  if (dest.includes('eth') || dest.includes('evm')) {
    if (intent.operation === 'BURN') {
      return `EVM: burn proven (merkle-inclusion-v1); underlying unlocked to ${intent.recipient} when RELAYER_EVM_POOL_LOCK and recipient is 0x-prefixed.`;
    }
    return `EVM destination: ZkStablesBridgeMint.mintWrapped (issues zkUSDC/zkUSDT) to ${intent.recipient} when RELAYER_EVM_BRIDGE_MINT + RELAYER_EVM_WRAPPED_TOKEN + RELAYER_EVM_PRIVATE_KEY are set (nonce from proof digest if omitted on intent).`;
  }
  if (dest.includes('cardano')) {
    return `Cardano destination: Aiken lock_pool (cardano/aiken) — mint under native policy, lock at script, BridgeRelease to ${intent.recipient} (2 txs) when bridge wallet + plutus.json + collateral are configured.`;
  }
  return `Destination ${intent.destinationChain ?? 'unknown'}: submit proofBundle to chain verifier, then mint/release per bridge rules.`;
}

/** 32-byte hex `recipient_commitment` for `LockDatum` (override via `RELAYER_CARDANO_RECIPIENT_COMMITMENT_HEX`). */
function cardanoRecipientCommitmentHex(lockRef: string, proofDigest: string): string {
  const env = process.env.RELAYER_CARDANO_RECIPIENT_COMMITMENT_HEX?.trim();
  if (env && /^[0-9a-fA-F]{64}$/u.test(env)) return env.toLowerCase();
  return createHash('sha256').update(`${lockRef}:${proofDigest}`, 'utf8').digest('hex');
}

/** LOCK/BURN → Cardano: Aiken `lock_pool` — mint + lock + `BridgeRelease` to recipient. */
async function cardanoSettlementPayout(params: {
  recipient: string;
  amountStr: string;
  asset: 'USDC' | 'USDT';
  recipientCommitmentHex: string;
  logger: Logger;
}): Promise<{ detail: string }> {
  const r = await lockMintThenBridgeRelease({
    recipientBech32: params.recipient,
    amountStr: params.amountStr,
    asset: params.asset,
    recipientCommitmentHex: params.recipientCommitmentHex,
    logger: params.logger,
  });
  return { detail: r.detail };
}

function cardanoBurnReleasePayoutBech32(intent: BridgeIntent): string {
  const r = intent.recipient.trim();
  if (r.startsWith('addr_test1') || (r.startsWith('addr1') && !r.startsWith('addr_test1'))) return r;
  const bridge = relayerBridgeCardanoRecipient();
  if (bridge && (bridge.startsWith('addr_test1') || bridge.startsWith('addr1'))) return bridge;
  const env = process.env.RELAYER_CARDANO_RELEASE_PAYOUT_ADDRESS?.trim();
  if (env && (env.startsWith('addr_test1') || env.startsWith('addr1'))) return env;
  throw new Error(
    'Cardano BURN release: set recipient to a bech32 address, or set RELAYER_BRIDGE_CARDANO_RECIPIENT / RELAYER_CARDANO_RELEASE_PAYOUT_ADDRESS for non-bech32 recipients',
  );
}

export async function enqueueLockIntent(logger: Logger, intent: BridgeIntent): Promise<RelayerJob | null> {
  const keys = bridgeDedupeKeysFromIntent(intent);
  if (keys.evm && !reserveEvmEvent(keys.evm)) {
    const existing = findExistingJobForEvmDedupeKey(keys.evm);
    if (existing) {
      logger.info(
        { dedupeKey: keys.evm, jobId: existing.id, phase: existing.phase },
        'idempotent lock: same EVM tx+log as existing job (watcher or replay)',
      );
      return existing;
    }
    logger.info({ dedupeKey: keys.evm }, 'skip duplicate evm event');
    return null;
  }
  if (keys.cardano && intent.operation !== 'BURN' && !reserveCardanoUtxo(keys.cardano)) {
    if (keys.evm) releaseEvmEvent(keys.evm);
    logger.info({ dedupeKey: keys.cardano }, 'skip duplicate cardano utxo');
    return null;
  }
  if (keys.burnCommitment && !reserveBurnCommitment(keys.burnCommitment)) {
    if (keys.evm) releaseEvmEvent(keys.evm);
    if (keys.cardano && intent.operation !== 'BURN') releaseCardanoUtxo(keys.cardano);
    logger.info({ burnCommitment: keys.burnCommitment }, 'skip duplicate burn commitment (would revert with "burn nonce used")');
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
    await runPipelineInner(logger, id, keys);
  } catch (e) {
    if (keys.burnCommitment) {
      releaseBurnCommitment(keys.burnCommitment);
      logger.warn(
        { id, burnCommitment: keys.burnCommitment },
        'pipeline failed: released burn commitment reservation (intent may be retried; on-chain burn nonce not consumed unless EVM unlock already ran)',
      );
    }
    throw e;
  } finally {
    if (keys.evm) releaseEvmEvent(keys.evm);
    if (keys.cardano) releaseCardanoUtxo(keys.cardano);
  }
}

async function runPipelineInner(logger: Logger, id: string, keys: BridgeDedupeKeys): Promise<void> {
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
    } else if (job.intent.operation === 'LOCK' && job.intent.sourceChain === 'evm') {
      throw new Error(
        'EVM LOCK mint requires source.evm.txHash and source.evm.logIndex (on-chain Locked event). Stub proofs are not allowed for this path.',
      );
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

    // BURN, Cardano source, non-Cardano destination: operator `BridgeRelease` and/or user `spendTxHash` must clear lock_pool (zk destroyed / moved on-chain) before job completion.
    if (
      job.intent.operation === 'BURN' &&
      job.intent.sourceChain === 'cardano' &&
      !destLabel(job.intent).includes('cardano') &&
      isCardanoBridgeEnabled()
    ) {
      const bridge = await ensureCardanoBridgeWallet(logger);
      const src = job.intent.source?.cardano;
      const userReleased = Boolean(src?.spendTxHash?.trim());
      const operatorMayRelease = process.env.RELAYER_CARDANO_OPERATOR_BURN_RELEASE === 'true';

      if (userReleased) {
        logger.info(
          { id, spendTxHash: src?.spendTxHash },
          'cardano BURN: user BridgeRelease already submitted; skipping operator lock_pool spend',
        );
        const j = getJob(id);
        patchJob(id, {
          destinationHint: `${j?.destinationHint ?? hint}\nUser BridgeRelease tx: ${src!.spendTxHash}`,
        });
        // User `BridgeRelease` moves zk to payment UTxOs; `bridgeReleaseLockUtxo` (burn mode) is skipped above,
        // so negative-mint supply burn must happen here when those UTxOs are still spendable by the bridge mnemonic.
        const burnAfter = await tryBurnSyntheticHeldByBridgeWallet({
          asset: job.intent.asset,
          amountStr: job.intent.amount,
          logger,
        });
        const jAfterBurn = getJob(id);
        const burnLine = burnAfter.ok
          ? burnAfter.detail
          : `WARN synthetic supply burn skipped: ${burnAfter.detail}`;
        patchJob(id, {
          destinationHint: `${jAfterBurn?.destinationHint ?? hint}\n${burnLine}`,
        });
        if (!burnAfter.ok) {
          logger.warn({ id, detail: burnAfter.detail }, 'cardano BURN: post-BridgeRelease synthetic burn did not run');
          if (process.env.RELAYER_CARDANO_BURN_AFTER_USER_RELEASE_STRICT === 'true') {
            throw new Error(
              `Cardano BURN: ${burnAfter.detail} Set RELAYER_CARDANO_BURN_AFTER_USER_RELEASE_STRICT=false to allow destination unlock anyway, or ensure zk sits on UTxOs derived from RELAYER_CARDANO_WALLET_MNEMONIC.`,
            );
          }
        } else {
          logger.info({ id, txHash: burnAfter.txHash }, 'cardano BURN: post-BridgeRelease synthetic supply burned');
        }
      } else if (!src?.txHash || src.outputIndex === undefined) {
        throw new Error(
          'Cardano BURN: intent.source.cardano.txHash and outputIndex are required so the relayer can spend lock_pool or verify spendTxHash',
        );
      } else if (!bridge) {
        throw new Error(
          'Cardano BURN: operator bridge wallet not available; configure RELAYER_CARDANO_WALLET_MNEMONIC (+ Plutus/collateral) or submit source.cardano.spendTxHash after user BridgeRelease',
        );
      } else if (operatorMayRelease) {
        try {
          const payout = cardanoBurnReleasePayoutBech32(job.intent);
          const { detail } = await bridgeReleaseLockUtxo({
            lockTxHash: src.txHash,
            lockOutputIndex: src.outputIndex,
            payoutBech32: payout,
            logger,
            releaseMode:
              process.env.RELAYER_CARDANO_OPERATOR_BURN_RELEASE_TRANSFER_LEGACY === 'true' ||
              process.env.RELAYER_CARDANO_OPERATOR_BURN_RELEASE_TRANSFER_LEGACY === '1'
                ? 'transfer'
                : 'burn',
          });
          const j = getJob(id);
          patchJob(id, {
            destinationHint: `${j?.destinationHint ?? hint}\n${detail}`,
          });
        } catch (e) {
          logger.error({ err: e, id }, 'cardano lock release failed');
          throw e;
        }
      } else {
        throw new Error(
          'Cardano BURN: zk remains at lock_pool until BridgeRelease — set RELAYER_CARDANO_OPERATOR_BURN_RELEASE=true for operator spend, or sign BridgeRelease and POST source.cardano.spendTxHash before confirming the relayer job',
        );
      }
    }

    // FR-3.1.5: burn → prove → unlock on source pool (EVM) when recipient is an EVM address.
    let evmBurnUnlockDone = false;
    if (
      job.intent.operation === 'BURN' &&
      job.intent.source?.evm &&
      proofBundle.inclusion &&
      looksLikeEvmAddress(job.intent.recipient) &&
      process.env.RELAYER_EVM_POOL_LOCK &&
      process.env.RELAYER_EVM_PRIVATE_KEY
    ) {
      const underlying = resolveUnderlyingTokenForAsset(job.intent.asset);
      if (!underlying) {
        logger.warn(
          { id, asset: job.intent.asset },
          'BURN unlock skipped: set RELAYER_EVM_UNDERLYING_TOKEN (and RELAYER_EVM_UNDERLYING_TOKEN_USDT for USDT)',
        );
      } else {
        const pk = process.env.RELAYER_EVM_PRIVATE_KEY as `0x${string}`;
        const pool = process.env.RELAYER_EVM_POOL_LOCK as `0x${string}`;
        const wrapped = (process.env.RELAYER_EVM_WRAPPED_TOKEN ?? job.intent.source.evm.wrappedTokenAddress) as `0x${string}`;
        const amountUnits = burnJobAmountRawUnits(job.intent);
        try {
          const { txHash } = await withEvmMutex(() => evmUnlockWithInclusionProof({
            rpcUrl,
            privateKey: pk,
            poolLock: pool,
            underlyingToken: underlying,
            recipient: job.intent.recipient as `0x${string}`,
            amount: amountUnits,
            wrappedEmitter: wrapped,
            proof: proofBundle.inclusion!,
          }));
          evmBurnUnlockDone = true;
          if (keys.evm) markEvmEventProcessed(keys.evm);
          patchJob(id, { destinationHint: `${hint}\nUnlock tx (inclusion proof): ${txHash}` });
        } catch (e) {
          logger.warn({ err: e, id }, 'unlockWithInclusionProof failed — falling back to operator unlock');
          const bc = job.intent.burnCommitmentHex?.replace(/^0x/i, '').trim().toLowerCase() ?? '';
          if (bc.length === 64 && /^[0-9a-f]+$/u.test(bc)) {
            try {
              const { txHash } = await withEvmMutex(() => evmPoolUnlockOperator({
                rpcUrl,
                privateKey: pk,
                poolLock: pool,
                underlyingToken: underlying,
                recipient: job.intent.recipient as `0x${string}`,
                amount: amountUnits,
                burnCommitment: `0x${bc}` as `0x${string}`,
              }));
              evmBurnUnlockDone = true;
              if (keys.evm) markEvmEventProcessed(keys.evm);
              patchJob(id, { destinationHint: `${hint}\nUnlock tx (operator fallback): ${txHash}` });
            } catch (e2) {
              logger.error({ err: e2, id }, 'operator unlock fallback also failed');
              throw e2;
            }
          } else {
            logger.error({ id }, 'unlockWithInclusionProof failed and no valid burnCommitmentHex for operator fallback');
            throw e;
          }
        }
      }
    }

    // BURN from any source (EVM, Cardano, Midnight): operator pool unlock when inclusion proof path was not used.
    // Midnight → EVM is handled **after** `runMidnightBurnPipeline` below: paying out the pool before `finalizeBurn`
    // completes can stall or fail (job sits in `destination_handoff` while ZK burn steps run, or wrong ordering vs SRS).
    if (
      job.intent.operation === 'BURN' &&
      job.intent.sourceChain !== 'midnight' &&
      !evmBurnUnlockDone &&
      looksLikeEvmAddress(job.intent.recipient) &&
      process.env.RELAYER_EVM_POOL_LOCK &&
      process.env.RELAYER_EVM_PRIVATE_KEY
    ) {
      const underlying = resolveUnderlyingTokenForAsset(job.intent.asset);
      if (!underlying) {
        logger.warn(
          { id, asset: job.intent.asset },
          'cross-chain EVM claim skipped: missing RELAYER_EVM_UNDERLYING_TOKEN (and optional RELAYER_EVM_UNDERLYING_TOKEN_USDT)',
        );
      } else {
        const bc = job.intent.burnCommitmentHex.replace(/^0x/i, '').trim().toLowerCase();
        if (bc.length !== 64 || !/^[0-9a-f]+$/u.test(bc)) {
          logger.warn({ id }, 'cross-chain EVM claim skipped: invalid burnCommitmentHex');
        } else {
          try {
            const pk = process.env.RELAYER_EVM_PRIVATE_KEY as `0x${string}`;
            const pool = process.env.RELAYER_EVM_POOL_LOCK as `0x${string}`;
            const amountUnits = burnJobAmountRawUnits(job.intent);
            const { txHash } = await withEvmMutex(() => evmPoolUnlockOperator({
              rpcUrl,
              privateKey: pk,
              poolLock: pool,
              underlyingToken: underlying,
              recipient: job.intent.recipient as `0x${string}`,
              amount: amountUnits,
              burnCommitment: `0x${bc}` as `0x${string}`,
            }));
            const j = getJob(id);
            patchJob(id, {
              destinationHint: `${j?.destinationHint ?? hint}\nEVM underlying payout (operator unlock): ${txHash}`,
            });
          } catch (e) {
            logger.error({ err: e, id }, 'cross-chain EVM pool unlock failed');
            throw e;
          }
        }
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
          const commitment = cardanoRecipientCommitmentHex(job.lockRef, proofBundle.digest);
          const { detail } = await cardanoSettlementPayout({
            recipient: job.intent.recipient,
            amountStr: job.intent.amount,
            asset: job.intent.asset,
            recipientCommitmentHex: commitment,
            logger,
          });
          patchJob(id, { destinationHint: `${hint}\n${detail}` });
        } catch (e) {
          logger.error({ err: e, id }, 'cardano BURN payout failed');
          throw e;
        }
      }
    }

    // LOCK → mint on EVM dest: nonce defaults to proof digest (bytes32).
    if (job.intent.operation === 'LOCK' && destLabel(job.intent).includes('evm') && looksLikeEvmAddress(job.intent.recipient)) {
      const pk = process.env.RELAYER_EVM_PRIVATE_KEY as `0x${string}` | undefined;
      const bridgeMint = process.env.RELAYER_EVM_BRIDGE_MINT as `0x${string}` | undefined;
      const wrapped = (
        process.env.RELAYER_EVM_WRAPPED_TOKEN
        ?? (job.intent.asset === 'USDT'
          ? process.env.RELAYER_EVM_WRAPPED_TOKEN_USDT
          : process.env.RELAYER_EVM_WRAPPED_TOKEN_USDC)
      ) as `0x${string}` | undefined;
      if (pk && bridgeMint && wrapped && proofBundle.publicInputsHex) {
        try {
          const digestHex = proofBundle.digest.length >= 64 ? proofBundle.digest.slice(0, 64) : proofBundle.digest.padStart(64, '0');
          const nonce = (job.intent.source?.evm?.nonce as `0x${string}` | undefined) ?? (`0x${digestHex}` as `0x${string}`);
          const decimals = Number(process.env.RELAYER_EVM_TOKEN_DECIMALS ?? 6);
          const amountIsRawUnits = job.intent.sourceChain === 'cardano' || job.intent.sourceChain === 'midnight';
          const amountUnits = amountIsRawUnits ? BigInt(job.intent.amount) : parseDecimalAmountToUnits(job.intent.amount, decimals);
          const { txHash } = await withEvmMutex(() => evmMintWrapped({
            rpcUrl,
            privateKey: pk,
            bridgeMint,
            wrappedToken: wrapped,
            recipient: job.intent.recipient as `0x${string}`,
            amount: amountUnits,
            nonce,
            proofBytes: '0x',
            publicInputsHash: (`0x${proofBundle.publicInputsHex}`) as `0x${string}`,
          }));
          patchJob(id, { destinationHint: `${hint}\nAuto-mint tx: ${txHash}` });
        } catch (e: any) {
          const msg = String(e?.message ?? e ?? '');
          if (msg.includes('nonce used')) {
            logger.warn({ id }, 'EVM auto-mint skipped: contract nonce already used (likely re-processed UTxO)');
            patchJob(id, { destinationHint: `${hint}\nAuto-mint skipped: contract nonce already consumed` });
          } else {
            logger.error({ err: e, id }, 'EVM auto-mint failed');
            throw e;
          }
        }
      }
    }

    // LOCK → Cardano dest: mint+lock+release (default) or mint+lock hold (user BridgeRelease) when env set.
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
          const commitment = cardanoRecipientCommitmentHex(job.lockRef, proofBundle.digest);
          const holdAtScript = process.env.RELAYER_CARDANO_DESTINATION_LOCK_HOLD === 'true';
          if (holdAtScript) {
            const r = await lockMintHoldAtScriptOnly({
              recipientBech32: job.intent.recipient,
              amountStr: job.intent.amount,
              asset: job.intent.asset,
              recipientCommitmentHex: commitment,
              logger,
            });
            patchJob(id, { destinationHint: `${hint}\n${r.detail}` });
          } else {
            const { detail } = await cardanoSettlementPayout({
              recipient: job.intent.recipient,
              amountStr: job.intent.amount,
              asset: job.intent.asset,
              recipientCommitmentHex: commitment,
              logger,
            });
            patchJob(id, { destinationHint: `${hint}\n${detail}` });
          }
        } catch (e) {
          logger.error({ err: e, id }, 'cardano LOCK payout failed');
          throw e;
        }
      }
    }

    // LOCK → Midnight: registerDeposit → proveHolder → mintWrappedUnshielded on registry contract.
    if (job.intent.operation === 'LOCK' && destLabel(job.intent).includes('midnight') && isMidnightRelayerInitEnabled()) {
      try {
        const mintArgs = buildMintPipelineArgs(job.intent, job.lockRef);
        const extra = await runMidnightMintPipeline(logger, mintArgs, job.intent.recipient);
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

    // BURN from Midnight: relayer must run registry finalizeBurn (on-chain destruction); never complete the job without it.
    if (job.intent.operation === 'BURN' && job.intent.sourceChain === 'midnight') {
      if (!isMidnightRelayerInitEnabled()) {
        throw new Error(
          'Midnight BURN requires RELAYER_MIDNIGHT_ENABLED=true or RELAYER_OPERATOR_CONSOLE_MIDNIGHT_TX / RELAYER_OPERATOR_CONSOLE_ALL (with wallet + contract) so the relayer can run sendWrappedUnshieldedToUser + finalizeBurn on zk-stables-registry',
        );
      }
      const relMid = await ensureMidnightRelayer(logger);
      if (!relMid) {
        throw new Error(
          'Midnight BURN: relayer could not join the registry (set RELAYER_MIDNIGHT_CONTRACT_ADDRESS or deploy flags + wallet seed)',
        );
      }
      const intentContract = job.intent.source?.midnight?.contractAddress?.trim();
      if (intentContract) {
        const ic = intentContract.replace(/^0x/i, '').toLowerCase();
        const rc = relMid.contractAddress.replace(/^0x/i, '').toLowerCase();
        if (ic !== rc) {
          throw new Error(
            `Midnight BURN: UI intent contract (${intentContract}) does not match relayer RELAYER_MIDNIGHT_CONTRACT_ADDRESS (${relMid.contractAddress}). The relayer only sees ledger rows on its joined instance — set the env var to your UI’s Join/Deploy address and restart the relayer.`,
          );
        }
      }
      const burnArgs = buildBurnPipelineArgs(job.intent);
      if (!burnArgs) {
        throw new Error(
          'Midnight BURN: need burnCommitmentHex (64 hex, recipientComm) and source.midnight.depositCommitmentHex (64 hex, ledger ticket) — relayer cannot finalize using recipientComm as deposit key',
        );
      }
      try {
        const extra = await runMidnightBurnPipeline(logger, burnArgs);
        const j = getJob(id);
        const prev = j?.destinationHint ?? hint;
        patchJob(id, {
          destinationHint: extra ? `${prev}\n\n--- Midnight finalizeBurn ---\n${extra}` : prev,
        });
      } catch (e) {
        logger.error({ err: e, id }, 'midnight burn pipeline failed');
        throw e;
      }
    }

    // Midnight BURN → EVM recipient: operator pool unlock **after** registry `finalizeBurn` (see early-exclude above).
    if (
      job.intent.operation === 'BURN' &&
      job.intent.sourceChain === 'midnight' &&
      !evmBurnUnlockDone &&
      looksLikeEvmAddress(job.intent.recipient) &&
      process.env.RELAYER_EVM_POOL_LOCK &&
      process.env.RELAYER_EVM_PRIVATE_KEY
    ) {
      const underlying = resolveUnderlyingTokenForAsset(job.intent.asset);
      if (!underlying) {
        logger.warn(
          { id, asset: job.intent.asset },
          'Midnight→EVM: cross-chain claim skipped: missing RELAYER_EVM_UNDERLYING_TOKEN (and optional RELAYER_EVM_UNDERLYING_TOKEN_USDT)',
        );
      } else {
        const depHex = job.intent.source?.midnight?.depositCommitmentHex?.replace(/^0x/i, '').trim().toLowerCase() ?? '';
        const recHex = job.intent.burnCommitmentHex.replace(/^0x/i, '').trim().toLowerCase();
        /** Pool `burnNonce` must be unique per payout. `recipientComm` repeats across deposits with the same bridge recipient → use ledger deposit id for Midnight→EVM. */
        const poolBurnNonce =
          depHex.length === 64 && /^[0-9a-f]+$/u.test(depHex)
            ? depHex
            : recHex.length === 64 && /^[0-9a-f]+$/u.test(recHex)
              ? recHex
              : '';
        if (poolBurnNonce.length !== 64) {
          logger.warn({ id }, 'Midnight→EVM: cross-chain claim skipped: need depositCommitmentHex or burnCommitmentHex (64 hex)');
        } else {
          try {
            const pk = process.env.RELAYER_EVM_PRIVATE_KEY as `0x${string}`;
            const pool = process.env.RELAYER_EVM_POOL_LOCK as `0x${string}`;
            const amountUnits = burnJobAmountRawUnits(job.intent);
            logger.info(
              { id, poolNonceFrom: depHex.length === 64 ? 'deposit' : 'recipientComm' },
              'Midnight→EVM: operator pool unlock (after Midnight finalizeBurn)',
            );
            const { txHash } = await withEvmMutex(() => evmPoolUnlockOperator({
              rpcUrl,
              privateKey: pk,
              poolLock: pool,
              underlyingToken: underlying,
              recipient: job.intent.recipient as `0x${string}`,
              amount: amountUnits,
              burnCommitment: `0x${poolBurnNonce}` as `0x${string}`,
            }));
            const j = getJob(id);
            patchJob(id, {
              destinationHint: `${j?.destinationHint ?? hint}\nEVM underlying payout (operator unlock): ${txHash}`,
            });
          } catch (e) {
            logger.error({ err: e, id }, 'Midnight→EVM: cross-chain EVM pool unlock failed');
            throw e;
          }
        }
      }
    }

    await new Promise((r) => setTimeout(r, Number(process.env.RELAYER_HANDOFF_MS ?? 300)));

    patchJob(id, { phase: 'completed' });
    logger.info({ id }, 'completed');
    if (keys.cardano) markCardanoUtxoProcessed(keys.cardano);
    /** Same `Locked` log must not enqueue a second pipeline after HTTP replay or watcher + UI confirm. */
    if (keys.evm) markEvmEventProcessed(keys.evm);
}
