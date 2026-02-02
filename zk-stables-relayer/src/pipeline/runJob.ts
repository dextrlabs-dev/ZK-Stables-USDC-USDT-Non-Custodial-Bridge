import { randomBytes } from 'node:crypto';
import { encodePacked, keccak256 } from 'viem';
import type { BridgeIntent, RelayerJob } from '../types.js';
import { finalityDelayMs } from '../adapters/finality.js';
import { buildStubProofBundle } from '../zk/stubProof.js';
import { evmMintWrapped } from '../adapters/evmMint.js';
import { evmUnlockWithInclusionProof } from '../adapters/evmUnlock.js';
import { waitEvmConfirmations } from '../adapters/evmFinality.js';
import { buildMerkleInclusionProof } from '../zk/evmInclusion.js';
import {
  getJob,
  patchJob,
  saveJob,
  markEvmEventProcessed,
  releaseEvmEvent,
  reserveEvmEvent,
} from '../store.js';
import { evmDedupeKeyFromIntent } from './dedupe.js';
import type { Logger } from 'pino';

function destLabel(intent: BridgeIntent): string {
  return (intent.destinationChain ?? '').toLowerCase();
}

function destinationHint(intent: BridgeIntent, digest: string): string {
  const dest = destLabel(intent);
  if (dest.includes('midnight')) {
    return `Midnight: verify proof digest ${digest.slice(0, 16)}… then run mintWrappedUnshielded / contract flow with recipient ${intent.recipient} (shielded UserAddress).`;
  }
  if (dest.includes('eth') || dest.includes('evm')) {
    if (intent.operation === 'BURN') {
      return `EVM: burn proven (merkle-inclusion-v1); underlying unlocked to ${intent.recipient}.`;
    }
    return `EVM destination: verifier contract should accept proof bundle and mint ERC-20 to ${intent.recipient}.`;
  }
  if (dest.includes('cardano')) {
    return `Cardano destination: mint native/Plutus token to address derived from recipient field.`;
  }
  return `Destination ${intent.destinationChain ?? 'unknown'}: submit proofBundle to chain verifier, then mint/release per bridge rules.`;
}

export async function enqueueLockIntent(logger: Logger, intent: BridgeIntent): Promise<RelayerJob | null> {
  const dedupeKey = evmDedupeKeyFromIntent(intent);
  if (dedupeKey && !reserveEvmEvent(dedupeKey)) {
    logger.info({ dedupeKey }, 'skip duplicate evm event');
    return null;
  }

  const id = `job_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const lockRef = `synthetic:${intent.sourceChain}:${randomBytes(8).toString('hex')}`;
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
  void runPipeline(logger, id, dedupeKey).catch((e) => {
    logger.error({ err: e, id }, 'pipeline failed');
    patchJob(id, { phase: 'failed', error: e instanceof Error ? e.message : String(e) });
  });
  return getJob(id)!;
}

async function runPipeline(logger: Logger, id: string, dedupeKey: string | undefined): Promise<void> {
  try {
    const job = getJob(id);
    if (!job) return;

    patchJob(id, { phase: 'awaiting_finality' });
    const rpcUrl = process.env.RELAYER_EVM_RPC_URL ?? 'http://127.0.0.1:8545';
    const conf = BigInt(process.env.RELAYER_EVM_CONFIRMATIONS ?? 1);

    if (job.intent.source?.evm?.blockNumber) {
      const mined = BigInt(job.intent.source.evm.blockNumber);
      logger.info({ id, mined: mined.toString(), confirmations: conf.toString() }, 'awaiting_evm_finality');
      await waitEvmConfirmations({ rpcUrl, minedBlock: mined, confirmations: conf });
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
    patchJob(id, {
      phase: 'destination_handoff',
      proofBundle,
      destinationHint: hint,
    });
    logger.info({ id, digest: proofBundle.digest }, 'destination_handoff');

    // FR-3.1.5: burn → prove → unlock on source pool (EVM).
    if (
      job.intent.operation === 'BURN' &&
      job.intent.source?.evm &&
      proofBundle.inclusion &&
      process.env.RELAYER_EVM_POOL_LOCK &&
      process.env.RELAYER_EVM_UNDERLYING_TOKEN &&
      process.env.RELAYER_EVM_PRIVATE_KEY
    ) {
      try {
        const pk = process.env.RELAYER_EVM_PRIVATE_KEY as `0x${string}`;
        const pool = process.env.RELAYER_EVM_POOL_LOCK as `0x${string}`;
        const underlying = process.env.RELAYER_EVM_UNDERLYING_TOKEN as `0x${string}`;
        const wrapped = (process.env.RELAYER_EVM_WRAPPED_TOKEN ?? job.intent.source.evm.wrappedTokenAddress) as `0x${string}`;
        const { txHash } = await evmUnlockWithInclusionProof({
          rpcUrl,
          privateKey: pk,
          poolLock: pool,
          underlyingToken: underlying,
          recipient: job.intent.recipient as `0x${string}`,
          amount: BigInt(job.intent.amount),
          wrappedEmitter: wrapped,
          proof: proofBundle.inclusion,
        });
        if (dedupeKey) markEvmEventProcessed(dedupeKey);
        patchJob(id, { destinationHint: `${hint}\nUnlock tx: ${txHash}` });
      } catch (e) {
        logger.error({ err: e, id }, 'unlockWithInclusionProof failed');
        throw e;
      }
    }

    // LOCK → mint on EVM dest (demo).
    if (
      job.intent.operation === 'LOCK' &&
      (job.intent.destinationChain ?? '').toLowerCase().includes('evm') &&
      job.intent.source?.evm?.nonce
    ) {
      const pk = process.env.RELAYER_EVM_PRIVATE_KEY as `0x${string}` | undefined;
      const bridgeMint = process.env.RELAYER_EVM_BRIDGE_MINT as `0x${string}` | undefined;
      const wrapped = process.env.RELAYER_EVM_WRAPPED_TOKEN as `0x${string}` | undefined;
      const nonce = job.intent.source.evm.nonce as `0x${string}`;
      if (pk && bridgeMint && wrapped && proofBundle.publicInputsHex) {
        try {
          const { txHash } = await evmMintWrapped({
            rpcUrl,
            privateKey: pk,
            bridgeMint,
            wrappedToken: wrapped,
            recipient: job.intent.recipient as `0x${string}`,
            amount: BigInt(job.intent.amount),
            nonce,
            proofBytes: '0x',
            publicInputsHash: (`0x${proofBundle.publicInputsHex}`) as `0x${string}`,
          });
          patchJob(id, { destinationHint: `${hint}\nAuto-mint tx: ${txHash}` });
        } catch (e) {
          logger.warn({ err: e, id }, 'auto-mint failed');
        }
      }
    }

    await new Promise((r) => setTimeout(r, Number(process.env.RELAYER_HANDOFF_MS ?? 300)));

    patchJob(id, { phase: 'completed' });
    logger.info({ id }, 'completed');
  } finally {
    if (dedupeKey) releaseEvmEvent(dedupeKey);
  }
}
