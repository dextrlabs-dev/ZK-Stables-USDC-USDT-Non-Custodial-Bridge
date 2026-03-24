import type { Address, Hex, TransactionReceipt } from 'viem';
import { decodeEventLog, isAddress, parseAbiItem, parseUnits } from 'viem';

/** 64-char hex (no 0x), for `bytes32` burn commitment / nonce entropy. */
export function randomBytes32Hex(): string {
  const b = new Uint8Array(32);
  try {
    const g = globalThis.crypto?.getRandomValues;
    if (typeof g === 'function') {
      g.call(globalThis.crypto, b);
      return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    /* fall through — some embedded / legacy contexts reject getRandomValues */
  }
  for (let i = 0; i < 32; i++) {
    b[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export type ParsedZkBurnArgs =
  | { ok: false; message: string }
  | { ok: true; amountRaw: bigint; recipient: Address; burnCommitment: Hex };

/** Validate amount (6 decimals), EVM recipient, and 32-byte burn commitment for `ZkStablesWrappedToken.burn`. */
export function parseZkStableBurnForm(
  amountStr: string,
  recipientTrimmed: string,
  burnCommitmentField: string,
): ParsedZkBurnArgs {
  const bc = burnCommitmentField.replace(/^0x/i, '').trim();
  if (bc.length !== 64 || !/^[0-9a-fA-F]+$/u.test(bc)) {
    return { ok: false, message: 'Burn commitment must be exactly 64 hex characters (32 bytes), matching burn(..., burnCommitment).' };
  }
  const r = recipientTrimmed.trim();
  if (!isAddress(r)) {
    return { ok: false, message: 'Recipient must be a valid 0x address (where unlocked funds go on the source chain).' };
  }
  let raw: bigint;
  try {
    raw = parseUnits(amountStr.trim() || '0', 6);
  } catch {
    return { ok: false, message: 'Amount must be a decimal number (6 decimals for demo zk tokens).' };
  }
  if (raw <= 0n) {
    return { ok: false, message: 'Amount must be greater than zero.' };
  }
  return { ok: true, amountRaw: raw, recipient: r as Address, burnCommitment: `0x${bc}` as Hex };
}

const burnedEvent = parseAbiItem(
  'event Burned(address indexed from,address indexed recipientOnSource,uint256 amount,bytes32 nonce,bytes32 burnCommitment)',
);

const lockedEvent = parseAbiItem(
  'event Locked(address indexed token,address indexed sender,address indexed recipient,uint256 amount,bytes32 nonce)',
);

export type ParsedLocked = {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  token: Address;
  sender: Address;
  recipient: Address;
  amount: bigint;
  nonce: Hex;
};

/** Decode `ZkStablesPoolLock.Locked` from the lock() transaction receipt. */
export function parseLockedFromReceipt(receipt: TransactionReceipt, poolLockAddress: Address): ParsedLocked | null {
  const want = poolLockAddress.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== want) continue;
    try {
      const decoded = decodeEventLog({
        abi: [lockedEvent],
        data: log.data,
        topics: log.topics,
        strict: false,
      });
      if (decoded.eventName !== 'Locked') continue;
      const a = decoded.args as {
        token: Address;
        sender: Address;
        recipient: Address;
        amount: bigint;
        nonce: Hex;
      };
      return {
        txHash: receipt.transactionHash,
        logIndex: log.logIndex,
        blockNumber: receipt.blockNumber,
        token: a.token,
        sender: a.sender,
        recipient: a.recipient,
        amount: a.amount,
        nonce: a.nonce,
      };
    } catch {
      /* wrong log */
    }
  }
  return null;
}

export type ParsedBurned = {
  burnCommitmentHex: string;
  amount: string;
  recipientOnSource: Address;
  nonce: Hex;
  from: Address;
};

/** Decode first `Burned` log from zkUSDC/zkUSDT (`ZkStablesWrappedToken`) receipt. */
export function parseBurnedFromReceipt(receipt: TransactionReceipt, wrappedToken: Address): ParsedBurned | null {
  const want = wrappedToken.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== want) continue;
    try {
      const decoded = decodeEventLog({
        abi: [burnedEvent],
        data: log.data,
        topics: log.topics,
        strict: false,
      });
      if (decoded.eventName !== 'Burned') continue;
      const a = decoded.args as {
        from: Address;
        recipientOnSource: Address;
        amount: bigint;
        nonce: Hex;
        burnCommitment: Hex;
      };
      const bc = a.burnCommitment.replace(/^0x/i, '');
      if (bc.length !== 64) continue;
      return {
        burnCommitmentHex: bc,
        amount: a.amount.toString(),
        recipientOnSource: a.recipientOnSource,
        nonce: a.nonce,
        from: a.from,
      };
    } catch {
      /* wrong log */
    }
  }
  return null;
}

/** Minimal ERC-20 `balanceOf` for zkUSDC/zkUSDT (`ZkStablesWrappedToken`). */
export const erc20BalanceOfAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export const zkStableBurnAbi = [
  {
    type: 'function',
    name: 'burn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'recipientOnSource', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'burnCommitment', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

export const erc20ApproveAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

export const poolLockAbi = [
  {
    type: 'function',
    name: 'lock',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

/** Turn `ZkStablesWrappedToken.burn` RPC errors into clearer next steps (e.g. empty zk balance on fresh deploy). */
export function formatZkBurnWalletError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/reason string ['"]balance['"]/u.test(msg) || /VM Exception.*\bbalance\b/u.test(msg)) {
    return `${msg} — Insufficient zkUSDC/zkUSDT balance. Complete a Mint (lock → bridge mint) first, or check your token balance.`;
  }
  return msg;
}
