# SDK (`zk-stables-sdk`)

TypeScript SDK for interacting with the ZK-Stables cross-chain stablecoin bridge relayer API. Source code lives in [`sdk/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/sdk).

## Installation

```bash
npm install zk-stables-sdk
```

## ZkStablesSdk class

### Constructor

```ts
import { ZkStablesSdk } from 'zk-stables-sdk';

const sdk = new ZkStablesSdk({ relayerUrl: 'http://127.0.0.1:8787' });
```

### `sdk.lock(intent): Promise<{ jobId, job }>`

Submit a LOCK intent to the relayer. The `operation` field is added automatically.

```ts
const { jobId, job } = await sdk.lock({
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
```

### `sdk.burn(intent): Promise<{ jobId, job }>`

Submit a BURN intent to the relayer. Requires `burnCommitmentHex` (64 hex characters).

```ts
const { jobId, job } = await sdk.burn({
  sourceChain: 'evm',
  asset: 'USDC',
  assetKind: 0,
  amount: '1',
  recipient: '0x...',
  burnCommitmentHex: 'abcd...1234',
  source: {
    evm: { txHash: '0x...', logIndex: 0, blockNumber: '50' },
  },
});
```

### `sdk.getJob(id): Promise<RelayerJob>`

Fetch the current state of a job by its UUID.

### `sdk.subscribeJob(id, pollMs?): () => void`

Poll a job at `pollMs` interval (default 1500 ms). Emits `'job'` events on each poll. Returns an unsubscribe function. Polling stops automatically when the job reaches `completed` or `failed`.

### `sdk.on(event, callback): () => void`

Listen for SDK events. Currently supports `'job'`. Returns an unsubscribe function.

## Usage example: lock + subscribe

```ts
import { ZkStablesSdk } from 'zk-stables-sdk';

const sdk = new ZkStablesSdk({ relayerUrl: 'http://127.0.0.1:8787' });

// Submit a LOCK intent
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
  if (job.phase === 'completed') {
    console.log('Done!', job.destinationHint);
    unsub();
  }
});
sdk.subscribeJob(jobId);
```

## Type exports

| Type | Description |
|------|-------------|
| `SourceChain` | `'evm' \| 'cardano' \| 'midnight'` |
| `LockIntent` | Lock (mint) intent payload with optional `source.evm` and `source.cardano` anchors |
| `BurnIntent` | Burn (redeem) intent payload with `burnCommitmentHex` and optional `source.midnight` |
| `BridgeIntent` | `LockIntent \| BurnIntent` |
| `RelayerPhase` | `'received' \| 'awaiting_finality' \| 'proving' \| 'destination_handoff' \| 'completed' \| 'failed'` |
| `RelayerJob` | Full job object: `id`, `phase`, timestamps, `intent`, `proofBundle`, `error` |

## Prerequisites

- Node.js >= 18 (uses global `fetch`)
- A running ZK-Stables relayer instance

## Examples

Runnable scripts in [`sdk/examples/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/sdk/examples):

- `lock-flow.mjs` -- end-to-end EVM LOCK via SDK
- `burn-redeem-cli.mjs` -- BURN/redeem flow via SDK

For full integration playbooks, see [`sdk/INTEGRATION.md`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/sdk/INTEGRATION.md).
