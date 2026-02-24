import type { RelayerJobApi } from './relayerClient.js';
import { parseDestinationHintTxs } from './relayerTxParsing.js';

export type TxLogEntry = {
  id: string;
  chain: 'evm' | 'cardano' | 'midnight' | 'proof' | 'meta';
  label: string;
  /** Short display */
  display: string;
  /** Full value for copy / title */
  full: string;
};

function push(out: TxLogEntry[], e: TxLogEntry) {
  out.push(e);
}

export function buildTxLogEntries(job: RelayerJobApi): TxLogEntry[] {
  const out: TxLogEntry[] = [];
  const intent = job.intent as {
    source?: {
      evm?: { txHash?: string; logIndex?: string | number; blockNumber?: string };
      cardano?: { txHash?: string; outputIndex?: number; blockHeight?: string | number };
    };
  };
  const src = intent.source;

  if (src?.evm?.txHash) {
    push(out, {
      id: 'src-evm',
      chain: 'evm',
      label: 'Source · EVM lock / burn tx',
      display: src.evm.txHash,
      full: src.evm.txHash,
    });
    if (src.evm.logIndex !== undefined) {
      push(out, {
        id: 'src-evm-meta',
        chain: 'meta',
        label: 'EVM log index',
        display: String(src.evm.logIndex),
        full: String(src.evm.logIndex),
      });
    }
    if (src.evm.blockNumber) {
      push(out, {
        id: 'src-evm-block',
        chain: 'meta',
        label: 'EVM block',
        display: String(src.evm.blockNumber),
        full: String(src.evm.blockNumber),
      });
    }
  }

  if (src?.cardano?.txHash) {
    push(out, {
      id: 'src-ada',
      chain: 'cardano',
      label: 'Source · Cardano lock UTxO tx',
      display: src.cardano.txHash,
      full: src.cardano.txHash,
    });
    if (src.cardano.outputIndex !== undefined) {
      push(out, {
        id: 'src-ada-out',
        chain: 'meta',
        label: 'Output index',
        display: String(src.cardano.outputIndex),
        full: String(src.cardano.outputIndex),
      });
    }
  }

  if (job.proofBundle) {
    const pb = job.proofBundle as {
      algorithm: string;
      digest: string;
      publicInputsHex?: string;
      inclusion?: {
        txHash?: string;
        blockNumber?: string | number;
        blockHash?: string;
        merkleRoot?: string;
      };
    };
    push(out, {
      id: 'proof-alg',
      chain: 'proof',
      label: 'Proof algorithm',
      display: pb.algorithm,
      full: pb.algorithm,
    });
    push(out, {
      id: 'proof-digest',
      chain: 'proof',
      label: 'Proof digest',
      display: pb.digest.length > 48 ? `${pb.digest.slice(0, 24)}…${pb.digest.slice(-12)}` : pb.digest,
      full: pb.digest,
    });
    if (pb.publicInputsHex) {
      push(out, {
        id: 'proof-pub',
        chain: 'proof',
        label: 'Public inputs (hex)',
        display: pb.publicInputsHex.length > 48 ? `${pb.publicInputsHex.slice(0, 20)}…` : pb.publicInputsHex,
        full: pb.publicInputsHex,
      });
    }
    const inc = pb.inclusion;
    if (inc?.txHash) {
      push(out, {
        id: 'proof-merkle-tx',
        chain: 'evm',
        label: 'Merkle proof · tx',
        display: inc.txHash,
        full: inc.txHash,
      });
    }
    if (inc?.blockNumber !== undefined) {
      push(out, {
        id: 'proof-merkle-bn',
        chain: 'meta',
        label: 'Merkle proof · block',
        display: String(inc.blockNumber),
        full: String(inc.blockNumber),
      });
    }
    if (inc?.merkleRoot) {
      push(out, {
        id: 'proof-merkle-root',
        chain: 'proof',
        label: 'Merkle root',
        display:
          typeof inc.merkleRoot === 'string' && inc.merkleRoot.length > 42
            ? `${inc.merkleRoot.slice(0, 18)}…${inc.merkleRoot.slice(-10)}`
            : String(inc.merkleRoot),
        full: String(inc.merkleRoot),
      });
    }
    if (inc?.blockHash) {
      push(out, {
        id: 'proof-merkle-bh',
        chain: 'meta',
        label: 'Block hash',
        display:
          typeof inc.blockHash === 'string' && inc.blockHash.length > 42
            ? `${inc.blockHash.slice(0, 12)}…${inc.blockHash.slice(-10)}`
            : String(inc.blockHash),
        full: String(inc.blockHash),
      });
    }
  }

  if (job.depositCommitmentHex) {
    push(out, {
      id: 'deposit-commit',
      chain: 'proof',
      label: 'Deposit commitment',
      display:
        job.depositCommitmentHex.length > 48
          ? `${job.depositCommitmentHex.slice(0, 20)}…${job.depositCommitmentHex.slice(-12)}`
          : job.depositCommitmentHex,
      full: job.depositCommitmentHex,
    });
  }

  const parsed = parseDestinationHintTxs(job.destinationHint);
  if (parsed.evm?.unlockTx) {
    push(out, {
      id: 'dst-evm-unlock',
      chain: 'evm',
      label: 'Destination · EVM unlock',
      display: parsed.evm.unlockTx,
      full: parsed.evm.unlockTx,
    });
  }
  if (parsed.evm?.mintTx) {
    push(out, {
      id: 'dst-evm-mint',
      chain: 'evm',
      label: 'Destination · EVM mint',
      display: parsed.evm.mintTx,
      full: parsed.evm.mintTx,
    });
  }
  if (parsed.cardano?.payoutTx) {
    push(out, {
      id: 'dst-ada-pay',
      chain: 'cardano',
      label: 'Destination · Cardano payout',
      display: parsed.cardano.payoutTx,
      full: parsed.cardano.payoutTx,
    });
  }
  if (parsed.cardano?.unlockTx) {
    push(out, {
      id: 'dst-ada-unlock',
      chain: 'cardano',
      label: 'Destination · Cardano unlock / payout',
      display: parsed.cardano.unlockTx,
      full: parsed.cardano.unlockTx,
    });
  }
  if (parsed.midnight?.contract) {
    push(out, {
      id: 'dst-mn-contract',
      chain: 'midnight',
      label: 'Midnight · Contract',
      display:
        parsed.midnight.contract.length > 48
          ? `${parsed.midnight.contract.slice(0, 16)}…${parsed.midnight.contract.slice(-12)}`
          : parsed.midnight.contract,
      full: parsed.midnight.contract,
    });
  }
  if (parsed.midnight?.proveHolder?.txId || parsed.midnight?.proveHolder?.txHash) {
    const txId = parsed.midnight.proveHolder.txId;
    const txHash = parsed.midnight.proveHolder.txHash;
    if (txId) {
      push(out, {
        id: 'dst-mn-prove-id',
        chain: 'midnight',
        label: 'Midnight · proveHolder txId',
        display: txId.length > 52 ? `${txId.slice(0, 24)}…${txId.slice(-16)}` : txId,
        full: txId,
      });
    }
    if (txHash) {
      push(out, {
        id: 'dst-mn-prove-hash',
        chain: 'midnight',
        label: 'Midnight · proveHolder txHash',
        display: txHash.length > 48 ? `${txHash.slice(0, 16)}…${txHash.slice(-12)}` : txHash,
        full: txHash,
      });
    }
  }
  if (parsed.midnight?.mintWrappedUnshielded?.txId || parsed.midnight?.mintWrappedUnshielded?.txHash) {
    const txId = parsed.midnight.mintWrappedUnshielded.txId;
    const txHash = parsed.midnight.mintWrappedUnshielded.txHash;
    if (txId) {
      push(out, {
        id: 'dst-mn-mint-id',
        chain: 'midnight',
        label: 'Midnight · mintWrappedUnshielded txId',
        display: txId.length > 52 ? `${txId.slice(0, 24)}…${txId.slice(-16)}` : txId,
        full: txId,
      });
    }
    if (txHash) {
      push(out, {
        id: 'dst-mn-mint-hash',
        chain: 'midnight',
        label: 'Midnight · mintWrappedUnshielded txHash',
        display: txHash.length > 48 ? `${txHash.slice(0, 16)}…${txHash.slice(-12)}` : txHash,
        full: txHash,
      });
    }
  }

  return out;
}
