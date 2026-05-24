# SDK integration playbook

This guide is for **integrators** who want to call an existing ZK-Stables relayer from their own dApp or backend. If you're trying to **run** the relayer + chains locally, start with [Quickstart](quickstart.md) instead.

## Install

```bash
npm install zk-stables-sdk
```

The package is published at `zk-stables-sdk` ([source](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/sdk)). It has one runtime dependency (`eventemitter3`), targets Node ≥ 18, and ships ESM with TypeScript types.

## Configure

```ts
import { ZkStablesSdk } from 'zk-stables-sdk';

const sdk = new ZkStablesSdk({
  relayerUrl: process.env.ZK_STABLES_RELAYER_URL ?? 'http://127.0.0.1:8787',
});
```

The SDK is stateless — every method round-trips through the relayer's HTTP API. Pass a custom `fetch` implementation or `headers` if you need to add auth in front of the relayer.

## Submit a LOCK intent

A LOCK moves the underlying USDC / USDT from the source chain into the relayer's custody so wrapped tokens can be minted on the destination chain.

```ts
const { jobId, job } = await sdk.lock({
  sourceChain: 'evm',
  destinationChain: 'cardano',
  asset: 'USDC',
  assetKind: 0,
  amount: '1.50',
  recipient: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp',
  source: {
    evm: {
      txHash: '0xe34133e71c381e5bcfce3d7419dc88e23feff10ce1b10a17504022f0c4538c6b',
      logIndex: 1,
    },
  },
});

console.log('queued', jobId, 'currently in phase', job.phase);
```

`source.evm.txHash` references the on-chain `lock()` tx the wallet already submitted to `ZkStablesPoolLock`. The relayer verifies inclusion via Merkle proof against the EVM log before continuing.

For EVM → Midnight, swap `destinationChain: 'cardano'` for `'midnight'` and pass the `mn_addr_…` recipient. For Cardano → EVM, set `sourceChain: 'cardano'` and pass `source.cardano.{txHash, outputIndex}`.

## Submit a BURN intent

A BURN moves wrapped tokens back to the underlying asset (redeem path). The destination chain releases funds against an inclusion proof of the burn.

```ts
const { jobId } = await sdk.burn({
  sourceChain: 'cardano',
  destinationChain: 'evm',
  asset: 'USDC',
  assetKind: 0,
  amount: '1.50',
  recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  burnCommitmentHex: '0x' + 'aa'.repeat(32),
  source: {
    cardano: {
      txHash: '9e0f06442bd21b1da95a0665c90828e89660ec2a58bbbbd9ec6ecc67ec40b6b0',
      outputIndex: 0,
    },
  },
});
```

## Track progress

The relayer's per-job state machine goes `received → awaiting_finality → proving → destination_handoff → completed` (or `failed`). Two ways to watch it:

### Polling

```ts
async function waitForCompletion(jobId: string) {
  for (;;) {
    const job = await sdk.getJob(jobId);
    if (job.phase === 'completed' || job.phase === 'failed') return job;
    await new Promise((r) => setTimeout(r, 1500));
  }
}
```

### Event subscription

```ts
sdk.on('job', (job) => {
  if (job.id !== jobId) return;
  console.log(job.phase, job.ui?.phaseLabel);
});
```

Both work the same way under the hood — the SDK emits whatever shape the relayer's `/v1/jobs/:id` returned most recently.

## Observed end-to-end timings

From the 2026-04-11 → 2026-04-12 integration runs (24 completed jobs across 4 routes — see [Benchmark results](../testing/benchmark-results.md)):

| Route | Median end-to-end |
|---|---|
| EVM → Cardano LOCK | ~2.0 s |
| Cardano → EVM BURN | ~9.6 s |
| EVM → Midnight LOCK (cold) | ~88–100 s |

Build a UI timeout > the route's max observed latency (round up generously); the SDK won't time out on its own.

## Error handling

The relayer surfaces errors as `phase: 'failed'` plus a structured error body on `job.error`. Common cases the SDK has exercised in real runs:

- **Source-chain indexer unreachable** → `job.error.code = 'INDEXER_UNAVAILABLE'`. The integrator should retry or surface the outage. See [`docs/postmortems/2026-04-12-midnight-indexer-outage.md`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/postmortems/2026-04-12-midnight-indexer-outage.md).
- **Bridge wallet underfunded** (Cardano destination) → `job.error.code = 'BRIDGE_WALLET_INSUFFICIENT'`. Operator-side; the integrator just retries when the operator confirms. See [the wallet-funding postmortem](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/postmortems/2026-04-11-evm-cardano-payout-wallet-funding.md).
- **Inclusion proof rejected** → `job.error.code = 'PROOF_INCLUSION_FAILED'`. The integrator probably submitted a tx hash that isn't yet final on-chain; retry after the source chain's finality window.

## Production checklist

Before pointing the SDK at a mainnet relayer:

1. Move `relayerUrl` behind a TLS reverse proxy. The relayer's HTTP API is unauthenticated by default.
2. Set `RELAYER_SRS_STRICT=true` on the relayer side — covered in [`docs/SRS_RELAYER_REQUIREMENTS.md`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/SRS_RELAYER_REQUIREMENTS.md).
3. Confirm the operator wallet's bridge `changeAddress` has the float you need (the [Cardano wallet-funding postmortem](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/postmortems/2026-04-11-evm-cardano-payout-wallet-funding.md) describes the pre-fund step).
4. Wire the SDK's `on('job', …)` into your observability stack so a sustained `phase: 'failed'` reaches your pager.

## Related

- [Quickstart](quickstart.md) — for running the relayer + chains locally.
- [API reference](../reference/api-reference.md) — the underlying HTTP shapes.
- [Environment variables](../reference/environment-variables.md) — relayer + benchmark configuration.
