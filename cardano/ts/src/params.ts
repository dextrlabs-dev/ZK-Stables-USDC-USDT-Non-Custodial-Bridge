import type { LockDatumParams } from './plutusData.js';

export type LockSpendParams = LockDatumParams & {
  lockTxHash: string;
  lockOutputIndex: number;
};
