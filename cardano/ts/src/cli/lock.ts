import { createDefaultContext } from '../context.js';
import { submitLock } from '../ops/lock.js';
import { buildLockDatumParamsFromEnv } from './common.js';
import type { Asset } from '@meshsdk/common';

async function main() {
  const ctx = createDefaultContext();
  const params = await buildLockDatumParamsFromEnv(ctx);

  const lovelace = process.env.LOCK_LOVELACE ?? '2000000';
  const assets: Asset[] = [{ unit: 'lovelace', quantity: lovelace }];
  const extraUnit = process.env.LOCK_TOKEN_UNIT;
  const extraQty = process.env.LOCK_TOKEN_QUANTITY;
  if (extraUnit && extraQty) {
    assets.push({ unit: extraUnit, quantity: extraQty });
  }

  const { txHash, scriptAddress } = await submitLock(ctx, { ...params, assets });
  console.log(JSON.stringify({ txHash, scriptAddress }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
