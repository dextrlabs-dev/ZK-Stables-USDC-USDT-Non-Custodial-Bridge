import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { ZkStables, zkStablesWitnesses } from '@zk-stables/midnight-contract';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const zkStablesCompiledContract = CompiledContract.make('zk-stables', ZkStables.Contract).pipe(
  CompiledContract.withWitnesses(zkStablesWitnesses),
  CompiledContract.withCompiledFileAssets(path.resolve(__dirname, '../../../contract/src/managed/zk-stables')),
);
