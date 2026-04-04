const LS_KEY = 'zk-stables-relayer-url';

export function getRelayerBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const fromLs = window.localStorage.getItem(LS_KEY)?.trim();
    if (fromLs) return fromLs.replace(/\/$/, '');
  }
  return (import.meta.env.VITE_RELAYER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
}

export function setRelayerBaseUrl(url: string): void {
  window.localStorage.setItem(LS_KEY, url.replace(/\/$/, ''));
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getRelayerBaseUrl();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg =
      typeof body === 'object' && body && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : text.slice(0, 400);
    throw new Error(`${res.status} ${path}: ${msg}`);
  }
  return body as T;
}

export type HealthChains = Record<string, unknown>;

export type Recipients = {
  evmRecipient?: string;
  cardanoRecipient?: string;
  midnightRecipient?: string;
};

export type ConsoleUtxoRow = {
  ref: string;
  txHash: string;
  outputIndex: number;
  amount: Array<{ unit: string; quantity: string }>;
};

export type EvmLockAnchor = {
  jobId: string;
  txHash: string;
  logIndex: number;
  blockNumber?: string;
  poolLockAddress?: string;
  token?: string;
  nonce?: string;
  asset: string;
  amount: string;
  destinationChain?: string;
  createdAt: string;
  phase: string;
};

/** Row from `GET /v1/evm/recent-locks` (on-chain `Locked` log). */
export type EvmResolvedLock = {
  txHash: string;
  logIndex: number;
  blockNumber: string;
  poolLockAddress: string;
  token: string;
  nonce: string;
  recipient: string;
  amountRaw: string;
  asset: string;
};

export async function fetchRecentEvmLocks(asset: string, amount: string) {
  const q = new URLSearchParams({ asset: asset.trim(), amount: amount.trim() });
  return j<{
    locks: EvmResolvedLock[];
    count: number;
    scanned?: { fromBlock: string; toBlock: string };
    want?: unknown;
    error?: string;
  }>(`/v1/evm/recent-locks?${q.toString()}`);
}

/** On-chain `lock_pool` UTxOs matching amount + asset (no in-memory BURN job required). */
export async function fetchRecentCardanoBurnHints(asset: string, amount: string) {
  const q = new URLSearchParams({ asset: asset.trim(), amount: amount.trim() });
  return j<{
    hints: CardanoBurnHint[];
    count: number;
    scanNote?: string;
    lockScriptAddress?: string;
    indexer?: string;
    want?: unknown;
  }>(`/v1/cardano/recent-burn-hints?${q.toString()}`);
}

/** On-chain wrapped-token `Burned` logs matching amount + asset. */
export async function fetchRecentEvmBurnHints(asset: string, amount: string) {
  const q = new URLSearchParams({ asset: asset.trim(), amount: amount.trim() });
  return j<{
    hints: EvmBurnHint[];
    count: number;
    scanNote?: string;
    scanned?: { fromBlock: string; toBlock: string };
    want?: unknown;
  }>(`/v1/evm/recent-burn-hints?${q.toString()}`);
}

export type CardanoBurnHint = {
  jobId: string;
  asset: string;
  amount: string;
  recipient: string;
  burnCommitmentHex: string;
  cardano: {
    txHash: string;
    outputIndex: number;
    spendTxHash?: string;
    lockNonce?: string;
    blockHeight?: string;
    scriptHash?: string;
    policyIdHex?: string;
    assetNameHex?: string;
  };
  createdAt: string;
  phase: string;
};

export type MidnightBurnHint = {
  jobId: string;
  asset: string;
  amount: string;
  recipient: string;
  burnCommitmentHex: string;
  midnight: {
    txId?: string;
    txHash?: string;
    destChainId?: number;
    depositCommitmentHex?: string;
    contractAddress?: string;
    lockNonce?: string;
  };
  createdAt: string;
  phase: string;
};

