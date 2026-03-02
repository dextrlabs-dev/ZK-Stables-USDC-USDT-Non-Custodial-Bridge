import type { Data } from '@meshsdk/common';
import { mConStr0, mConStr1, mNone, mSome } from '@meshsdk/common';

/** `LockDatum` per `cardano/aiken/lib/zk_stables_bridge/types.ak` (constructor index 0). */
export type LockDatumParams = {
  depositorVkeyHashHex56: string;
  recipientVkeyHashHex56: string;
  policyIdHex: string;
  assetNameHex: string;
  amount: bigint;
  lockNonce: bigint;
  recipientCommitmentHex: string;
  sourceChainId: bigint;
  destinationChainId: bigint;
  bridgeOperatorVkeyHashHex56: string | null;
};

export function buildLockDatum(d: LockDatumParams): Data {
  const op: Data =
    d.bridgeOperatorVkeyHashHex56 === null ? mNone() : mSome(d.bridgeOperatorVkeyHashHex56);
  return mConStr0([
    d.depositorVkeyHashHex56,
    d.recipientVkeyHashHex56,
    d.policyIdHex,
    d.assetNameHex,
    d.amount,
    d.lockNonce,
    d.recipientCommitmentHex,
    d.sourceChainId,
    d.destinationChainId,
    op,
  ]);
}

/** `BridgeRelease` redeemer (constructor index 1, nullary). */
export const redeemerBridgeRelease: Data = mConStr1([]);
