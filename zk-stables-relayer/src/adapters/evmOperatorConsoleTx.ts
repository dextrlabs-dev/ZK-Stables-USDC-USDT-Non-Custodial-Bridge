/**
 * One-click EVM txs for the operator console: pool `lock` (mint path) and wrapped `burn` (EVM redeem path).
 * Gated by RELAYER_OPERATOR_CONSOLE_EVM_TX=1|true|yes plus RELAYER_EVM_PRIVATE_KEY + addresses.
 */
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
import { resolveUnderlyingTokenForAsset } from './evmUnderlying.js';

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

function isLikelyCardanoPaymentAddress(addr: string): boolean {
  const t = addr.trim();
  return (t.startsWith('addr1') || t.startsWith('addr_test1')) && t.length >= 50;
}

/**
 * Pool lock `recipient` on EVM: real 0x for EVM dest; else signer (bridge handoff) for Cardano/Midnight intents.
 */
export function resolvePoolLockRecipient(
  destination: 'cardano' | 'midnight' | 'evm',
  recipientIntent: string,
  signerAddress: Address,
): Address {
  const r = recipientIntent.trim();
  if (destination === 'evm') {
    if (!isAddress(r)) throw new Error('For destination evm, recipient must be a 0x address.');
    return r as Address;
  }
  if (destination === 'cardano' && !isLikelyCardanoPaymentAddress(r)) {
    throw new Error('For destination cardano, recipient must be a Cardano payment address (addr_test1… or addr1…).');
  }
  if (destination === 'midnight') {
    if (isAddress(r) || isLikelyCardanoPaymentAddress(r)) {
      throw new Error('For destination midnight, recipient must be a Midnight address (not 0x / Cardano).');
    }
  }
  return signerAddress;
}

