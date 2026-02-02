declare module '@contract/zk-stables' {
  import type * as CR from '@midnight-ntwrk/compact-runtime';
  export type Ledger = {
    readonly depositCommitment: Uint8Array;
    readonly assetKind: number;
    readonly sourceChainId: bigint;
    readonly amount: bigint;
    readonly holder: Uint8Array;
    readonly bridgeOperator: Uint8Array;
    readonly state: number;
    readonly round: bigint;
    readonly destChainId: bigint;
    readonly recipientCommitment: Uint8Array;
    readonly mintedUnshielded: boolean;
    readonly unshieldedReleased: boolean;
  };
  export class Contract<PS = unknown, W = unknown> {
    constructor(witnesses: W);
  }
  export function ledger(state: CR.StateValue | CR.ChargedState): Ledger;
}

declare module '@contract/witnesses-zk-stables' {
  export type ZkStablesPrivateState = {
    operatorSecretKey?: Uint8Array;
    holderSecretKey?: Uint8Array;
  };
  export const zkStablesWitnesses: Record<string, unknown>;
}
