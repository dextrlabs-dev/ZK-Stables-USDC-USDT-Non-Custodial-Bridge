export type ParsedDestinationTxs = {
  evm?: { unlockTx?: string; mintTx?: string };
  cardano?: { payoutTx?: string; unlockTx?: string };
  midnight?: {
    contract?: string;
    proveHolder?: { txId?: string; txHash?: string };
    mintWrappedUnshielded?: { txId?: string; txHash?: string };
  };
};

function m(re: RegExp, s: string): string | undefined {
  const x = re.exec(s);
  return x?.[1];
}

export function parseDestinationHintTxs(hint: string | undefined): ParsedDestinationTxs {
  const h = hint ?? '';
  const out: ParsedDestinationTxs = {};

  const unlockTx = m(/Unlock tx:\s*(0x[a-fA-F0-9]{64})/u, h);
  const mintTx = m(/Auto-mint tx:\s*(0x[a-fA-F0-9]{64})/u, h);
  if (unlockTx || mintTx) out.evm = { ...(unlockTx ? { unlockTx } : {}), ...(mintTx ? { mintTx } : {}) };

  const cardanoPayout = m(/Cardano payout tx:\s*([0-9a-fA-F]{64})/u, h);
  const cardanoUnlockPayout = m(/Cardano unlock\/payout tx:\s*([0-9a-fA-F]{64})/u, h);
  if (cardanoPayout || cardanoUnlockPayout) {
    out.cardano = {
      ...(cardanoPayout ? { payoutTx: cardanoPayout } : {}),
      ...(cardanoUnlockPayout ? { unlockTx: cardanoUnlockPayout } : {}),
    };
  }

  const contract = m(/Contract\s+([0-9a-fA-F]{64})/u, h);
  const proveTxId = m(/proveHolder txId=([0-9a-fA-F]{66,})/u, h);
  const proveTxHash = m(/proveHolder txId=[0-9a-fA-F]{66,}\s+txHash=([0-9a-fA-F]{64})/u, h);
  const mintTxId = m(/mintWrappedUnshielded txId=([0-9a-fA-F]{66,})/u, h);
  const mintTxHash = m(/mintWrappedUnshielded txId=[0-9a-fA-F]{66,}\s+txHash=([0-9a-fA-F]{64})/u, h);
  if (contract || proveTxId || proveTxHash || mintTxId || mintTxHash) {
    out.midnight = {
      ...(contract ? { contract } : {}),
      ...(proveTxId || proveTxHash ? { proveHolder: { ...(proveTxId ? { txId: proveTxId } : {}), ...(proveTxHash ? { txHash: proveTxHash } : {}) } } : {}),
      ...(mintTxId || mintTxHash
        ? { mintWrappedUnshielded: { ...(mintTxId ? { txId: mintTxId } : {}), ...(mintTxHash ? { txHash: mintTxHash } : {}) } }
        : {}),
    };
  }

  return out;
}

