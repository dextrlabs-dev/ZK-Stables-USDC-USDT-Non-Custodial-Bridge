import { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { Ledger, Maybe } from './managed/zk-stables/contract/index.js';

export type ZkStablesPrivateState = {
  operatorSecretKey?: Uint8Array;
  holderSecretKey?: Uint8Array;
};

export const zkStablesWitnesses = {
  operatorSecretKey: ({ privateState }: WitnessContext<Ledger, ZkStablesPrivateState>): [ZkStablesPrivateState, Maybe<Uint8Array>] => [
    privateState,
    { is_some: true, value: privateState.operatorSecretKey ?? new Uint8Array() },
  ],
  holderSecretKey: ({ privateState }: WitnessContext<Ledger, ZkStablesPrivateState>): [ZkStablesPrivateState, Maybe<Uint8Array>] => [
    privateState,
    { is_some: true, value: privateState.holderSecretKey ?? new Uint8Array() },
  ],
};
