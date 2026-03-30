/**
 * zk-stables-relayer HTTP client (bridge intents, jobs, demo wallets).
 */

import { AssetKind } from '../constants/zk-stables.js';
import type { SourceChainKind } from '../contexts/CrossChainWalletContext.js';

export const defaultRelayerBaseUrl = (): string =>
  (import.meta.env.VITE_RELAYER_URL && String(import.meta.env.VITE_RELAYER_URL).trim()) || 'http://127.0.0.1:8787';

export type DemoEvmAccount = {
  index: number;
  path: string;
  address: `0x${string}`;
  privateKey?: `0x${string}`;
};

export type DemoWalletsResponse = {
  enabled: true;
  demoBalances: { usdc: string; usdt: string };
  evm: { mnemonic?: string; accounts: DemoEvmAccount[] };
  cardano: {
    mnemonic?: string;
    addresses: { role: 'source' | 'destination'; bech32: string; paymentCredHex?: string }[];
  };
  midnight: {
    mnemonic?: string;
    shieldedExample: string;
    unshieldedExample: string;
    note: string;
  };
  warning: string;
};

export type RelayerJobApi = {
  id: string;
  intent: {
    operation: 'LOCK' | 'BURN';
    sourceChain: SourceChainKind;
    destinationChain?: string;
    asset: 'USDC' | 'USDT';
    assetKind: number;
    amount: string;
    recipient: string;
    burnCommitmentHex?: string;
    connected?: Record<string, unknown>;
    note?: string;
    source?: unknown;
  };
  phase: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  lockRef: string;
  proofBundle?: {
    algorithm: string;
    digest: string;
    publicInputsHex: string;
    inclusion?: Record<string, unknown>;
    midnight?: {
      txHash: string;
      txId: string;
      contractAddress: string;
      operationType: string;
      depositCommitmentHex: string;
      eventCommitmentHex: string;
      nonceCommitmentHex: string;
    };
  };
  destinationHint?: string;
  depositCommitmentHex?: string;
  ui?: {
    phaseLabel: string;
    phaseIndex: number;
    phaseCount: number;
  };
};

export type RelayerHealthChains = {
  evm?: { ok?: boolean; rpcUrl?: string; blockNumber?: string | number };
  midnightIndexer?: { ok?: boolean; url?: string };
  cardano?: { provider?: string; ok?: boolean; skipped?: boolean; note?: string };
  relayerBridge?: { evm?: boolean; cardano?: boolean; midnight?: boolean };
};

export async function fetchChainHealth(baseUrl: string): Promise<RelayerHealthChains | null> {
  const base = baseUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/v1/health/chains`);
    if (!res.ok) return null;
    return (await res.json()) as RelayerHealthChains;
  } catch {
    return null;
  }
}

export async function fetchDemoWallets(baseUrl: string): Promise<DemoWalletsResponse | null> {
  const base = baseUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/v1/demo/wallets`);
    if (!res.ok) return null;
    return (await res.json()) as DemoWalletsResponse;
  } catch {
    return null;
  }
}

export async function listRelayerJobs(baseUrl: string): Promise<RelayerJobApi[]> {
  const base = baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/v1/jobs`);
  if (!res.ok) return [];
  const data = (await res.json()) as { jobs?: RelayerJobApi[] };
  return data.jobs ?? [];
}

export async function getRelayerJob(baseUrl: string, id: string): Promise<RelayerJobApi | null> {
  const base = baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/v1/jobs/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return (await res.json()) as RelayerJobApi;
}

export type LockIntentPayload = {
  operation: 'LOCK';
  sourceChain: SourceChainKind;
  destinationChain?: string;
  asset: 'USDC' | 'USDT';
  assetKind: number;
  amount: string;
  recipient: string;
  connected?: Record<string, unknown>;
  note?: string;
  /** Required for EVM → zk mint: anchor from on-chain `ZkStablesPoolLock.lock` (relayer proves `Locked` in the tx). */
  source?: {
    evm?: {
      txHash: `0x${string}`;
      logIndex: number;
      blockNumber: string;
      poolLockAddress?: `0x${string}`;
      token?: `0x${string}`;
      nonce?: `0x${string}`;
    };
  };
};

export type BurnIntentPayload = {
  operation: 'BURN';
  sourceChain: SourceChainKind;
  destinationChain?: string;
  asset: 'USDC' | 'USDT';
  assetKind: number;
  amount: string;
  recipient: string;
  burnCommitmentHex: string;
  connected?: Record<string, unknown>;
  note?: string;
  source?: {
    evm?: Record<string, unknown>;
    cardano?: {
      txHash: string;
      outputIndex: number;
      blockHeight?: string;
      lockNonce?: string;
      spendTxHash?: string;
    };
    midnight?: {
      txId?: string;
      txHash?: string;
      contractAddress?: string;
      destChainId?: number;
      lockNonce?: string;
      /** Ledger deposit key (64 hex); required with holder `initiateBurn` tx id for relayer finalize path. */
      depositCommitmentHex?: string;
    };
  };
};

export async function submitLockIntent(baseUrl: string, body: LockIntentPayload): Promise<{ job: RelayerJobApi; jobId: string }> {
  const base = baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/v1/intents/lock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { job?: RelayerJobApi; jobId?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  if (!data.job?.id || !data.jobId) throw new Error('Relayer did not return a job');
  return { job: data.job, jobId: data.jobId };
}

export async function submitBurnIntent(baseUrl: string, body: BurnIntentPayload): Promise<{ job: RelayerJobApi; jobId: string }> {
  const base = baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/v1/intents/burn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { job?: RelayerJobApi; jobId?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  if (!data.job?.id || !data.jobId) throw new Error('Relayer did not return a job');
  return { job: data.job, jobId: data.jobId };
}

export function assetKindForLabel(asset: 'USDC' | 'USDT'): number {
  return asset === 'USDC' ? AssetKind.USDC : AssetKind.USDT;
}

export async function fetchMidnightContract(baseUrl: string): Promise<{ contractAddress: string | null; enabled: boolean }> {
  const base = baseUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/v1/midnight/contract`);
    if (!res.ok) return { contractAddress: null, enabled: false };
    return (await res.json()) as { contractAddress: string | null; enabled: boolean };
  } catch {
    return { contractAddress: null, enabled: false };
  }
}
