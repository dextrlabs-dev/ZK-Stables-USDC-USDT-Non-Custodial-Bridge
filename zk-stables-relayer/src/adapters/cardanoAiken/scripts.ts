import { applyParamsToScript, serializePlutusScript } from '@meshsdk/core';
import type { PlutusBlueprint } from './blueprint.js';
import { lockPoolSpendCode } from './blueprint.js';

export type SerializedLockScript = {
  scriptCbor: string;
  address: string;
};

export function getLockPoolScript(bp: PlutusBlueprint, networkId: 0 | 1): SerializedLockScript {
  const raw = lockPoolSpendCode(bp);
  const scriptCbor = applyParamsToScript(raw, []);
  const { address } = serializePlutusScript({ code: scriptCbor, version: 'V3' }, undefined, networkId);
  return { scriptCbor, address };
}
