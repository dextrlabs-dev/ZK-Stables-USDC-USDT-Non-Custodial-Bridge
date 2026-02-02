import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Maybe<T> = { is_some: boolean; value: T };

export type Witnesses<PS> = {
  operatorSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Maybe<Uint8Array>];
  holderSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Maybe<Uint8Array>];
}

export type ImpureCircuits<PS> = {
  registerDeposit(context: __compactRuntime.CircuitContext<PS>,
                  dep_0: Uint8Array,
                  kind_0: number,
                  srcChain_0: bigint,
                  amt_0: bigint,
                  holderPk_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  mintWrappedUnshielded(context: __compactRuntime.CircuitContext<PS>,
                        dep_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  sendWrappedUnshieldedToUser(context: __compactRuntime.CircuitContext<PS>,
                              dep_0: Uint8Array,
                              user_addr_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  proveHolder(context: __compactRuntime.CircuitContext<PS>, dep_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  initiateBurn(context: __compactRuntime.CircuitContext<PS>,
               dep_0: Uint8Array,
               destChain_0: bigint,
               recipientComm_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  finalizeBurn(context: __compactRuntime.CircuitContext<PS>, dep_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  registerDeposit(context: __compactRuntime.CircuitContext<PS>,
                  dep_0: Uint8Array,
                  kind_0: number,
                  srcChain_0: bigint,
                  amt_0: bigint,
                  holderPk_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  mintWrappedUnshielded(context: __compactRuntime.CircuitContext<PS>,
                        dep_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  sendWrappedUnshieldedToUser(context: __compactRuntime.CircuitContext<PS>,
                              dep_0: Uint8Array,
                              user_addr_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  proveHolder(context: __compactRuntime.CircuitContext<PS>, dep_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  initiateBurn(context: __compactRuntime.CircuitContext<PS>,
               dep_0: Uint8Array,
               destChain_0: bigint,
               recipientComm_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  finalizeBurn(context: __compactRuntime.CircuitContext<PS>, dep_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  registerDeposit(context: __compactRuntime.CircuitContext<PS>,
                  dep_0: Uint8Array,
                  kind_0: number,
                  srcChain_0: bigint,
                  amt_0: bigint,
                  holderPk_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  mintWrappedUnshielded(context: __compactRuntime.CircuitContext<PS>,
                        dep_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  sendWrappedUnshieldedToUser(context: __compactRuntime.CircuitContext<PS>,
                              dep_0: Uint8Array,
                              user_addr_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  proveHolder(context: __compactRuntime.CircuitContext<PS>, dep_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  initiateBurn(context: __compactRuntime.CircuitContext<PS>,
               dep_0: Uint8Array,
               destChain_0: bigint,
               recipientComm_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  finalizeBurn(context: __compactRuntime.CircuitContext<PS>, dep_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly bridgeOperator: Uint8Array;
  depositStatus: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  depositAssetKind: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): number;
    [Symbol.iterator](): Iterator<[Uint8Array, number]>
  };
  depositSourceChain: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  depositAmount: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  depositHolder: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  depositDestChain: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  depositRecipientComm: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  depositRound: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): { read(): bigint }
  };
  depositMintedUnshielded: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  depositUnshieldedReleased: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
