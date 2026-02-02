import EventEmitter from 'eventemitter3';

export type SourceChain = 'evm' | 'cardano' | 'midnight';

export type LockIntent = {
  operation: 'LOCK';
  sourceChain: SourceChain;
  destinationChain?: string;
  asset: 'USDC' | 'USDT';
  assetKind: number;
  amount: string;
  recipient: string;
};

export type BurnIntent = {
  operation: 'BURN';
  sourceChain: SourceChain;
  destinationChain?: string;
  asset: 'USDC' | 'USDT';
  assetKind: number;
  amount: string;
  recipient: string;
};

export type RelayerPhase =
  | 'received'
  | 'awaiting_finality'
  | 'proving'
  | 'destination_handoff'
  | 'completed'
  | 'failed';

export type RelayerJob = {
  id: string;
  phase: RelayerPhase;
  createdAt: string;
  updatedAt: string;
  lockRef: string;
  intent: LockIntent | BurnIntent;
  destinationHint?: string;
  proofBundle?: { algorithm: string; digest: string; publicInputsHex: string };
  error?: string;
};

export class ZkStablesSdk {
  private readonly relayerUrl: string;
  private readonly events = new EventEmitter();

  constructor(params: { relayerUrl: string }) {
    this.relayerUrl = params.relayerUrl.replace(/\/$/, '');
  }

  on(event: 'job', cb: (job: RelayerJob) => void) {
    this.events.on(event, cb);
    return () => this.events.off(event, cb);
  }

  async lock(intent: Omit<LockIntent, 'operation'>): Promise<{ jobId: string; job: RelayerJob }> {
    const r = await fetch(`${this.relayerUrl}/v1/intents/lock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...intent, operation: 'LOCK' }),
    });
    if (!r.ok) throw new Error(`relayer HTTP ${r.status}: ${await r.text()}`);
    return (await r.json()) as { jobId: string; job: RelayerJob };
  }

  async burn(intent: Omit<BurnIntent, 'operation'>): Promise<{ jobId: string; job: RelayerJob }> {
    const r = await fetch(`${this.relayerUrl}/v1/intents/burn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...intent, operation: 'BURN' }),
    });
    if (!r.ok) throw new Error(`relayer HTTP ${r.status}: ${await r.text()}`);
    return (await r.json()) as { jobId: string; job: RelayerJob };
  }

  async getJob(id: string): Promise<RelayerJob> {
    const r = await fetch(`${this.relayerUrl}/v1/jobs/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(`relayer HTTP ${r.status}: ${await r.text()}`);
    return (await r.json()) as RelayerJob;
  }

  subscribeJob(id: string, pollMs = 1500) {
    let stopped = false;
    const tick = async () => {
      while (!stopped) {
        const job = await this.getJob(id);
        this.events.emit('job', job);
        if (job.phase === 'completed' || job.phase === 'failed') return;
        await new Promise((r) => setTimeout(r, pollMs));
      }
    };
    void tick();
    return () => {
      stopped = true;
    };
  }
}

