import type { LockIntent } from '../types.js';

function isHexTxHash(h: unknown): h is `0x${string}` {
  return typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/u.test(h);
}

/** Normalize `source.evm` from JSON (logIndex may arrive as string). Returns error message or null if OK. */
export function validateAndNormalizeEvmLockSource(body: LockIntent): string | null {
  if (body.sourceChain !== 'evm') return null;

  const ev = body.source?.evm;
  if (!ev) {
    return (
      'EVM LOCK requires an on-chain pool lock: include source.evm { txHash, logIndex, blockNumber } from your ZkStablesPoolLock.lock transaction, ' +
      'or let the relayer ingest the Locked event (RELAYER_EVM_LOCK_ADDRESS). HTTP intents cannot mint without that anchor.'
    );
  }

  if (!isHexTxHash(ev.txHash)) {
    return 'source.evm.txHash must be a 0x-prefixed 64-character hex string (32-byte tx hash).';
  }
  const txNorm = ev.txHash.trim().toLowerCase() as `0x${string}`;
  (body.source!.evm as { txHash: `0x${string}` }).txHash = txNorm;

  const liRaw = ev.logIndex as unknown;
  let logIndex: number;
  if (typeof liRaw === 'number') {
    logIndex = liRaw;
  } else if (typeof liRaw === 'string' && liRaw.trim() !== '') {
    logIndex = Number.parseInt(liRaw, 10);
  } else {
    return 'source.evm.logIndex must be a non-negative integer (log index of the Locked event).';
  }
  if (!Number.isInteger(logIndex) || logIndex < 0) {
    return 'source.evm.logIndex must be a non-negative integer (log index of the Locked event).';
  }
  (body.source!.evm as { logIndex: number }).logIndex = logIndex;

  const bn = ev.blockNumber as unknown;
  if (bn === undefined || bn === null || String(bn).trim() === '') {
    return 'source.evm.blockNumber is required (block where the lock transaction was mined).';
  }
  (body.source!.evm as { blockNumber: string }).blockNumber = String(bn).trim();

  return null;
}
