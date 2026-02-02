import { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { Ledger, Maybe } from './managed/zk-stables-registry/contract/index.js';

export type ZkStablesRegistryPrivateState = {
  operatorSecretKey?: Uint8Array;
  holderSecretKey?: Uint8Array;
};

export const zkStablesRegistryWitnesses = {
  operatorSecretKey: ({ privateState }: WitnessContext<Ledger, ZkStablesRegistryPrivateState>): [ZkStablesRegistryPrivateState, Maybe<Uint8Array>] => [
    privateState,
    { is_some: true, value: privateState.operatorSecretKey ?? new Uint8Array() },
  ],
  holderSecretKey: ({ privateState }: WitnessContext<Ledger, ZkStablesRegistryPrivateState>): [ZkStablesRegistryPrivateState, Maybe<Uint8Array>] => [
    privateState,
    { is_some: true, value: privateState.holderSecretKey ?? new Uint8Array() },
  ],
};
