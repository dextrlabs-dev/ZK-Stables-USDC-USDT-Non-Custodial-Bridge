import { createDefaultContext } from '../context.js';
import { submitRegistryInit } from '../ops/registryInit.js';

async function main() {
  const op = process.env.REGISTRY_OPERATOR_VKEY_HASH?.trim();
  if (!op) throw new Error('Set REGISTRY_OPERATOR_VKEY_HASH (56 hex / 28-byte key hash)');

  const lovelace = process.env.REGISTRY_INIT_LOVELACE ?? '3000000';
  const ctx = createDefaultContext();
  const { txHash, scriptAddress } = await submitRegistryInit(ctx, op, lovelace);
  console.log(JSON.stringify({ txHash, scriptAddress }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
