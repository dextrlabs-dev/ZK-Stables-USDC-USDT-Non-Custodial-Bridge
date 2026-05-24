# ZK-Stables SDK Integration Playbook

Step-by-step guide for integrating the ZK-Stables bridge SDK into your application.

## Quick Start

### Install

```bash
npm install zk-stables-sdk
```

### Initialize

```ts
import { ZkStablesSdk } from 'zk-stables-sdk';

const sdk = new ZkStablesSdk({ relayerUrl: 'http://127.0.0.1:8787' });
```

## Flow 1: LOCK (Mint wrapped tokens on destination chain)

### Step 1: Execute the on-chain lock

Before submitting a LOCK intent, the underlying tokens must be locked on the source chain.

**EVM source:**
```ts
import { createWalletClient, http, parseAbi } from 'viem';
import { randomBytes } from 'node:crypto';

const poolAbi = parseAbi([
  'function lock(address token, uint256 amount, address recipient, bytes32 nonce) external',
]);
const erc20Abi = parseAbi([
  'function approve(address, uint256) external returns (bool)',
]);

// 1. Approve the pool to spend your tokens
const approveTx = await wallet.writeContract({
  address: USDC_ADDRESS,
  abi: erc20Abi,
  functionName: 'approve',
  args: [POOL_ADDRESS, amount],
});
await publicClient.waitForTransactionReceipt({ hash: approveTx });

// 2. Lock tokens in the pool
const nonce = '0x' + randomBytes(32).toString('hex');
const lockTx = await wallet.writeContract({
  address: POOL_ADDRESS,
  abi: poolAbi,
  functionName: 'lock',
  args: [USDC_ADDRESS, amount, recipientAddress, nonce],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: lockTx });
```

### Step 2: Submit the LOCK intent

```ts
const { jobId, job } = await sdk.lock({
  sourceChain: 'evm',
  destinationChain: 'midnight', // or 'cardano'
  asset: 'USDC',
  assetKind: 0,
  amount: '1',
  recipient: recipientAddress,
  source: {
    evm: {
      txHash: lockTx,
      logIndex: 0,
      blockNumber: String(receipt.blockNumber),
      token: USDC_ADDRESS,
      nonce,
    },
  },
});
```

### Step 3: Track job progress

```ts
sdk.on('job', (job) => {
  console.log(`Phase: ${job.phase}`);

  if (job.phase === 'completed') {
    console.log('Mint complete!', job.destinationHint);
    console.log('Deposit commitment:', job.depositCommitmentHex);
  }

  if (job.phase === 'failed') {
    console.error('Failed:', job.error);
  }
});

sdk.subscribeJob(jobId);
```

## Flow 2: BURN (Redeem underlying tokens)

### From Midnight

1. Call `initiateBurn` on the Midnight contract (via your wallet/SDK)
2. Extract `txId`, `contractAddress`, and `destChainId`
3. Submit via SDK:

```ts
const { jobId } = await sdk.burn({
  sourceChain: 'midnight',
  destinationChain: 'evm',
  asset: 'USDC',
  assetKind: 0,
  amount: '1',
  recipient: evmPayoutAddress,
  burnCommitmentHex: recipientCommitmentHex, // 64-char hex, no 0x prefix
  source: {
    midnight: {
      txId: midnightTxId,
      contractAddress: contractAddr,
      destChainId: 2, // EVM = 2
    },
  },
});

sdk.subscribeJob(jobId);
```

### From EVM (same-chain wrapped token burn)

1. Call `burn()` on `ZkStablesWrappedToken`
2. Extract `Burned` event data

```ts
const { jobId } = await sdk.burn({
  sourceChain: 'evm',
  destinationChain: 'evm',
  asset: 'USDC',
  assetKind: 0,
  amount: '1',
  recipient: payoutAddress,
  burnCommitmentHex: commitmentHex,
  source: {
    evm: {
      txHash: burnTxHash,
      logIndex: 0,
      blockNumber: String(blockNum),
      wrappedTokenAddress: wUSDC,
      fromAddress: burnerAddress,
    },
  },
});
```

### From Cardano

1. Spend the lock UTxO with `BridgeRelease` redeemer
2. Record `txHash` and `outputIndex`

```ts
const { jobId } = await sdk.burn({
  sourceChain: 'cardano',
  destinationChain: 'evm',
  asset: 'USDC',
  assetKind: 0,
  amount: '1',
  recipient: payoutAddress,
  burnCommitmentHex: commitmentHex,
  source: {
    cardano: {
      txHash: cardanoTxHash,
      outputIndex: 0,
      scriptHash: validatorHash,
    },
  },
});
```

## Environment Setup

### Local development

```bash
# Start all services (Anvil, relayer, Vite UI)
./scripts/start-local-stack.sh

# Optionally start Cardano Yaci DevKit
./scripts/start-yaci-devkit.sh
```

### Health check

```bash
curl http://127.0.0.1:8787/v1/health/chains
```

Returns chain connectivity status and bridge wallet readiness.

### Deploy addresses

After local deploy, contract addresses are written to `/tmp/zk-stables-anvil-addrs.json`:

```json
{
  "USDC": "0x7a2088a1...",
  "USDT": "0x...",
  "poolLock": "0xc5a5C429...",
  "bridgeMint": "0x...",
  "wUSDC": "0x...",
  "wUSDT": "0x..."
}
```

## Type Reference

All types are exported from the package root:

```ts
import type {
  SourceChain,
  LockIntent,
  BurnIntent,
  BridgeIntent,
  RelayerPhase,
  RelayerJob,
} from 'zk-stables-sdk';
```

## Error Handling

- **HTTP errors**: `sdk.lock()` and `sdk.burn()` throw with status code and response body
- **Job failures**: Check `job.phase === 'failed'` and read `job.error`
- **Timeouts**: `subscribeJob` runs indefinitely; implement your own timeout wrapper

```ts
const { jobId } = await sdk.lock(intent);

const result = await Promise.race([
  new Promise((resolve, reject) => {
    sdk.on('job', (j) => {
      if (j.phase === 'completed') resolve(j);
      if (j.phase === 'failed') reject(new Error(j.error));
    });
    sdk.subscribeJob(jobId);
  }),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), 300_000)
  ),
]);
```

## Advanced: Custom Polling

```ts
// One-shot status check
const job = await sdk.getJob(jobId);

// Adjustable poll interval (default: 1500ms)
const unsub = sdk.subscribeJob(jobId, 500); // poll every 500ms

// Manual unsubscribe
unsub();
```
