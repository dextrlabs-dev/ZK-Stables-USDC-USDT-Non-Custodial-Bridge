export type ParsedDestinationTxs = {
  evm?: { unlockTx?: string; mintTx?: string; operatorUnlockTx?: string; attestProofTx?: string };
  cardano?: { payoutTx?: string; unlockTx?: string; lockTx?: string; releaseTx?: string; mintSkipped?: boolean };
  midnight?: {
    contract?: string;
    proveHolder?: { txId?: string; txHash?: string };
    mintWrappedUnshielded?: { txId?: string; txHash?: string };
    initiateBurn?: { txId?: string; txHash?: string };
    finalizeBurn?: { txId?: string; txHash?: string };
    sendWrappedUnshielded?: { txId?: string; txHash?: string };
    verifyBridgeEvent?: { txId?: string; txHash?: string };
  };
};

function m(re: RegExp, s: string): string | undefined {
  const x = re.exec(s);
  return x?.[1];
}

/** When the relayer could not call pool unlock, it appends this prefix to `destinationHint`. */
export function parseEvmPayoutSkippedReason(hint: string | undefined): string | null {
  if (!hint) return null;
  for (const line of hint.split('\n')) {
    const s = line.trim();
    if (s.startsWith('EVM underlying payout skipped:')) {
      return s.slice('EVM underlying payout skipped:'.length).trim();
    }
  }
  return null;
}

export function parseDestinationHintTxs(hint: string | undefined): ParsedDestinationTxs {
  const h = hint ?? '';
  const out: ParsedDestinationTxs = {};

  const unlockTx = m(/Unlock tx:\s*(0x[a-fA-F0-9]{64})/u, h);
  const mintTx = m(/Auto-mint tx:\s*(0x[a-fA-F0-9]{64})/u, h);
  const operatorUnlockTx = m(/EVM underlying payout \(operator unlock\):\s*(0x[a-fA-F0-9]{64})/u, h);
  const attestProofTx = m(/attestProof\s+(?:txHash|tx)=\s*(0x[a-fA-F0-9]{64})/u, h)
    ?? m(/midnight proof attested.*?(?:txHash|tx)=\s*(0x[a-fA-F0-9]{64})/u, h);
  if (unlockTx || mintTx || operatorUnlockTx || attestProofTx) {
    out.evm = {
      ...(unlockTx ? { unlockTx } : {}),
      ...(mintTx ? { mintTx } : {}),
      ...(operatorUnlockTx ? { operatorUnlockTx } : {}),
      ...(attestProofTx ? { attestProofTx } : {}),
    };
  }

  const cardanoPayout = m(/Cardano payout tx:\s*([0-9a-fA-F]{64})/u, h);
  const cardanoUnlockPayout = m(/Cardano unlock\/payout tx:\s*([0-9a-fA-F]{64})/u, h);
  const cardanoLockTx = m(/lock_pool: lock\s+([0-9a-fA-F]{64})/u, h);
  const cardanoReleaseTx = m(/→ release\s+([0-9a-fA-F]{64})/u, h)
    ?? m(/-> release\s+([0-9a-fA-F]{64})/u, h);
  const mintSkipped = /mintWrappedUnshielded skipped/u.test(h);
  if (cardanoPayout || cardanoUnlockPayout || cardanoLockTx || cardanoReleaseTx || mintSkipped) {
    out.cardano = {
      ...(cardanoPayout ? { payoutTx: cardanoPayout } : {}),
      ...(cardanoUnlockPayout ? { unlockTx: cardanoUnlockPayout } : {}),
      ...(cardanoLockTx ? { lockTx: cardanoLockTx } : {}),
      ...(cardanoReleaseTx ? { releaseTx: cardanoReleaseTx } : {}),
      ...(mintSkipped ? { mintSkipped: true } : {}),
    };
  }

  const contract = m(/Contract\s+([0-9a-fA-F]{64})/u, h);
  const proveTxId = m(/proveHolder txId=([0-9a-fA-F]{66,})/u, h);
  const proveTxHash = m(/proveHolder txId=[0-9a-fA-F]{66,}\s+txHash=([0-9a-fA-F]{64})/u, h);
  const mintTxId = m(/mintWrappedUnshielded txId=([0-9a-fA-F]{66,})/u, h);
  const mintTxHash = m(/mintWrappedUnshielded txId=[0-9a-fA-F]{66,}\s+txHash=([0-9a-fA-F]{64})/u, h);

  const initBurnTxId = m(/initiateBurn txId=([0-9a-fA-F]{66,})/u, h);
  const initBurnTxHash = m(/initiateBurn txId=[0-9a-fA-F]{66,}\s+txHash=([0-9a-fA-F]{64})/u, h)
    ?? m(/initiateBurn\s+txHash=([0-9a-fA-F]{64})/u, h);
  const finBurnTxId = m(/finalizeBurn txId=([0-9a-fA-F]{66,})/u, h);
  const finBurnTxHash = m(/finalizeBurn txId=[0-9a-fA-F]{66,}\s+txHash=([0-9a-fA-F]{64})/u, h)
    ?? m(/finalizeBurn\s+txHash=([0-9a-fA-F]{64})/u, h);
  const sendUnshTxId = m(/sendWrappedUnshielded(?:ToUser)? txId=([0-9a-fA-F]{66,})/u, h);
  const sendUnshTxHash = m(/sendWrappedUnshielded(?:ToUser)? txId=[0-9a-fA-F]{66,}\s+txHash=([0-9a-fA-F]{64})/u, h)
    ?? m(/sendWrappedUnshielded(?:ToUser)?\s+txHash=([0-9a-fA-F]{64})/u, h);
  const verifyEvtTxId = m(/verifyBridgeEvent txId=([0-9a-fA-F]{66,})/u, h);
  const verifyEvtTxHash = m(/verifyBridgeEvent txId=[0-9a-fA-F]{66,}\s+txHash=([0-9a-fA-F]{64})/u, h)
    ?? m(/verifyBridgeEvent\s+txHash=([0-9a-fA-F]{64})/u, h);

  const hasMidnight = contract || proveTxId || proveTxHash || mintTxId || mintTxHash
    || initBurnTxId || initBurnTxHash || finBurnTxId || finBurnTxHash
    || sendUnshTxId || sendUnshTxHash || verifyEvtTxId || verifyEvtTxHash;

  if (hasMidnight) {
    const mkEntry = (id?: string, hash?: string) =>
      id || hash ? { ...(id ? { txId: id } : {}), ...(hash ? { txHash: hash } : {}) } : undefined;
    out.midnight = {
      ...(contract ? { contract } : {}),
      ...(proveTxId || proveTxHash ? { proveHolder: mkEntry(proveTxId, proveTxHash) } : {}),
      ...(mintTxId || mintTxHash ? { mintWrappedUnshielded: mkEntry(mintTxId, mintTxHash) } : {}),
      ...(initBurnTxId || initBurnTxHash ? { initiateBurn: mkEntry(initBurnTxId, initBurnTxHash) } : {}),
      ...(finBurnTxId || finBurnTxHash ? { finalizeBurn: mkEntry(finBurnTxId, finBurnTxHash) } : {}),
      ...(sendUnshTxId || sendUnshTxHash ? { sendWrappedUnshielded: mkEntry(sendUnshTxId, sendUnshTxHash) } : {}),
      ...(verifyEvtTxId || verifyEvtTxHash ? { verifyBridgeEvent: mkEntry(verifyEvtTxId, verifyEvtTxHash) } : {}),
    };
  }

  return out;
}

