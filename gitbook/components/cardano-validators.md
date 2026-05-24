# Cardano Validators (Aiken)

Cardano support in the ZK-Stables bridge combines on-chain Plutus validators written in [Aiken](https://aiken-lang.org/), off-chain transaction tooling with [Mesh](https://meshjs.dev/), and the reference relayer for finality-aware observation. Source code lives in [`cardano/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/cardano).

## Architecture documents

Executable specs used by validators and relayer code:

- [DEPOSIT_COMMITMENT_ENCODING.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/contract/docs/DEPOSIT_COMMITMENT_ENCODING.md) -- `operation_type`, `depositCommitment` preimage, and Cardano `event_commitment` for a lock UTxO
- [BRIDGE_PROOF_BINDING.md](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/contract/docs/BRIDGE_PROOF_BINDING.md) -- proof binding for finalized header, event inclusion, and nonce replay

## On-chain: Aiken package

Prerequisites: [Aiken CLI](https://aiken-lang.org/) installed.

```bash
cd cardano/aiken
aiken check   # run validators + embedded tests
aiken build   # generates plutus.json (tracked for consumers)
```

### Validators

| Validator | File | Description |
|-----------|------|-------------|
| `lock_pool` | `validators/lock_pool.ak` | Lock UTxO spend validator with refund and release paths |
| `unlock_pool` | `validators/unlock_pool.ak` | Parametric nonce registry with a fixed cap of 64 `used_nonces` entries per UTxO; rotate or shard registries for more capacity |

### Types

[`lib/zk_stables_bridge/types.ak`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/cardano/aiken/lib/zk_stables_bridge/types.ak) -- datums aligned with bridge intent fields expected by the relayer and encoding docs.

### Artifacts

`plutus.json` contains script hashes and compiled artifacts for wallets, Mesh, and deployment tooling.

### Trust model (v1)

Validators enforce chain-local value and authorization (depositor refund, optional bridge operator on release). Finality, cross-chain inclusion, and ticket-level replay remain the SNARK + relayer pipeline and Midnight commitments -- not reimplemented inside Compact.

## Off-chain transaction tooling (`cardano/ts`)

This package drives the Aiken validators with Mesh and the `cardano/aiken/plutus.json` artifact.

```bash
cd cardano/ts
npm install
cp .env.example .env   # set BLOCKFROST_PROJECT_ID, CARDANO_WALLET_MNEMONIC, etc.
npm run typecheck
```

### CLI scripts

| Command | Purpose |
|---------|---------|
| `npm run lock` | Create a lock UTxO with `LockDatum` |
| `npm run refund -- <txHash#ix>` | Depositor `UserRefund` (+ collateral) |
| `npm run release -- <txHash#ix>` | `BridgeRelease` (recipient or operator must sign per datum) |
| `npm run registry:init` | Pay to `unlock_pool(parameterized)` with empty `RegistryDatum` (inline datum) |
| `npm run registry:append -- <txHash#ix> [nonceHex]` | Operator records a nonce (continuing inline datum) |

Library entrypoint: `import { submitLock, submitRefund, ... } from '@zk-stables/cardano-offchain'` (path: `cardano/ts/src/index.ts`).

### Key environment variables

See [`cardano/ts/.env.example`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/cardano/ts/.env.example) for the full list, including `LOCK_LOVELACE`, `LOCK_UTXO_REF`, `LOCK_REFUND_TO_ADDRESS`, `LOCK_RELEASE_TO_ADDRESS`, `LOCK_POLICY_ID_HEX` / `LOCK_ASSET_NAME_HEX`, `BRIDGE_OPERATOR_VKEY_HASH`, and datum fields.

### Guarantees

- Refunds/releases attach a `txOut` paying the script-held assets to the configured payout address. Set payout addresses explicitly in production.
- `unlock_pool` must use inline datum so `registry-append` can read `plutusData`.

## Relayer integration

When `RELAYER_CARDANO_WATCHER_ENABLED=true`, the relayer polls Yaci Store or Blockfrost for UTxOs at `RELAYER_CARDANO_LOCK_ADDRESS`, enqueues `LOCK` intents with `source.cardano`, and:

- Uses Yaci Store exclusively when `RELAYER_YACI_URL` or `YACI_URL` is set
- Waits `RELAYER_CARDANO_CONFIRMATIONS` (default `8`) blocks after inclusion
- Builds `stub-sha256-v1` proof metadata with `eventCommitmentHex` and `depositCommitmentHex`

See the [Relayer](relayer.md) page for the full environment variable table.

## Networks and assets

| Network | Configuration |
|---------|---------------|
| Yaci local devnet | `RELAYER_YACI_URL` or `YACI_URL` pointed at Yaci Store (e.g. `http://127.0.0.1:8080/api/v1`) |
| Preprod / mainnet | `RELAYER_BLOCKFROST_NETWORK` must match the Blockfrost project |
| USDC/USDT on Cardano | Generic `policyId` + `assetName` (see encoding doc). Choose a test policy on Preprod for demos. |

For local Cardano setup with Yaci, see the [Cardano Local (Yaci)](../guides/cardano-local-yaci.md) guide.
