/**
 * Same `compact-js` instance as `zk-stables-compiled-contract.ts` (see comment there).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { ZkStablesRegistry, zkStablesRegistryWitnesses } from '@zk-stables/midnight-contract';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const zkStablesRegistryCompiledContract = CompiledContract.make(
  'zk-stables-registry',
  ZkStablesRegistry.Contract,
).pipe(
  CompiledContract.withWitnesses(zkStablesRegistryWitnesses),
  CompiledContract.withCompiledFileAssets(path.resolve(__dirname, '../../contract/src/managed/zk-stables-registry')),
);
