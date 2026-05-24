# Midnight Contracts (Compact)

The Midnight side of the ZK-Stables bridge is implemented in [Compact](https://docs.midnight.network/develop/tutorial/compact/), Midnight's zero-knowledge smart-contract language. The contract package lives at [`contract/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/contract).

## Compact language overview

Compact compiles to zero-knowledge circuits that run on the Midnight network. Each contract defines public ledger state, private witness state, and circuit entry points that transition both. The compiler emits TypeScript bindings and ZK configuration artifacts consumed by the Midnight SDK at runtime.

## Contract tiers

### Tier A -- single-user (`zk-stables`)

One deployment per bridge ticket. The constructor accepts:

| Argument | Type | Description |
|----------|------|-------------|
| `depositCommitment` | 32 bytes | Binding commitment per [DEPOSIT_COMMITMENT_ENCODING](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/contract/docs/DEPOSIT_COMMITMENT_ENCODING.md) |
| `assetKind` | enum | `0` = USDC, `1` = USDT |
| `sourceChainId` | bigint | Source chain identifier |
| `amount` | bigint | Token amount |
| `holderPublicKey` | 32 bytes | Holder's public key |

### Tier B -- multi-user registry (`zk-stables-registry`)

Uses a `Map` on the ledger to store multiple deposit records. Suitable for multi-user operations where a single contract instance serves many bridge tickets.

## Key circuits

| Circuit | Purpose |
|---------|---------|
| `proveHolder` | Proves the caller holds the private key corresponding to `holderPublicKey` |
| `mintWrappedUnshielded` | Operator mints wrapped tokens (zkUSDC/zkUSDT) to the holder's unshielded balance |
| `initiateBurn` | Holder initiates a burn, committing a `recipientComm` for cross-chain redemption |
| `finalizeBurn` | Operator finalizes the burn after cross-chain settlement |

**Unshielded wrap flow:** operator calls `mintWrappedUnshielded` while the contract is `Active`; holder runs `initiateBurn`, then operator runs `finalizeBurn`.

## Build process

From the repository root:

```bash
cd contract
npm install
npm run compact   # compile .compact sources to managed artifacts
npm run build     # TypeScript build (copies managed/ into dist/)
npm run typecheck # type-check only
```

The `compact` script compiles two source files:

- `src/zk-stables.compact` -- single-ticket contract
- `src/zk-stables-registry.compact` -- registry contract

## Managed artifacts

Compiled output lives in [`contract/src/managed/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/contract/src/managed):

- `zk-stables/` -- single-ticket contract artifacts (TypeScript bindings, ZK config)
- `zk-stables-registry/` -- registry contract artifacts

These are checked into the repo so downstream packages (`local-cli`, `zk-stables-ui`, relayer) can build without the Compact CLI.

## Package exports

The npm package (`@zk-stables/midnight-contract`) exports:

```ts
import { ZkStables, ZkStablesRegistry } from '@zk-stables/midnight-contract';
import {
  zkStablesCompiledContract,
  zkStablesRegistryCompiledContract,
  AssetKind,
} from '@zk-stables/midnight-contract';
```

- `ZkStables` / `ZkStablesRegistry` -- generated contract modules
- `zkStablesCompiledContract` / `zkStablesRegistryCompiledContract` -- ready-to-deploy `CompiledContract` instances
- `AssetKind` -- `{ USDC: 0, USDT: 1 }`
- Witness types and private state identifiers for wallet integration

## Dependencies

- `@midnight-ntwrk/compact-js` 2.5.0
- `@midnight-ntwrk/compact-runtime` 0.15.0
- Compact CLI (install separately for compilation)
