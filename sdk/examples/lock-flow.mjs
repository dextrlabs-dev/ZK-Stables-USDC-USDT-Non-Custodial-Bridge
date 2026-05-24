#!/usr/bin/env node
/**
 * POC 1 — EVM Lock Flow via zk-stables-sdk
 *
 * Demonstrates an end-to-end EVM LOCK (mint to Midnight) using the SDK.
 *
 * Prerequisites:
 *   1. Local stack running:  ./scripts/start-local-stack.sh
 *   2. Relayer at http://127.0.0.1:8787
 *   3. Anvil at http://127.0.0.1:8545 with deployed contracts
 *
 * Usage:
 *   node sdk/examples/lock-flow.mjs
 *   node sdk/examples/lock-flow.mjs --relayer-url http://localhost:8787
 */
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

// -- Local dev import (before npm publish, use the built dist) --
// After publishing: import { ZkStablesSdk } from 'zk-stables-sdk';
import { ZkStablesSdk } from '../dist/index.js';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const { values: args } = parseArgs({
  options: {
    'relayer-url': { type: 'string', default: 'http://127.0.0.1:8787' },
    'rpc-url':     { type: 'string', default: 'http://127.0.0.1:8545' },
    'amount':      { type: 'string', default: '1' },
  },
});

const RELAYER = args['relayer-url'];
const RPC     = args['rpc-url'];
const AMOUNT  = BigInt(Number(args['amount']) * 1_000_000); // 6-decimal USDC

// Anvil default account #0
const PK  = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const acc = privateKeyToAccount(PK);

const chain   = { ...foundry, id: 31337 };
const pub     = createPublicClient({ chain, transport: http(RPC) });
const wallet  = createWalletClient({ account: acc, chain, transport: http(RPC) });

const erc20Abi = parseAbi([
  'function approve(address,uint256) external returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);
const poolAbi = parseAbi([
  'function lock(address token,uint256 amount,address recipient,bytes32 nonce) external',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function loadAddresses() {
  try {
    const raw = await readFile('/tmp/zk-stables-anvil-addrs.json', 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {
      USDC: '0x7a2088a1bFc9d81c55368AE168C2C02570cB814F',
      POOL: '0xc5a5C42992dECbae36851359345FE25997F5C42d',
    };
  }
}

function ts() {
  return new Date().toISOString().slice(11, 23);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== POC 1: EVM Lock Flow via zk-stables-sdk ===\n');

  const addrs = await loadAddresses();
  const USDC  = addrs.USDC || addrs.usdc;
  const POOL  = addrs.POOL || addrs.poolLock || addrs.pool;
  console.log(`USDC: ${USDC}`);
  console.log(`Pool: ${POOL}`);
  console.log(`Relayer: ${RELAYER}\n`);

  // 1. Wait for relayer health
  console.log(`[${ts()}] Checking relayer health...`);
  const health = await fetch(`${RELAYER}/v1/health/chains`).then(r => r.json());
  console.log(`[${ts()}] Relayer chains: ${JSON.stringify(health.relayerBridge)}\n`);

  // 2. Approve + lock on EVM
  const nonce = '0x' + randomBytes(32).toString('hex');
  const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

  console.log(`[${ts()}] Approving ${AMOUNT} USDC for pool...`);
  const approveTx = await wallet.writeContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'approve',
    args: [POOL, AMOUNT],
  });
  await pub.waitForTransactionReceipt({ hash: approveTx });

  console.log(`[${ts()}] Locking ${AMOUNT} USDC in pool...`);
  const lockTx = await wallet.writeContract({
    address: POOL,
    abi: poolAbi,
    functionName: 'lock',
    args: [USDC, AMOUNT, recipient, nonce],
  });
  const lockReceipt = await pub.waitForTransactionReceipt({ hash: lockTx });
  console.log(`[${ts()}] Lock tx: ${lockTx}  block: ${lockReceipt.blockNumber}\n`);

  // 3. Submit intent via SDK
  const sdk = new ZkStablesSdk({ relayerUrl: RELAYER });

  console.log(`[${ts()}] Submitting LOCK intent via SDK...`);
  const { jobId, job } = await sdk.lock({
    sourceChain: 'evm',
    destinationChain: 'midnight',
    asset: 'USDC',
    assetKind: 0,
    amount: args['amount'],
    recipient,
    source: {
      evm: {
        txHash: lockTx,
        logIndex: 0,
        blockNumber: String(lockReceipt.blockNumber),
        token: USDC,
        nonce,
      },
    },
  });
  console.log(`[${ts()}] Job created: ${jobId}  phase: ${job.phase}\n`);

  // 4. Subscribe to job progress
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
        console.log(`LOCK COMPLETED in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        if (j.destinationHint) {
          console.log('\nDestination hint:');
          j.destinationHint.split('\n').filter(Boolean).forEach(l => console.log(`  ${l.trim()}`));
        }
        if (j.depositCommitmentHex) {
          console.log(`\nDeposit commitment: 0x${j.depositCommitmentHex}`);
        }
        console.log(`${'='.repeat(50)}`);
        resolve();
      }

      if (j.phase === 'failed') {
        clearTimeout(timeout);
        console.error(`\nLOCK FAILED: ${j.error}`);
        reject(new Error(j.error));
      }
    });

    sdk.subscribeJob(jobId, 2000);
  });

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
