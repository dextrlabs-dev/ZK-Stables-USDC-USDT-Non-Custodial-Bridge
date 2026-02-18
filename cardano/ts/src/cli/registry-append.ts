import { randomBytes } from 'node:crypto';
import { createDefaultContext } from '../context.js';
import { submitRegistryAppend } from '../ops/registryAppend.js';
import { parseTxRef } from './common.js';

async function main() {
  const op = process.env.REGISTRY_OPERATOR_VKEY_HASH?.trim();
  if (!op) throw new Error('Set REGISTRY_OPERATOR_VKEY_HASH');

  const ref = process.argv[2] ?? process.env.REGISTRY_UTXO_REF;
  if (!ref) throw new Error('Usage: registry-append.ts <txHash#ix> [nonceHex] or set REGISTRY_UTXO_REF');

  const nonceHex =
    process.argv[3] ?? process.env.REGISTRY_NONCE_HEX ?? randomBytes(32).toString('hex');

  const ctx = createDefaultContext();
  const { txHash, ix } = parseTxRef(ref);
  const { txHash: out } = await submitRegistryAppend(ctx, op, txHash, ix, nonceHex);
  console.log(JSON.stringify({ txHash: out, nonceHex }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
