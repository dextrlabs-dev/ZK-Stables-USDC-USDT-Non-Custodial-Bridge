/**
 * Midnight.js 3.x wiring: `CompiledContract` + ZK artifact paths.
 * Use with `deployContract` / `findDeployedContract` from `@midnight-ntwrk/midnight-js-contracts`.
 *
 * **Unshielded wrap flow** (see token-transfers docs): operator calls `mintWrappedUnshielded` while `Active`;
 * holder `initiateBurn` → `sendWrappedUnshieldedToUser` → operator `finalizeBurn`. If you never mint, you can
 * still finalize after `initiateBurn` (metadata-only ticket).
 *
 * Single-ticket constructor args (order matches `Contract.initialState` in generated `.d.ts`):
 * `[depositCommitment, assetKind, sourceChainId, amount, holderPublicKey]`
 *
 * - `depositCommitment`: 32 bytes (see docs/DEPOSIT_COMMITMENT_ENCODING.md)
 * - `assetKind`: `0` = USDC, `1` = USDT (Compact enum order)
 * - `sourceChainId`, `amount`: `bigint`
 * - `holderPublicKey`: 32 bytes
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import * as ZkStables from './managed/zk-stables/contract/index.js';
import * as ZkStablesRegistry from './managed/zk-stables-registry/contract/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const zkStablesZkConfigPath = path.resolve(__dirname, 'managed', 'zk-stables');
export const zkStablesRegistryZkConfigPath = path.resolve(__dirname, 'managed', 'zk-stables-registry');

// Generated `Contract` classes lag slightly behind strict `CompiledContract` generics in compact-js 2.5.
const ctor = <C>(c: C) => c as unknown as Parameters<typeof CompiledContract.make>[1];

export const zkStablesCompiledContract = CompiledContract.make('zk-stables', ctor(ZkStables.Contract)).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(zkStablesZkConfigPath),
);

export const zkStablesRegistryCompiledContract = CompiledContract.make(
  'zk-stables-registry',
  ctor(ZkStablesRegistry.Contract),
).pipe(CompiledContract.withVacantWitnesses, CompiledContract.withCompiledFileAssets(zkStablesRegistryZkConfigPath));

export const zkStablesPrivateStateId = 'zkStablesPrivateState' as const;
export const zkStablesRegistryPrivateStateId = 'zkStablesRegistryPrivateState' as const;

/** AssetKind enum indices aligned with Compact `zk-stables.compact`. */
export const AssetKind = {
  USDC: 0,
  USDT: 1,
} as const;

export type ZkStablesConstructorArgs = readonly [
  depositCommitment: Uint8Array,
  assetKind: number,
  sourceChainId: bigint,
  amount: bigint,
  holderPublicKey: Uint8Array,
];
