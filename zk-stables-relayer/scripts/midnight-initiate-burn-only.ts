/**
 * Ops helper: call registry `initiateBurn(deposit, destChain, recipientComm)` using the relayer Midnight wallet.
 * Same env as `npm start` (BIP39_MNEMONIC / GENESIS_SEED_HASH_HEX, RELAYER_MIDNIGHT_*).
 *
 * Prefer **`POST /v1/midnight/initiate-burn`** on the running relayer (ops matrix uses it by default): a second
 * process here can block on the same LevelDB path while the relayer is proving, so `wallet.submitTransaction` never runs.
 *
 * Usage: npx tsx scripts/midnight-initiate-burn-only.ts <depositCommitmentHex64> <recipientCommHex64> [destChainDecimal]
 * Prints one JSON line: { "txId", "txHash" }.
 *
 * Before `initiateBurn`, runs indexer-only preflight (`readMidnightRegistryDepositBurnPreflight`).
 * Skip with `MIDNIGHT_INITIATE_BURN_SKIP_PREFLIGHT=1` (not recommended).
 */
import { Buffer } from 'node:buffer';
import { writeSync } from 'node:fs';
import pino from 'pino';
import { ensureMidnightRelayer, readMidnightRegistryDepositBurnPreflight } from '../src/midnight/service.js';

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, '').trim().toLowerCase();
  if (h.length !== 64 || !/^[0-9a-f]+$/u.test(h)) throw new Error('expected 32-byte hex (64 chars)');
  return Uint8Array.from(Buffer.from(h, 'hex'));
}

const logger = pino({ level: 'info', transport: undefined });
const depHex = process.argv[2]?.trim();
const commHex = process.argv[3]?.trim();
const destStr = process.argv[4]?.trim() ?? '2';
if (!depHex || !commHex) {
  console.error('usage: npx tsx scripts/midnight-initiate-burn-only.ts <depositHex64> <recipientCommHex64> [destChain]');
  process.exit(1);
}

const destChainId = BigInt(destStr);
const depBytes = hexToBytes32(depHex);

const skipPf =
  process.env.MIDNIGHT_INITIATE_BURN_SKIP_PREFLIGHT === '1' || process.env.MIDNIGHT_INITIATE_BURN_SKIP_PREFLIGHT === 'true';
if (!skipPf) {
  const pre = await readMidnightRegistryDepositBurnPreflight(logger, depBytes);
  const preLine = `[midnight-initiate-burn] preflight: ${pre.okForInitiateBurn ? 'OK' : 'BLOCKED'} — ${pre.reason}\n`;
  try {
    writeSync(2, preLine);
  } catch {
    process.stderr.write(preLine);
  }
  if (!pre.okForInitiateBurn) {
    console.error(
      JSON.stringify({
        error: 'deposit_not_ready_for_initiateBurn',
        preflight: pre,
      }),
    );
    process.exit(2);
  }
}

const h = await ensureMidnightRelayer(logger);
if (!h) {
  console.error(JSON.stringify({ error: 'Midnight relayer not initialized (RELAYER_MIDNIGHT_ENABLED, contract, wallet)' }));
  process.exit(1);
}

const hbMs = Math.max(10_000, Math.min(120_000, Number.parseInt(process.env.MIDNIGHT_INITIATE_BURN_HEARTBEAT_MS ?? '20000', 10) || 20_000));
const t0 = Date.now();
const hb = setInterval(() => {
  const msg = `[midnight-initiate-burn] initiateBurn still running… ${Math.round((Date.now() - t0) / 1000)}s (proof server; set MIDNIGHT_INITIATE_BURN_HEARTBEAT_MS)\n`;
  try {
    writeSync(2, msg);
  } catch {
    process.stderr.write(msg);
  }
}, hbMs);
let r;
try {
  r = await h.callTx.initiateBurn(depBytes, destChainId, hexToBytes32(commHex));
} catch (e) {
  const msg = String(e);
  if (/Not active|Unknown deposit/u.test(msg)) {
    console.error(
      JSON.stringify({
        error: 'initiateBurn_rejected',
        message: msg,
        depositCommitmentHex: depHex,
        hint:
          'If preflight was skipped or raced a tx, re-run without MIDNIGHT_INITIATE_BURN_SKIP_PREFLIGHT. Otherwise mint a new position or fix RELAYER_MIDNIGHT_CONTRACT_ADDRESS.',
      }),
    );
    process.exit(2);
  }
  throw e;
} finally {
  clearInterval(hb);
}
console.log(
  JSON.stringify({
    txId: String(r.public.txId),
    txHash: String(r.public.txHash),
    contractAddress: h.contractAddress,
  }),
);
