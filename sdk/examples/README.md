# SDK Examples

Runnable POC scripts demonstrating `zk-stables-sdk` usage against the local bridge stack.

## Prerequisites

1. Start the local stack:
   ```bash
   ./scripts/start-local-stack.sh
   ```
2. Wait for the relayer to report healthy:
   ```bash
   curl http://127.0.0.1:8787/v1/health/chains
   ```
3. Build the SDK (needed for local imports):
   ```bash
   cd sdk && npm run build
   ```

## POC 1: EVM Lock Flow

Demonstrates a full EVM LOCK (USDC -> Midnight mint) using the SDK.

```bash
node sdk/examples/lock-flow.mjs
```

Options:
- `--relayer-url <url>` (default: `http://127.0.0.1:8787`)
- `--rpc-url <url>` (default: `http://127.0.0.1:8545`)
- `--amount <n>` (default: `1`)

What it does:
1. Reads deployed contract addresses from `/tmp/zk-stables-anvil-addrs.json`
2. Approves and locks USDC in the EVM pool contract
3. Submits a LOCK intent via `sdk.lock()`
4. Subscribes to job progress via `sdk.subscribeJob()` and `sdk.on('job', ...)`
5. Prints each phase transition with timing until completion

## POC 2: Burn/Redeem Flow

Demonstrates a BURN (Midnight -> EVM unlock) using the SDK.

```bash
node sdk/examples/burn-redeem-cli.mjs --burn-commitment <64-char-hex>
```

Options:
- `--burn-commitment <hex>` (REQUIRED) 32-byte hex binding to a prior deposit
- `--amount <n>` (default: `1`)
- `--payout <address>` (default: Anvil account #0)
- `--relayer-url <url>` (default: `http://127.0.0.1:8787`)
- `--source-chain <chain>` (default: `midnight`)
- `--dest-chain <chain>` (default: `evm`)
- `--asset <USDC|USDT>` (default: `USDC`)

Typical usage after a successful lock:
```bash
# Use the nonce from the lock as the burn commitment
node sdk/examples/burn-redeem-cli.mjs \
  --burn-commitment <nonce-hex-from-lock> \
  --payout 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```
