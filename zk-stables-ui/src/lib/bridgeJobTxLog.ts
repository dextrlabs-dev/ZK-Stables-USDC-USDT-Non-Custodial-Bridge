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

function asNonEmptyString(v: unknown): string | null {
  if (v == null) return null;
  const s = typeof v === 'string' ? v : String(v);
  return s.length > 0 ? s : null;
}

function shortenMiddle(s: string, head: number, tail: number): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

const MIDNIGHT_PROOF_NOTE_STUB =
  'Relayer SHA-256 digest binding the bridge intent to source-chain and destination-chain commitments.';

const MIDNIGHT_PROOF_NOTE_REAL =
  'Midnight Compact ZK circuit (verifyBridgeEvent). The proof binds depositCommitment, eventCommitment, and nonceCommitment on-chain via the zk-stables Compact contract. Encoding: contract/docs/DEPOSIT_COMMITMENT_ENCODING.md.';

function useMidnightProofLabels(job: RelayerJobApi): boolean {
  const sc = (job.intent as { sourceChain?: string }).sourceChain;
  const alg = (job.proofBundle as { algorithm?: string } | undefined)?.algorithm;
  return sc === 'midnight' || alg === 'midnight-compact-bridge-stub-v1' || alg === 'midnight-compact-proof-v1';
}

function isRealMidnightProof(job: RelayerJobApi): boolean {
  const alg = (job.proofBundle as { algorithm?: string } | undefined)?.algorithm;
  return alg === 'midnight-compact-proof-v1';
}

/** One-line summary for panels (e.g. CrossChainIntentPanel). */
export function proofAlgorithmSummary(algorithm: string): string {
  if (algorithm === 'midnight-compact-proof-v1') {
    return `${algorithm} — Midnight Compact ZK proof (verifyBridgeEvent circuit)`;
  }
  if (algorithm === 'midnight-compact-bridge-stub-v1') {
    return `${algorithm} — Midnight Compact path (relayer intent digest)`;
  }
  return algorithm;
}

