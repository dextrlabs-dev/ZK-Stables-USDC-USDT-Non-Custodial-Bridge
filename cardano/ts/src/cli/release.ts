import { createDefaultContext } from '../context.js';
import { submitRelease } from '../ops/release.js';
import { buildLockDatumParamsFromEnv, parseTxRef } from './common.js';

async function main() {
  const ref = process.argv[2] ?? process.env.LOCK_UTXO_REF;
  if (!ref) throw new Error('Usage: release.ts <txHash#outputIndex> or set LOCK_UTXO_REF');

  const ctx = createDefaultContext();
  const { txHash, ix } = parseTxRef(ref);
  const params = await buildLockDatumParamsFromEnv(ctx);
  const { txHash: out } = await submitRelease(ctx, {
    ...params,
    lockTxHash: txHash,
    lockOutputIndex: ix,
  });
  console.log(JSON.stringify({ txHash: out }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
