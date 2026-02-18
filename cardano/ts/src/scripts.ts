import { applyParamsToScript, serializePlutusScript } from '@meshsdk/core';
import type { PlutusBlueprint } from './blueprint.js';
import { lockPoolSpendCode, unlockPoolSpendCode } from './blueprint.js';

export type SerializedLockScript = {
  scriptCbor: string;
  address: string;
};

export function getLockPoolScript(
  bp: PlutusBlueprint,
  networkId: 0 | 1,
): SerializedLockScript {
  const raw = lockPoolSpendCode(bp);
  const scriptCbor = applyParamsToScript(raw, []);
  const { address } = serializePlutusScript({ code: scriptCbor, version: 'V3' }, undefined, networkId);
  return { scriptCbor, address };
}

export function getUnlockPoolScript(
  bp: PlutusBlueprint,
  operatorVkeyHash28Hex: string,
  networkId: 0 | 1,
): SerializedLockScript {
  const raw = unlockPoolSpendCode(bp);
  const scriptCbor = applyParamsToScript(raw, [operatorVkeyHash28Hex]);
  const { address } = serializePlutusScript({ code: scriptCbor, version: 'V3' }, undefined, networkId);
  return { scriptCbor, address };
}
