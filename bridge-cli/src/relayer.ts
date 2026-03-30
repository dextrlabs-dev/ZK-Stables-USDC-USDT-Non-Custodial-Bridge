import type { Address, Hex } from 'viem';

export type RelayerJob = {
  id: string;
  phase: string;
  intent: Record<string, unknown>;
  error?: string;
  lockRef?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type LockIntentBody = {
  operation: 'LOCK';
  sourceChain: 'evm';
  destinationChain: string;
  asset: 'USDC' | 'USDT';
  assetKind: number;
  amount: string;
  recipient: string;
  note?: string;
  source: {
    evm: {
      txHash: Hex;
      logIndex: number;
      blockNumber: string;
      poolLockAddress: Address;
      token: Address;
      nonce: Hex;
    };
  };
};

export type BurnIntentBody = {
  operation: 'BURN';
  sourceChain: 'evm' | 'cardano' | 'midnight';
  destinationChain?: string;
  asset: 'USDC' | 'USDT';
  assetKind: number;
  amount: string;
  recipient: string;
  burnCommitmentHex: string;
  note?: string;
  source?: {
    evm?: {
      txHash: Hex;
      logIndex: number;
      blockNumber: string;
      wrappedTokenAddress: Address;
      nonce: Hex;
      fromAddress: Address;
    };
    cardano?: {
      txHash: string;
      outputIndex: number;
      lockNonce?: string;
      spendTxHash: string;
    };
    midnight?: {
      txId: string;
      txHash?: string;
      contractAddress?: string;
      destChainId?: number;
      lockNonce?: string;
      depositCommitmentHex: string;
    };
  };
};

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Relayer returned non-JSON (HTTP ${res.status}): ${text.slice(0, 500)}`);
  }
  return data as Record<string, unknown>;
}

export async function postLockIntent(baseUrl: string, body: LockIntentBody): Promise<{ jobId: string; job: RelayerJob }> {
  const res = await fetch(`${baseUrl}/v1/intents/lock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
  }
  const jobId = data.jobId as string | undefined;
  const job = data.job as RelayerJob | undefined;
  if (!jobId || !job?.id) throw new Error('Relayer did not return job');
  return { jobId, job };
}

export async function postBurnIntent(baseUrl: string, body: BurnIntentBody): Promise<{ jobId: string; job: RelayerJob }> {
  const res = await fetch(`${baseUrl}/v1/intents/burn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
  }
  const jobId = data.jobId as string | undefined;
  const job = data.job as RelayerJob | undefined;
  if (!jobId || !job?.id) throw new Error('Relayer did not return job');
  return { jobId, job };
}

export async function getJob(baseUrl: string, id: string): Promise<RelayerJob> {
  const res = await fetch(`${baseUrl}/v1/jobs/${encodeURIComponent(id)}`);
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
  }
  return data as unknown as RelayerJob;
}

export type WaitJobOpts = {
  pollMs: number;
  timeoutMs: number;
  /** If set with `onProgress`, called at most every `heartbeatMs` while still waiting (default 15s). */
  heartbeatMs?: number;
  onProgress?: (job: RelayerJob, elapsedMs: number) => void;
};

export async function waitJob(baseUrl: string, id: string, opts: WaitJobOpts): Promise<RelayerJob> {
  const start = Date.now();
  let lastBeat = start;
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  for (;;) {
    const j = await getJob(baseUrl, id);
    if (j.phase === 'completed' || j.phase === 'failed') return j;
    const now = Date.now();
    if (now - start > opts.timeoutMs) {
      throw new Error(`Timeout waiting for job ${id} (last phase: ${j.phase})`);
    }
    if (opts.onProgress && now - lastBeat >= heartbeatMs) {
      lastBeat = now;
      opts.onProgress(j, now - start);
    }
    await new Promise((r) => setTimeout(r, opts.pollMs));
  }
}
