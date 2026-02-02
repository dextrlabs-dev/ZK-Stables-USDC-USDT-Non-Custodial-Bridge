import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Maybe<T> = { is_some: boolean; value: T };

export type Witnesses<PS> = {
  operatorSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Maybe<Uint8Array>];
  holderSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Maybe<Uint8Array>];
}

export type ImpureCircuits<PS> = {
  proveHolder(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, boolean>;
  mintWrappedUnshielded(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  sendWrappedUnshieldedToUser(context: __compactRuntime.CircuitContext<PS>,
                              user_addr_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  initiateBurn(context: __compactRuntime.CircuitContext<PS>,
               destChain_0: bigint,
               recipientComm_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  finalizeBurn(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  proveHolder(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, boolean>;
  mintWrappedUnshielded(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  sendWrappedUnshieldedToUser(context: __compactRuntime.CircuitContext<PS>,
                              user_addr_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  initiateBurn(context: __compactRuntime.CircuitContext<PS>,
               destChain_0: bigint,
               recipientComm_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  finalizeBurn(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  proveHolder(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, boolean>;
  mintWrappedUnshielded(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  sendWrappedUnshieldedToUser(context: __compactRuntime.CircuitContext<PS>,
                              user_addr_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  initiateBurn(context: __compactRuntime.CircuitContext<PS>,
               destChain_0: bigint,
               recipientComm_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  finalizeBurn(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

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
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               dep_0: Uint8Array,
               kind_0: number,
               srcChain_0: bigint,
               amt_0: bigint,
               ownerPk_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
