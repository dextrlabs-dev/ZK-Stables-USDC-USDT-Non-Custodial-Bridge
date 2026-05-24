# zk-stables-sdk

TypeScript SDK for the [ZK-Stables](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge) cross-chain stablecoin bridge relayer API.

## Install

```bash
npm install zk-stables-sdk
```

## Quick start

```ts
import { ZkStablesSdk } from 'zk-stables-sdk';

const sdk = new ZkStablesSdk({ relayerUrl: 'http://127.0.0.1:8787' });

// Submit a LOCK intent (EVM → Midnight)
const { jobId } = await sdk.lock({
  sourceChain: 'evm',
  destinationChain: 'midnight',
  asset: 'USDC',
  assetKind: 0,
  amount: '1',
  recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  source: {
    evm: { txHash: '0x...', logIndex: 0, blockNumber: '42' },
  },
});

// Subscribe to job progress
const unsub = sdk.on('job', (job) => {
  console.log(`Phase: ${job.phase}`);
  if (job.phase === 'completed') console.log('Done!', job.destinationHint);
});
sdk.subscribeJob(jobId);
```

## API

### `new ZkStablesSdk({ relayerUrl })`

Create an SDK instance pointed at a running relayer.

### `sdk.lock(intent): Promise<{ jobId, job }>`

Submit a LOCK intent. Returns the relayer job ID and initial job state.

### `sdk.burn(intent): Promise<{ jobId, job }>`

Submit a BURN intent. Returns the relayer job ID and initial job state.

### `sdk.getJob(id): Promise<RelayerJob>`

Fetch the current state of a job by ID.

### `sdk.subscribeJob(id, pollMs?): () => void`

Poll a job at `pollMs` interval (default 1500ms). Emits `'job'` events on each poll. Returns an unsubscribe function. Polling stops automatically when the job reaches `completed` or `failed`.

### `sdk.on(event, callback): () => void`

Listen for events. Currently supports `'job'`. Returns an unsubscribe function.

## Exported types

| Type | Description |
|------|-------------|
| `SourceChain` | `'evm' \| 'cardano' \| 'midnight'` |
| `LockIntent` | Lock (mint) intent payload |
| `BurnIntent` | Burn (redeem) intent payload |
| `BridgeIntent` | `LockIntent \| BurnIntent` |
| `RelayerPhase` | `'received' \| 'awaiting_finality' \| 'proving' \| 'destination_handoff' \| 'completed' \| 'failed'` |
| `RelayerJob` | Full job object returned by the relayer |

## Prerequisites

- Node.js >= 18 (uses global `fetch`)
- A running ZK-Stables relayer instance

## Examples

See [`examples/`](./examples/) for runnable POC scripts:
- [`lock-flow.mjs`](./examples/lock-flow.mjs) — end-to-end EVM LOCK via SDK
- [`burn-redeem-cli.mjs`](./examples/burn-redeem-cli.mjs) — BURN/redeem flow via SDK

See [`INTEGRATION.md`](./INTEGRATION.md) for full integration playbooks.

## License

MIT
