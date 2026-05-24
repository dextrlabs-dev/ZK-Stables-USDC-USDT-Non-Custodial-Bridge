# Quickstart

Get the ZK-Stables bridge running locally in minutes.

> **Two audiences read this site.** If you only want to **call** an existing relayer from your own app / backend, skip this page and go straight to the [SDK integration playbook](sdk-integration.md). The page below is for **operators** spinning up the full local stack (Anvil + Yaci + Midnight + relayer + UI).

## Prerequisites

- **Node.js 20+** (all npm workspaces)
- **Docker** (for Yaci DevKit / Cardano local devnet)
- **Compact CLI** (for Midnight contract compilation; optional if using pre-built managed artifacts)
- **Aiken CLI** (for Cardano validator compilation; optional if using checked-in `plutus.json`)

## 1. Clone and install

```bash
git clone https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge.git
cd ZK-Stables-USDC-USDT-Non-Custodial-Bridge
npm install
```

## 2. Build the Midnight contract

The managed artifacts are checked in, but if you need to recompile:

```bash
cd contract
npm run compact   # requires Compact CLI
npm run build
```

If you only need the TypeScript build (using existing managed artifacts):

```bash
cd contract
npm run build
```

## 3. Start the local stack

The one-command script starts Hardhat (EVM on :8545), deploys contracts, syncs addresses to the UI, starts the relayer (:8787), and launches Vite (:5173).

```bash
# Optional: start Yaci first for Cardano support
./scripts/start-yaci-devkit.sh

# Start everything
./scripts/start-local-stack.sh
```

After startup:

| Service | URL |
|---------|-----|
| UI | http://127.0.0.1:5173 |
| Relayer | http://127.0.0.1:8787/health |
| EVM (Anvil/Hardhat) | http://127.0.0.1:8545 |
| Yaci Store (optional) | http://127.0.0.1:8080 |

Contract addresses are written to `/tmp/zk-stables-anvil-addrs.json`.

## 4. Run a first bridge

Use the minimal test script from the repo root:

```bash
node test-minimal.mjs
```

Or use the CLI:

```bash
cd bridge-cli
npm run build
node dist/cli.js mint \
  --destination evm \
  --asset USDC \
  --amount 1.0 \
  --recipient 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

Or use the SDK programmatically:

```ts
import { ZkStablesSdk } from 'zk-stables-sdk';

const sdk = new ZkStablesSdk({ relayerUrl: 'http://127.0.0.1:8787' });
const { jobId } = await sdk.lock({ /* ... */ });
sdk.subscribeJob(jobId);
```

## Next steps

- [Usage guide](usage.md) -- full walkthrough of all components and workflows
- [Local EVM setup](local-evm.md) -- detailed Anvil and Hardhat guide
- [Cardano local (Yaci)](cardano-local-yaci.md) -- Yaci DevKit setup and funding
- [Midnight local CLI](midnight-local-cli.md) -- deploy contracts on a local Midnight stack
- [SDK reference](../components/sdk.md) -- programmatic integration
- [Bridge CLI reference](../components/bridge-cli.md) -- command-line operations