export function buildTxLogEntries(job: RelayerJobApi): TxLogEntry[] {
  const out: TxLogEntry[] = [];
  const intent = job.intent as {
    source?: {
      evm?: { txHash?: string; logIndex?: string | number; blockNumber?: string };
      cardano?: { txHash?: string; outputIndex?: number; blockHeight?: string | number };
      midnight?: {
        txId?: string;
        txHash?: string;
        contractAddress?: string;
        destChainId?: number;
      };
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

  const mid = src?.midnight;
  if (mid?.txId) {
    const tid = mid.txId;
    push(out, {
      id: 'src-mn-txid',
      chain: 'midnight',
      label: 'Source · Midnight initiateBurn tx (id)',
      display: tid.length > 52 ? shortenMiddle(tid, 24, 16) : tid,
      full: tid,
    });
  }
  if (mid?.txHash && mid.txHash !== mid.txId) {
    const th = mid.txHash;
    push(out, {
      id: 'src-mn-txhash',
      chain: 'midnight',
      label: 'Source · Midnight tx hash',
      display: th.length > 48 ? shortenMiddle(th, 16, 12) : th,
      full: th,
    });
  }
  if (mid?.contractAddress) {
    const ca = mid.contractAddress;
    push(out, {
      id: 'src-mn-contract',
      chain: 'midnight',
      label: 'Source · zk-stables contract',
      display: ca.length > 48 ? shortenMiddle(ca, 16, 12) : ca,
      full: ca,
    });
  }
  if (mid?.destChainId !== undefined) {
    push(out, {
      id: 'src-mn-dest',
      chain: 'meta',
      label: 'initiateBurn dest chain id',
      display: String(mid.destChainId),
      full: String(mid.destChainId),
    });
  }

  if (job.proofBundle) {
    const pb = job.proofBundle as {
      algorithm?: unknown;
      digest?: unknown;
      publicInputsHex?: unknown;
      inclusion?: {
        txHash?: string;
        blockNumber?: string | number;
        blockHash?: string;
        merkleRoot?: string;
      };
    };
    const mnProof = useMidnightProofLabels(job);
    const realZk = isRealMidnightProof(job);
    const mnNote = realZk ? MIDNIGHT_PROOF_NOTE_REAL : MIDNIGHT_PROOF_NOTE_STUB;
    const proofChain = mnProof ? ('midnight' as const) : ('proof' as const);
    const algorithm = asNonEmptyString(pb.algorithm) ?? '—';
    push(out, {
      id: 'proof-alg',
      chain: proofChain,
      label: mnProof
        ? (realZk ? 'Midnight ZK proof (Compact circuit)' : 'Midnight · bridge binding (SHA-256 digest)')
        : 'Proof algorithm',
      display: algorithm,
      full: mnProof ? `${algorithm}\n${mnNote}` : algorithm,
    });
    const digest = asNonEmptyString(pb.digest);
    if (digest) {
      push(out, {
        id: 'proof-digest',
        chain: proofChain,
        label: mnProof
          ? (realZk ? 'Midnight · deposit commitment digest' : 'Midnight · intent digest (SHA-256)')
          : 'Proof digest',
        display: digest.length > 48 ? shortenMiddle(digest, 24, 12) : digest,
        full: mnProof ? `${digest}\n${mnNote}` : digest,
      });
    }
    const pubHex = asNonEmptyString(pb.publicInputsHex);
    if (pubHex) {
      push(out, {
        id: 'proof-pub',
        chain: proofChain,
        label: mnProof
          ? (realZk ? 'Midnight · public inputs (commitments)' : 'Midnight · binding metadata (hex)')
          : 'Public inputs (hex)',
        display: pubHex.length > 48 ? `${pubHex.slice(0, 20)}…` : pubHex,
        full: mnProof ? `${pubHex}\n${mnNote}` : pubHex,
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

    const mnSub = (job.proofBundle as { midnight?: { txHash?: string; txId?: string; contractAddress?: string; operationType?: string; depositCommitmentHex?: string; eventCommitmentHex?: string; nonceCommitmentHex?: string } })?.midnight;
    if (mnSub) {
      if (mnSub.txId) {
        push(out, {
          id: 'proof-mn-txid',
          chain: 'midnight',
          label: 'Midnight · proof tx (id)',
          display: mnSub.txId.length > 52 ? shortenMiddle(mnSub.txId, 24, 16) : mnSub.txId,
          full: mnSub.txId,
        });
      }
      if (mnSub.txHash && mnSub.txHash !== mnSub.txId) {
        push(out, {
          id: 'proof-mn-txhash',
          chain: 'midnight',
          label: 'Midnight · proof tx hash',
          display: mnSub.txHash.length > 48 ? shortenMiddle(mnSub.txHash, 16, 12) : mnSub.txHash,
          full: mnSub.txHash,
        });
      }
      if (mnSub.contractAddress) {
        push(out, {
          id: 'proof-mn-contract',
          chain: 'midnight',
          label: 'Midnight · proof contract',
          display: mnSub.contractAddress.length > 48 ? shortenMiddle(mnSub.contractAddress, 16, 12) : mnSub.contractAddress,
          full: mnSub.contractAddress,
        });
      }
      if (mnSub.operationType) {
        push(out, {
          id: 'proof-mn-optype',
          chain: 'meta',
          label: 'Midnight · proof operation',
          display: mnSub.operationType,
          full: mnSub.operationType,
        });
      }
      if (mnSub.depositCommitmentHex) {
        push(out, {
          id: 'proof-mn-deposit',
          chain: 'midnight',
          label: 'Midnight · depositCommitment',
          display: mnSub.depositCommitmentHex.length > 48 ? shortenMiddle(mnSub.depositCommitmentHex, 20, 12) : mnSub.depositCommitmentHex,
          full: mnSub.depositCommitmentHex,
        });
      }
      if (mnSub.eventCommitmentHex) {
        push(out, {
          id: 'proof-mn-event',
          chain: 'midnight',
          label: 'Midnight · eventCommitment',
          display: mnSub.eventCommitmentHex.length > 48 ? shortenMiddle(mnSub.eventCommitmentHex, 20, 12) : mnSub.eventCommitmentHex,
          full: mnSub.eventCommitmentHex,
        });
      }
      if (mnSub.nonceCommitmentHex) {
        push(out, {
          id: 'proof-mn-nonce',
          chain: 'midnight',
          label: 'Midnight · nonceCommitment',
          display: mnSub.nonceCommitmentHex.length > 48 ? shortenMiddle(mnSub.nonceCommitmentHex, 20, 12) : mnSub.nonceCommitmentHex,
          full: mnSub.nonceCommitmentHex,
        });
      }
    }
  }

  const depHex = asNonEmptyString(job.depositCommitmentHex);
  if (depHex) {
    push(out, {
      id: 'deposit-commit',
      chain: 'proof',
      label: 'Deposit commitment',
      display: depHex.length > 48 ? shortenMiddle(depHex, 20, 12) : depHex,
      full: depHex,
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
  if (parsed.evm?.operatorUnlockTx) {
    push(out, {
      id: 'dst-evm-op-unlock',
      chain: 'evm',
      label: 'Destination · EVM underlying payout (USDC / USDT)',
      display: parsed.evm.operatorUnlockTx,
      full: parsed.evm.operatorUnlockTx,
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
  if (parsed.cardano?.lockTx) {
    push(out, {
      id: 'dst-ada-lock',
      chain: 'cardano',
      label: 'Destination · Cardano lock (mint + lock)',
      display: parsed.cardano.lockTx,
      full: parsed.cardano.lockTx,
    });
  }
  if (parsed.cardano?.releaseTx) {
    push(out, {
      id: 'dst-ada-release',
      chain: 'cardano',
      label: 'Destination · Cardano release (payout)',
      display: parsed.cardano.releaseTx,
      full: parsed.cardano.releaseTx,
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
  const mnContract = parsed.midnight?.contract != null ? asNonEmptyString(parsed.midnight.contract) : null;
  if (mnContract) {
    push(out, {
      id: 'dst-mn-contract',
      chain: 'midnight',
      label: 'Midnight · Contract',
      display: mnContract.length > 48 ? shortenMiddle(mnContract, 16, 12) : mnContract,
      full: mnContract,
    });
  }
  if (parsed.midnight?.proveHolder?.txId || parsed.midnight?.proveHolder?.txHash) {
    const txId = asNonEmptyString(parsed.midnight.proveHolder.txId);
    const txHash = asNonEmptyString(parsed.midnight.proveHolder.txHash);
    if (txId) {
      push(out, {
        id: 'dst-mn-prove-id',
        chain: 'midnight',
        label: 'Midnight · proveHolder txId',
        display: txId.length > 52 ? shortenMiddle(txId, 24, 16) : txId,
        full: txId,
      });
    }
    if (txHash) {
      push(out, {
        id: 'dst-mn-prove-hash',
        chain: 'midnight',
        label: 'Midnight · proveHolder txHash',
        display: txHash.length > 48 ? shortenMiddle(txHash, 16, 12) : txHash,
        full: txHash,
      });
    }
  }
  if (parsed.midnight?.mintWrappedUnshielded?.txId || parsed.midnight?.mintWrappedUnshielded?.txHash) {
    const txId = asNonEmptyString(parsed.midnight.mintWrappedUnshielded.txId);
    const txHash = asNonEmptyString(parsed.midnight.mintWrappedUnshielded.txHash);
    if (txId) {
      push(out, {
        id: 'dst-mn-mint-id',
        chain: 'midnight',
        label: 'Midnight · mintWrappedUnshielded txId',
        display: txId.length > 52 ? shortenMiddle(txId, 24, 16) : txId,
        full: txId,
      });
    }
    if (txHash) {
      push(out, {
        id: 'dst-mn-mint-hash',
        chain: 'midnight',
        label: 'Midnight · mintWrappedUnshielded txHash',
        display: txHash.length > 48 ? shortenMiddle(txHash, 16, 12) : txHash,
        full: txHash,
      });
    }
  }

  if (parsed.cardano?.mintSkipped) {
    push(out, {
      id: 'dst-mn-mint-skipped',
      chain: 'midnight',
      label: 'Midnight · mintWrappedUnshielded (skipped — already minted)',
      display: 'skipped',
      full: 'mintWrappedUnshielded skipped: already minted unshielded on this contract instance',
    });
  }

  const mnBurnOps: Array<{ key: string; label: string; entry?: { txId?: string; txHash?: string } }> = [
    { key: 'initburn', label: 'Midnight · initiateBurn', entry: parsed.midnight?.initiateBurn },
    { key: 'verifyevt', label: 'Midnight · verifyBridgeEvent', entry: parsed.midnight?.verifyBridgeEvent },
    { key: 'sendunsh', label: 'Midnight · sendWrappedUnshielded', entry: parsed.midnight?.sendWrappedUnshielded },
    { key: 'finburn', label: 'Midnight · finalizeBurn', entry: parsed.midnight?.finalizeBurn },
  ];
  for (const { key, label, entry } of mnBurnOps) {
    if (!entry) continue;
    const txId = asNonEmptyString(entry.txId);
    const txHash = asNonEmptyString(entry.txHash);
    if (txId) {
      push(out, {
        id: `dst-mn-${key}-id`,
        chain: 'midnight',
        label: `${label} txId`,
        display: txId.length > 52 ? shortenMiddle(txId, 24, 16) : txId,
        full: txId,
      });
    }
    if (txHash) {
      push(out, {
        id: `dst-mn-${key}-hash`,
        chain: 'midnight',
        label: `${label} txHash`,
        display: txHash.length > 48 ? shortenMiddle(txHash, 16, 12) : txHash,
        full: txHash,
      });
    }
  }

  if (parsed.evm?.attestProofTx) {
    push(out, {
      id: 'dst-evm-attest',
      chain: 'evm',
      label: 'EVM · MidnightBridgeVerifier attestProof',
      display: parsed.evm.attestProofTx,
      full: parsed.evm.attestProofTx,
    });
  }

  return out;
}
