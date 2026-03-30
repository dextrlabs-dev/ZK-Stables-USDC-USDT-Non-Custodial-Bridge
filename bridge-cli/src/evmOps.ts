import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  isAddress,
  parseAbiItem,
  parseUnits,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import type { BridgeCliEnv } from './config.js';

const lockedEvent = parseAbiItem(
  'event Locked(address indexed token,address indexed sender,address indexed recipient,uint256 amount,bytes32 nonce)',
);

const burnedEvent = parseAbiItem(
  'event Burned(address indexed from,address indexed recipientOnSource,uint256 amount,bytes32 nonce,bytes32 burnCommitment)',
);

const erc20ApproveAbi = [
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

const poolLockAbi = [
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

const zkStableBurnAbi = [
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

export function randomBytes32Hex(): string {
  const b = new Uint8Array(32);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(b);
  } else {
    for (let i = 0; i < 32; i++) b[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

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
      /* skip */
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

export function parseBurnedFromReceipt(receipt: TransactionReceipt, wrappedToken: Address): ParsedBurned | null {
  const r = parseBurnedFromReceiptWithIndex(receipt, wrappedToken);
  return r?.parsed ?? null;
}

/** First `Burned` log on `wrappedToken` with its `logIndex` (for relayer `source.evm`). */
export function parseBurnedFromReceiptWithIndex(
  receipt: TransactionReceipt,
  wrappedToken: Address,
): { parsed: ParsedBurned; logIndex: number; blockNumber: bigint } | null {
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
        parsed: {
          burnCommitmentHex: bc,
          amount: a.amount.toString(),
          recipientOnSource: a.recipientOnSource,
          nonce: a.nonce,
          from: a.from,
        },
        logIndex: log.logIndex,
        blockNumber: receipt.blockNumber,
      };
    } catch {
      /* skip */
    }
  }
  return null;
}

function walletClient(env: BridgeCliEnv) {
  const account = privateKeyToAccount(env.privateKey);
  return createWalletClient({ account, chain: foundry, transport: http(env.rpcUrl) });
}

function publicClient(env: BridgeCliEnv) {
  return createPublicClient({ chain: foundry, transport: http(env.rpcUrl) });
}

export function isLikelyCardanoPaymentAddress(addr: string): boolean {
  const t = addr.trim();
  return (t.startsWith('addr1') || t.startsWith('addr_test1')) && t.length >= 50;
}

/**
 * EVM `ZkStablesPoolLock.lock` recipient: EVM signer for Cardano/Midnight destinations (relayer uses HTTP `recipient` for payout).
 */
export function resolvePoolLockRecipient(dest: 'cardano' | 'midnight' | 'evm', formRecipient: string, signerAddress: Address): Address {
  const r = formRecipient.trim();
  if (dest === 'evm') {
    if (!isAddress(r)) throw new Error('For --destination evm, --recipient must be a 0x address.');
    return r as Address;
  }
  if (dest === 'cardano' && !isLikelyCardanoPaymentAddress(r)) {
    throw new Error('For --destination cardano, --recipient must be a Cardano payment address (addr_test1… or addr1…).');
  }
  if (dest === 'midnight') {
    if (isAddress(r) || isLikelyCardanoPaymentAddress(r)) {
      throw new Error('For --destination midnight, --recipient must be a Midnight address (not 0x / Cardano).');
    }
  }
  return signerAddress;
}

export async function evmApproveAndLock(params: {
  env: BridgeCliEnv;
  asset: 'USDC' | 'USDT';
  amountHuman: string;
  destination: 'cardano' | 'midnight' | 'evm';
  recipientIntent: string;
}): Promise<{ receipt: TransactionReceipt; parsed: ParsedLocked; lockHash: Hex }> {
  const { env, asset, amountHuman, destination, recipientIntent } = params;
  const wc = walletClient(env);
  const signerAddress = wc.account.address;
  const underlying = asset === 'USDT' ? env.usdtUnderlying : env.usdcUnderlying;
  const evmLockRecipient = resolvePoolLockRecipient(destination, recipientIntent, signerAddress);
  const raw = parseUnits(amountHuman.trim(), 6);

  const approveHash = await wc.writeContract({
    address: underlying,
    abi: erc20ApproveAbi,
    functionName: 'approve',
    args: [env.poolLock, raw],
  });
  const pub = publicClient(env);
  await pub.waitForTransactionReceipt({ hash: approveHash });

  const nonce = `0x${randomBytes32Hex()}` as Hex;
  const lockHash = await wc.writeContract({
    address: env.poolLock,
    abi: poolLockAbi,
    functionName: 'lock',
    args: [underlying, raw, evmLockRecipient, nonce],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: lockHash });
  const parsed = parseLockedFromReceipt(receipt, env.poolLock);
  if (!parsed) {
    throw new Error('Lock transaction confirmed but no Locked event was found for BRIDGE_CLI_POOL_LOCK_ADDRESS.');
  }
  if (parsed.token.toLowerCase() !== underlying.toLowerCase()) {
    throw new Error('Locked token does not match selected asset underlying address.');
  }
  if (parsed.amount !== raw) {
    throw new Error('Locked amount does not match requested amount.');
  }
  return { receipt, parsed, lockHash };
}

export async function evmBurnZk(params: {
  env: BridgeCliEnv;
  asset: 'USDC' | 'USDT';
  amountHuman: string;
  payoutAddress: Address;
  burnCommitment?: Hex;
}): Promise<{ receipt: TransactionReceipt; parsed: ParsedBurned | null; burnHash: Hex; burnCommitment: Hex }> {
  const { env, asset, amountHuman, payoutAddress, burnCommitment: bcIn } = params;
  const wrapped = asset === 'USDT' ? env.zkUsdt : env.zkUsdc;
  const wc = walletClient(env);
  const pub = publicClient(env);
  const raw = parseUnits(amountHuman.trim(), 6);
  const burnCommitment = bcIn ?? (`0x${randomBytes32Hex()}` as Hex);
  const nonce = `0x${randomBytes32Hex()}` as Hex;

  const burnHash = await wc.writeContract({
    address: wrapped,
    abi: zkStableBurnAbi,
    functionName: 'burn',
    args: [raw, payoutAddress, nonce, burnCommitment],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: burnHash });
  const parsed = parseBurnedFromReceipt(receipt, wrapped);
  return { receipt, parsed, burnHash, burnCommitment };
}