function isOperatorConsoleAll(): boolean {
  const v = (process.env.RELAYER_OPERATOR_CONSOLE_ALL ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function isRelayerEvmOperatorConsoleTxEnabled(): boolean {
  const v = (process.env.RELAYER_OPERATOR_CONSOLE_EVM_TX ?? '').trim().toLowerCase();
  if (v !== '1' && v !== 'true' && v !== 'yes' && !isOperatorConsoleAll()) return false;
  const pk = process.env.RELAYER_EVM_PRIVATE_KEY?.trim();
  const pool = process.env.RELAYER_EVM_LOCK_ADDRESS?.trim();
  return Boolean(pk && /^0x[0-9a-fA-F]{64}$/u.test(pk) && pool?.startsWith('0x'));
}

function rpcUrl(): string {
  return process.env.RELAYER_EVM_RPC_URL ?? 'http://127.0.0.1:8545';
}

function poolLockAddress(): Address {
  const p = process.env.RELAYER_EVM_LOCK_ADDRESS?.trim() as Address | undefined;
  if (!p || !p.startsWith('0x')) throw new Error('RELAYER_EVM_LOCK_ADDRESS not set');
  return p;
}

function privateKey(): `0x${string}` {
  const pk = process.env.RELAYER_EVM_PRIVATE_KEY?.trim() as `0x${string}`;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/u.test(pk)) throw new Error('RELAYER_EVM_PRIVATE_KEY invalid');
  return pk;
}

function wrappedForAsset(asset: 'USDC' | 'USDT'): Address {
  const usdc = process.env.RELAYER_EVM_WRAPPED_TOKEN_USDC?.trim() as Address | undefined;
  const usdt = process.env.RELAYER_EVM_WRAPPED_TOKEN_USDT?.trim() as Address | undefined;
  const legacy = process.env.RELAYER_EVM_WRAPPED_TOKEN?.trim() as Address | undefined;
  if (asset === 'USDT') {
    const w = usdt ?? legacy;
    if (!w?.startsWith('0x')) throw new Error('Set RELAYER_EVM_WRAPPED_TOKEN_USDT or RELAYER_EVM_WRAPPED_TOKEN');
    return w as Address;
  }
  const w = usdc ?? legacy;
  if (!w?.startsWith('0x')) throw new Error('Set RELAYER_EVM_WRAPPED_TOKEN_USDC or RELAYER_EVM_WRAPPED_TOKEN');
  return w as Address;
}

function parseLockedFromReceipt(receipt: TransactionReceipt, poolLockAddress: Address) {
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

function parseBurnedFromReceiptWithIndex(receipt: TransactionReceipt, wrappedToken: Address) {
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

export async function relayerEvmExecutePoolLock(params: {
  asset: 'USDC' | 'USDT';
  amountHuman: string;
  destination: 'cardano' | 'midnight' | 'evm';
  recipientIntent: string;
}): Promise<{
  approveTxHash: Hex;
  lockTxHash: Hex;
  locked: {
    txHash: Hex;
    logIndex: number;
    blockNumber: string;
    poolLockAddress: Address;
    token: Address;
    nonce: Hex;
    recipient: Address;
    amountRaw: string;
  };
}> {
  if (!isRelayerEvmOperatorConsoleTxEnabled()) {
    throw new Error('RELAYER_OPERATOR_CONSOLE_EVM_TX is not enabled (set to 1/true) or EVM signer / pool not configured');
  }
  const underlying = resolveUnderlyingTokenForAsset(params.asset);
  if (!underlying) {
    throw new Error('Underlying token not configured — set RELAYER_EVM_UNDERLYING_TOKEN (and RELAYER_EVM_UNDERLYING_TOKEN_USDT for USDT)');
  }
  const pool = poolLockAddress();
  const pk = privateKey();
  const account = privateKeyToAccount(pk);
  const wc = createWalletClient({ account, chain: foundry, transport: http(rpcUrl()) });
  const pub = createPublicClient({ chain: foundry, transport: http(rpcUrl()) });
  const decimals = Number(process.env.RELAYER_EVM_TOKEN_DECIMALS ?? process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);
  const raw = parseUnits(params.amountHuman.trim(), decimals);
  const evmLockRecipient = resolvePoolLockRecipient(params.destination, params.recipientIntent, wc.account.address);

  const approveHash = await wc.writeContract({
    address: underlying,
    abi: erc20ApproveAbi,
    functionName: 'approve',
    args: [pool, raw],
  });
  await pub.waitForTransactionReceipt({ hash: approveHash });

  const nonce = `0x${randomBytes32Hex()}` as Hex;
  const lockHash = await wc.writeContract({
    address: pool,
    abi: poolLockAbi,
    functionName: 'lock',
    args: [underlying, raw, evmLockRecipient, nonce],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: lockHash });
  const parsed = parseLockedFromReceipt(receipt, pool);
  if (!parsed) {
    throw new Error('Lock transaction confirmed but no Locked event found for RELAYER_EVM_LOCK_ADDRESS');
  }
  if (parsed.token.toLowerCase() !== underlying.toLowerCase()) {
    throw new Error('Locked token does not match configured underlying for this asset');
  }
  if (parsed.amount !== raw) {
    throw new Error('Locked amount does not match requested amount');
  }
  return {
    approveTxHash: approveHash,
    lockTxHash: lockHash,
    locked: {
      txHash: parsed.txHash,
      logIndex: parsed.logIndex,
      blockNumber: parsed.blockNumber.toString(),
      poolLockAddress: pool,
      token: parsed.token,
      nonce: parsed.nonce,
      recipient: parsed.recipient,
      amountRaw: parsed.amount.toString(),
    },
  };
}

export async function relayerEvmExecuteWrappedBurn(params: {
  asset: 'USDC' | 'USDT';
  amountHuman: string;
  payoutAddress: Address;
  burnCommitmentHex?: string;
}): Promise<{
  burnTxHash: Hex;
  burnCommitmentHex: string;
  burned: {
    txHash: Hex;
    logIndex: number;
    blockNumber: string;
    wrappedTokenAddress: Address;
    nonce: Hex;
    fromAddress: Address;
  };
}> {
  if (!isRelayerEvmOperatorConsoleTxEnabled()) {
    throw new Error('RELAYER_OPERATOR_CONSOLE_EVM_TX is not enabled (set to 1/true) or EVM signer / pool not configured');
  }
  const wrapped = wrappedForAsset(params.asset);
  const pk = privateKey();
  const account = privateKeyToAccount(pk);
  const wc = createWalletClient({ account, chain: foundry, transport: http(rpcUrl()) });
  const pub = createPublicClient({ chain: foundry, transport: http(rpcUrl()) });
  const decimals = Number(process.env.RELAYER_EVM_TOKEN_DECIMALS ?? process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);
  const raw = parseUnits(params.amountHuman.trim(), decimals);
  const bcHex = (params.burnCommitmentHex ?? randomBytes32Hex()).replace(/^0x/i, '');
  if (bcHex.length !== 64 || !/^[0-9a-f]+$/iu.test(bcHex)) {
    throw new Error('burnCommitmentHex must be 64 hex chars when provided');
  }
  const burnCommitment = `0x${bcHex}` as Hex;
  const nonce = `0x${randomBytes32Hex()}` as Hex;

  const burnHash = await wc.writeContract({
    address: wrapped,
    abi: zkStableBurnAbi,
    functionName: 'burn',
    args: [raw, params.payoutAddress, nonce, burnCommitment],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: burnHash });
  const withIx = parseBurnedFromReceiptWithIndex(receipt, wrapped);
  if (!withIx) {
    throw new Error(
      'Burn transaction confirmed but no Burned event found on the wrapped token — check RELAYER_EVM_WRAPPED_TOKEN_* matches the contract you burned',
    );
  }
  return {
    burnTxHash: burnHash,
    burnCommitmentHex: bcHex.toLowerCase(),
    burned: {
      txHash: receipt.transactionHash,
      logIndex: withIx.logIndex,
      blockNumber: (withIx.blockNumber ?? receipt.blockNumber ?? 0n).toString(),
      wrappedTokenAddress: wrapped,
      nonce: withIx.parsed.nonce,
      fromAddress: withIx.parsed.from,
    },
  };
}
