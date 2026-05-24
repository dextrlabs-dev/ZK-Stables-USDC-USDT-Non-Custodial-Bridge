#!/usr/bin/env node
/**
 * POC 2 — Burn/Redeem Flow via zk-stables-sdk
 *
 * Demonstrates the BURN path: Midnight -> EVM underlying unlock.
 *
 * Prerequisites:
 *   1. A prior LOCK must have completed (provides the burn commitment)
 *   2. Local stack running with relayer at http://127.0.0.1:8787
 *
 * Usage:
 *   node sdk/examples/burn-redeem-cli.mjs --burn-commitment <64-char-hex>
 *   node sdk/examples/burn-redeem-cli.mjs --burn-commitment abc123... --amount 1 --payout 0x...
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

// -- Local dev import (before npm publish, use the built dist) --
// After publishing: import { ZkStablesSdk } from 'zk-stables-sdk';
import { ZkStablesSdk } from '../dist/index.js';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const { values: args } = parseArgs({
  options: {
    'burn-commitment': { type: 'string' },
    'amount':          { type: 'string', default: '1' },
    'payout':          { type: 'string', default: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
    'relayer-url':     { type: 'string', default: 'http://127.0.0.1:8787' },
    'source-chain':    { type: 'string', default: 'midnight' },
    'dest-chain':      { type: 'string', default: 'evm' },
    'asset':           { type: 'string', default: 'USDC' },
    'help':            { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help) {
  console.log(`
Usage: node burn-redeem-cli.mjs --burn-commitment <hex> [options]

Options:
  --burn-commitment  64-char hex (32 bytes) binding the burn to a deposit (REQUIRED)
  --amount           Token amount in human units (default: 1)
  --payout           Recipient address on destination chain (default: Anvil account #0)
  --relayer-url      Relayer endpoint (default: http://127.0.0.1:8787)
  --source-chain     Source chain: midnight | evm | cardano (default: midnight)
  --dest-chain       Destination chain (default: evm)
  --asset            USDC | USDT (default: USDC)
  -h, --help         Show this help
`);
  process.exit(0);
}

const burnCommitment = args['burn-commitment'];
if (!burnCommitment) {
  console.error('Error: --burn-commitment is required. Run with --help for usage.');
  process.exit(1);
}

const bc = burnCommitment.replace(/^0x/, '');
if (!/^[0-9a-fA-F]{64}$/.test(bc)) {
  console.error('Error: --burn-commitment must be 64 hex characters (32 bytes).');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ts() {
  return new Date().toISOString().slice(11, 23);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const RELAYER = args['relayer-url'];
  console.log('=== POC 2: Burn/Redeem Flow via zk-stables-sdk ===\n');
  console.log(`Relayer:         ${RELAYER}`);
  console.log(`Source chain:    ${args['source-chain']}`);
  console.log(`Dest chain:      ${args['dest-chain']}`);
  console.log(`Asset:           ${args.asset}`);
  console.log(`Amount:          ${args.amount}`);
  console.log(`Payout address:  ${args.payout}`);
  console.log(`Burn commitment: 0x${bc}\n`);

  // Build source anchor for Midnight
  const source = {};
  if (args['source-chain'] === 'midnight') {
    const midContract = await fetch(`${RELAYER}/v1/midnight/contract`)
      .then(r => r.json())
      .catch(() => ({}));

    source.midnight = {
      txId: randomBytes(32).toString('hex'),
      contractAddress: midContract.contractAddress,
      destChainId: 2,
    };
    if (midContract.contractAddress) {
      console.log(`Midnight contract: ${midContract.contractAddress}`);
    }
  }

  // Submit intent via SDK
  const sdk = new ZkStablesSdk({ relayerUrl: RELAYER });

  console.log(`\n[${ts()}] Submitting BURN intent via SDK...`);
  const { jobId, job } = await sdk.burn({
    sourceChain: args['source-chain'],
    destinationChain: args['dest-chain'],
    asset: args.asset,
    assetKind: 0,
    amount: args.amount,
    recipient: args.payout,
    burnCommitmentHex: bc,
    source,
  });
  console.log(`[${ts()}] Job created: ${jobId}  phase: ${job.phase}\n`);

  // Subscribe to job progress
  let lastPhase = job.phase;
  const startTime = Date.now();

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Job timed out after 15 minutes')), 900_000);

    sdk.on('job', (j) => {
      if (j.phase !== lastPhase) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[${ts()}] Phase: ${lastPhase} -> ${j.phase}  (+${elapsed}s)`);
        lastPhase = j.phase;
      }

      if (j.phase === 'completed') {
        clearTimeout(timeout);
        console.log(`\n${'='.repeat(50)}`);
        console.log(`BURN COMPLETED in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        if (j.destinationHint) {
          console.log('\nDestination hint:');
          j.destinationHint.split('\n').filter(Boolean).forEach(l => console.log(`  ${l.trim()}`));
        }
        console.log(`${'='.repeat(50)}`);
        resolve();
      }

      if (j.phase === 'failed') {
        clearTimeout(timeout);
        console.error(`\nBURN FAILED: ${j.error}`);
        reject(new Error(j.error));
      }
    });

    sdk.subscribeJob(jobId, 2000);
  });

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
