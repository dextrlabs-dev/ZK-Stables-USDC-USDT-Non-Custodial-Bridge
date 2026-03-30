/**
 * One-shot: mint WUSDC/WUSDT and leave it at lock_pool (hold) for Cardano→EVM BURN tests.
 * Usage: from zk-stables-relayer with env loaded (see scripts/test-cardano-operator-burn.sh).
 */
import { randomBytes } from 'node:crypto';
import pino from 'pino';
import { ensureCardanoBridgeWallet } from '../src/adapters/cardanoPayout.js';
import { lockMintHoldAtScriptOnly } from '../src/adapters/cardanoAiken/lockPoolBridge.js';

/** Keep stdout as a single JSON line for shell wrappers (lockPoolBridge may log to stderr). */
const logger = pino({ level: 'silent' });

async function main() {
  const ctx = await ensureCardanoBridgeWallet(logger);
  if (!ctx) throw new Error('Cardano bridge wallet not configured');
  // Hold datum has `bridge_operator = None` → only `recipient` may BridgeRelease. Use change address
  // so the relayer Mesh wallet is the required signer for operator burn tests.
  const rec = ctx.wallet.getChangeAddress()?.trim();
  if (!rec) throw new Error('MeshWallet has no change address');

  const commitment = randomBytes(32).toString('hex');
  const amountStr = process.env.TEST_HOLD_AMOUNT ?? '0.1';
  const asset = (process.env.TEST_HOLD_ASSET as 'USDC' | 'USDT') ?? 'USDC';

  const r = await lockMintHoldAtScriptOnly({
    recipientBech32: rec,
    amountStr,
    asset,
    recipientCommitmentHex: commitment,
    logger,
  });

  // Single-line JSON for shell jq
  console.log(
    JSON.stringify({
      commitment,
      amountStr,
      asset,
      lockTxHash: r.lockTxHash,
      lockOutputIndex: r.lockOutputIndex,
      scriptAddress: r.scriptAddress,
      detail: r.detail,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
