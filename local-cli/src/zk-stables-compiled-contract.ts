/**
 * Must use the same `@midnight-ntwrk/compact-js` instance as `@midnight-ntwrk/midnight-js-contracts`.
 * `zkStablesCompiledContract` from `@zk-stables/midnight-contract` is built against a nested `compact-js`
 * copy under `contract/node_modules`, so its internal `Symbol` does not match and deploy fails with
 * missing `ctor` in `getContractContext`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { ZkStables, zkStablesWitnesses } from '@zk-stables/midnight-contract';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const zkStablesCompiledContract = CompiledContract.make('zk-stables', ZkStables.Contract).pipe(
  CompiledContract.withWitnesses(zkStablesWitnesses),
  CompiledContract.withCompiledFileAssets(path.resolve(__dirname, '../../contract/src/managed/zk-stables')),
);