/** Registry ledger rows + job-linked exit-pending rows (GET /v1/midnight/recent-burn-hints). */
export async function fetchRecentMidnightBurnHints(asset: string, amount: string) {
  const q = new URLSearchParams({ asset: asset.trim(), amount: amount.trim() });
  return j<{
    hints: MidnightBurnHint[];
    count: number;
    scanNote?: string;
    contractAddress?: string;
    want?: unknown;
  }>(`/v1/midnight/recent-burn-hints?${q.toString()}`);
}

/** Run registry `initiateBurn` on the relayer (RELAYER_MIDNIGHT_ENABLED; serialized with other Midnight txs). */
export async function postMidnightInitiateBurn(body: {
  depositCommitmentHex: string;
  recipientCommitmentHex: string;
  destChainId?: string | number;
}) {
  return j<{ txId: string; txHash: string; contractAddress: string }>('/v1/midnight/initiate-burn', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export type EvmBurnHint = {
  jobId: string;
  asset: string;
  amount: string;
  recipient: string;
  burnCommitmentHex: string;
  evm: {
    txHash: string;
    logIndex: number;
    blockNumber?: string;
    wrappedTokenAddress?: string;
    nonce?: string;
    fromAddress?: string;
  };
  createdAt: string;
  phase: string;
};

export type BridgeConsoleState = {
  recipients: Recipients & { configured: { evm: boolean; cardano: boolean; midnight: boolean } };
  amountPresets: string[];
  /** When true, relayer accepts POST /v1/evm/execute-lock and /v1/evm/execute-burn (operator EVM key). */
  evmOperatorConsoleTx?: boolean;
  /** POST /v1/cardano/operator/* (Mesh + indexer). */
  cardanoOperatorConsoleTx?: boolean;
  /** POST /v1/midnight/operator/* and wallet bootstrap for operator Midnight. */
  midnightOperatorConsoleTx?: boolean;
  /** `RELAYER_OPERATOR_CONSOLE_ALL` set (umbrella; each chain still has its own prerequisites). */
  operatorConsoleAll?: boolean;
  cardano: {
    operatorWallet: null | {
      changeAddress: string;
      utxos: ConsoleUtxoRow[];
      balancesByUnit: Record<string, string>;
    };
    lockScriptAddress?: string;
    lockScriptUtxos: ConsoleUtxoRow[];
    lockScriptBalancesByUnit: Record<string, string>;
    lockScriptProvider: string | null;
  };
  anchors: {
    evmLockAnchors: EvmLockAnchor[];
    cardanoBurnHints: CardanoBurnHint[];
    midnightBurnHints: MidnightBurnHint[];
    evmBurnHints: EvmBurnHint[];
  };
};

export function fetchHealth() {
  return j<HealthChains>('/v1/health/chains');
}

export function fetchRecipients() {
  return j<Recipients>('/v1/bridge/recipients');
}

type RecipientsApi = Recipients & {
  configured?: { evm: boolean; cardano: boolean; midnight: boolean };
};

type ApiJob = {
  id: string;
  phase: string;
  createdAt: string;
  intent: {
    operation?: string;
    sourceChain?: string;
    destinationChain?: string;
    asset?: string;
    amount?: string;
    recipient?: string;
    burnCommitmentHex?: string;
    source?: {
      evm?: { txHash?: string; logIndex?: unknown; blockNumber?: string; poolLockAddress?: string; token?: string; nonce?: string };
      cardano?: {
        txHash?: string;
        outputIndex?: number;
        spendTxHash?: string;
        lockNonce?: string;
        blockHeight?: string;
        scriptHash?: string;
        policyIdHex?: string;
        assetNameHex?: string;
      };
      midnight?: {
        txId?: string;
        txHash?: string;
        destChainId?: number;
        depositCommitmentHex?: string;
        contractAddress?: string;
        lockNonce?: string;
      };
    };
  };
};

function jobToEvmLockAnchor(job: ApiJob): EvmLockAnchor | null {
  const intent = job.intent;
  if (intent.operation !== 'LOCK' || intent.sourceChain !== 'evm') return null;
  const ev = intent.source?.evm;
  if (!ev?.txHash || ev.logIndex === undefined) return null;
  const logIndex = typeof ev.logIndex === 'number' ? ev.logIndex : Number.parseInt(String(ev.logIndex), 10);
  if (!Number.isFinite(logIndex)) return null;
  return {
    jobId: job.id,
    txHash: String(ev.txHash).toLowerCase(),
    logIndex,
    ...(ev.blockNumber != null && String(ev.blockNumber).trim() !== ''
      ? { blockNumber: String(ev.blockNumber).trim() }
      : {}),
    ...(ev.poolLockAddress ? { poolLockAddress: ev.poolLockAddress } : {}),
    ...(ev.token ? { token: ev.token } : {}),
    ...(ev.nonce ? { nonce: ev.nonce } : {}),
    asset: String(intent.asset ?? ''),
    amount: String(intent.amount ?? ''),
    destinationChain: intent.destinationChain,
    createdAt: job.createdAt,
    phase: job.phase,
  };
}

function jobToCardanoBurnHint(job: ApiJob): CardanoBurnHint | null {
  const intent = job.intent;
  if (intent.operation !== 'BURN' || intent.sourceChain !== 'cardano') return null;
  const c = intent.source?.cardano;
  if (!c?.txHash || c.outputIndex === undefined || !intent.burnCommitmentHex) return null;
  return {
    jobId: job.id,
    asset: String(intent.asset ?? ''),
    amount: String(intent.amount ?? ''),
    recipient: String(intent.recipient ?? ''),
    burnCommitmentHex: intent.burnCommitmentHex.replace(/^0x/i, ''),
    cardano: { ...c, txHash: c.txHash, outputIndex: c.outputIndex },
    createdAt: job.createdAt,
    phase: job.phase,
  };
}

function jobToMidnightBurnHint(job: ApiJob): MidnightBurnHint | null {
  const intent = job.intent;
  if (intent.operation !== 'BURN' || intent.sourceChain !== 'midnight') return null;
  const m = intent.source?.midnight;
  if (!m?.txId?.trim() || !m.depositCommitmentHex) return null;
  if (!intent.burnCommitmentHex) return null;
  return {
    jobId: job.id,
    asset: String(intent.asset ?? ''),
    amount: String(intent.amount ?? ''),
    recipient: String(intent.recipient ?? ''),
    burnCommitmentHex: intent.burnCommitmentHex.replace(/^0x/i, ''),
    midnight: { ...m },
    createdAt: job.createdAt,
    phase: job.phase,
  };
}

function jobToEvmBurnHint(job: ApiJob): EvmBurnHint | null {
  const intent = job.intent;
  if (intent.operation !== 'BURN' || intent.sourceChain !== 'evm') return null;
  const e = intent.source?.evm;
  if (!e?.txHash || e.logIndex === undefined || !intent.burnCommitmentHex) return null;
  const logIndex = typeof e.logIndex === 'number' ? e.logIndex : Number.parseInt(String(e.logIndex), 10);
  if (!Number.isFinite(logIndex)) return null;
  return {
    jobId: job.id,
    asset: String(intent.asset ?? ''),
    amount: String(intent.amount ?? ''),
    recipient: String(intent.recipient ?? ''),
    burnCommitmentHex: intent.burnCommitmentHex.replace(/^0x/i, ''),
    evm: { ...e, txHash: e.txHash, logIndex },
    createdAt: job.createdAt,
    phase: job.phase,
  };
}

/** When relayer predates `GET /v1/bridge/console-state`, build the same shape from `/v1/jobs` + recipients. */
async function bridgeConsoleStateFallback(): Promise<BridgeConsoleState> {
  const r = await j<RecipientsApi>('/v1/bridge/recipients');
  const configured = r.configured ?? {
    evm: Boolean(r.evmRecipient),
    cardano: Boolean(r.cardanoRecipient),
    midnight: Boolean(r.midnightRecipient),
  };
  const recipients: BridgeConsoleState['recipients'] = { ...r, configured };

  let jobs: ApiJob[] = [];
  try {
    const pack = await j<{ jobs?: ApiJob[] }>('/v1/jobs');
    jobs = (pack.jobs ?? []).slice(0, 120);
  } catch {
    jobs = [];
  }

  const evmLockAnchors = jobs.map(jobToEvmLockAnchor).filter(Boolean) as EvmLockAnchor[];
  const cardanoBurnHints = jobs.map(jobToCardanoBurnHint).filter(Boolean) as CardanoBurnHint[];
  const midnightBurnHints = jobs.map(jobToMidnightBurnHint).filter(Boolean) as MidnightBurnHint[];
  const evmBurnHints = jobs.map(jobToEvmBurnHint).filter(Boolean) as EvmBurnHint[];

  return {
    recipients,
    amountPresets: ['0.01', '0.05', '0.1', '1'],
    evmOperatorConsoleTx: false,
    cardanoOperatorConsoleTx: false,
    midnightOperatorConsoleTx: false,
    operatorConsoleAll: false,
    cardano: {
      operatorWallet: null,
      lockScriptUtxos: [],
      lockScriptBalancesByUnit: {},
      lockScriptProvider: null,
    },
    anchors: {
      evmLockAnchors,
      cardanoBurnHints,
      midnightBurnHints,
      evmBurnHints,
    },
  };
}

export async function fetchBridgeConsoleState(): Promise<BridgeConsoleState> {
  const base = getRelayerBaseUrl();
  const res = await fetch(`${base}/v1/bridge/console-state`, {
    headers: { 'content-type': 'application/json' },
  });
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (res.ok) {
    return body as BridgeConsoleState;
  }
  if (res.status === 404) {
    return bridgeConsoleStateFallback();
  }
  const msg =
    typeof body === 'object' && body && body !== null && 'error' in body
      ? String((body as { error: unknown }).error)
      : text.slice(0, 400);
  throw new Error(`${res.status} /v1/bridge/console-state: ${msg}`);
}

export function fetchDemoWallets() {
  return j<Record<string, unknown>>('/v1/demo/wallets');
}

export async function postLockIntent(body: unknown) {
  return j<{ jobs?: unknown[]; job?: unknown; error?: string }>('/v1/intents/lock', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function postBurnIntent(body: unknown) {
  return j<{ jobs?: unknown[]; job?: unknown; error?: string }>('/v1/intents/burn', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export type EvmExecuteLockResponse = {
  asset: string;
  amount: string;
  destinationChain: string;
  approveTxHash: string;
  lockTxHash: string;
  locked: {
    txHash: string;
    logIndex: number;
    blockNumber: string;
    poolLockAddress: string;
    token: string;
    nonce: string;
    recipient: string;
    amountRaw: string;
  };
};

export type EvmExecuteBurnResponse = {
  asset: string;
  amount: string;
  evmPayout: string;
  burnTxHash: string;
  burnCommitmentHex: string;
  burned: {
    txHash: string;
    logIndex: number;
    blockNumber: string;
    wrappedTokenAddress: string;
    nonce: string;
    fromAddress: string;
  };
};

/** Relayer submits pool approve+lock (requires RELAYER_OPERATOR_CONSOLE_EVM_TX + signer envs). */
export async function postEvmExecuteLock(body: {
  asset: string;
  amount: string;
  destinationChain: string;
  recipientIntent: string;
}) {
  return j<EvmExecuteLockResponse>('/v1/evm/execute-lock', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Relayer submits wrapped-token burn (same gate as execute-lock). */
export async function postEvmExecuteBurn(body: { asset: string; amount: string; evmPayout: string; burnCommitmentHex?: string }) {
  return j<EvmExecuteBurnResponse>('/v1/evm/execute-burn', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export type OperatorJobResponse = {
  jobId: string;
  job: unknown;
};

/** Pool lock + enqueue LOCK intent (single POST). */
export async function postEvmOperatorMint(body: {
  asset: string;
  amount: string;
  destinationChain: string;
  recipientIntent: string;
}) {
  return j<
    OperatorJobResponse & {
      approveTxHash: string;
      lockTxHash: string;
      locked: EvmExecuteLockResponse['locked'];
    }
  >('/v1/evm/operator/mint', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Wrapped burn + enqueue BURN intent (single POST). */
export async function postEvmOperatorRedeemToEvm(body: { asset: string; amount: string; evmPayout: string; burnCommitmentHex?: string }) {
  return j<
    OperatorJobResponse & {
      burnTxHash: string;
      burnCommitmentHex: string;
      burned: EvmExecuteBurnResponse['burned'];
    }
  >('/v1/evm/operator/redeem-to-evm', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function postCardanoOperatorMint(body: { asset: string; amount: string; recipientBech32?: string }) {
  return j<{ ok: boolean; asset: string; amount: string; recipient: string } & Record<string, unknown>>('/v1/cardano/operator/mint', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function postCardanoOperatorRedeemToEvm(body: { asset: string; amount: string; evmPayout?: string }) {
  return j<OperatorJobResponse>('/v1/cardano/operator/redeem-to-evm', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function postMidnightOperatorRedeemToEvm(body: { asset: string; amount: string; evmPayout?: string }) {
  return j<OperatorJobResponse>('/v1/midnight/operator/redeem-to-evm', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export type BalanceRow = { raw: string; display: string } | null;
export type CardanoBalanceRow = { raw: string; display: string; unit: string };

export type BalancesResponse = {
  evm: {
    owner: string | null;
    pool: string | null;
    balances: { usdc?: BalanceRow; usdt?: BalanceRow; zkUsdc?: BalanceRow; zkUsdt?: BalanceRow };
    poolBalances: { usdc?: BalanceRow; usdt?: BalanceRow };
  };
  cardano: { address: string; recipientAddress?: string; balances: Record<string, CardanoBalanceRow> } | null;
  midnight: {
    contractAddress: string | null;
    balances?: { zkUsdc?: BalanceRow; zkUsdt?: BalanceRow };
    error?: string;
  };
};

export function fetchBalances() {
  return j<BalancesResponse>('/v1/balances');
}

export type JobApiRow = {
  id: string;
  phase: string;
  createdAt: string;
  updatedAt?: string;
  lockRef?: string;
  depositCommitmentHex?: string;
  destinationHint?: string;
  proofBundle?: {
    algorithm?: string;
    digest?: string;
    publicInputsHex?: string;
  };
  intent: {
    operation?: string;
    sourceChain?: string;
    destinationChain?: string;
    asset?: string;
    amount?: string;
    recipient?: string;
    burnCommitmentHex?: string;
    note?: string;
    source?: {
      evm?: {
        txHash?: string;
        logIndex?: number;
        blockNumber?: string;
        poolLockAddress?: string;
        token?: string;
        nonce?: string;
        wrappedTokenAddress?: string;
        fromAddress?: string;
      };
      cardano?: {
        txHash?: string;
        outputIndex?: number;
        spendTxHash?: string;
        lockNonce?: string;
        policyIdHex?: string;
      };
      midnight?: {
        txId?: string;
        txHash?: string;
        contractAddress?: string;
        destChainId?: number;
        depositCommitmentHex?: string;
      };
    };
  };
  ui: { phaseLabel: string; phaseIndex: number; phaseCount: number };
  error?: string;
};

export function fetchJobs() {
  return j<{ jobs: JobApiRow[] }>('/v1/jobs');
}

export function fetchJobDetail(id: string) {
  return j<JobApiRow>(`/v1/jobs/${encodeURIComponent(id)}`);
}
