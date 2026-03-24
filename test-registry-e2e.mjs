#!/usr/bin/env node
/**
 * End-to-end test for zk-stables-registry multi-deposit bridge.
 * 1. LOCK USDC  (EVM→Midnight)  — registers deposit with nonce as depositCommitment
 * 2. LOCK USDT  (EVM→Midnight)  — registers another deposit
 * 3. BURN USDC  (Midnight→EVM)  — finalizeBurn using LOCK-USDC's deposit commitment
 * 4. BURN USDT  (Midnight→EVM)  — finalizeBurn using LOCK-USDT's deposit commitment
 */
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { randomBytes } from 'node:crypto';

const RELAYER = 'http://127.0.0.1:8787';
const RPC = 'http://127.0.0.1:8545';

const USDC    = '0x9D3DA37d36BB0B825CD319ed129c2872b893f538';
const USDT    = '0x59C4e2c6a6dC27c259D6d067a039c831e1ff4947';
const POOL    = '0x9d136eEa063eDE5418A6BC7bEafF009bBb6CFa70';
const W_USDC  = '0x687bB6c57915aa2529EfC7D2a26668855e022fAE';
const W_USDT  = '0x49149a233de6E4cD6835971506F47EE5862289c1';

const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const account = privateKeyToAccount(PK);
const USER = account.address;
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const chain = { ...foundry, id: 31337 };
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

const erc20Abi = parseAbi([
  'function approve(address,uint256) external returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);
const poolAbi = parseAbi([
  'function lock(address token, uint256 amount, address recipient, bytes32 nonce) external',
]);

const DECIMALS = 6;
const report = [];

function amountUnits(dec) { return BigInt(dec) * 10n ** BigInt(DECIMALS); }

let mineInterval;
function startAutoMine() {
  mineInterval = setInterval(async () => {
    try {
      await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'evm_mine', params: [], id: Date.now() }),
      });
    } catch {}
  }, 2000);
}
function stopAutoMine() { clearInterval(mineInterval); }

async function evmLock(tokenAddr, amount, label) {
  const nonce = '0x' + randomBytes(32).toString('hex');
  console.log(`\n[${label}] Approving ${amount}...`);
  const approveTx = await wallet.writeContract({
    address: tokenAddr, abi: erc20Abi,
    functionName: 'approve', args: [POOL, amountUnits(amount)],
  });
  await pub.waitForTransactionReceipt({ hash: approveTx });

  console.log(`[${label}] Locking ${amount} on PoolLock...`);
  const lockTx = await wallet.writeContract({
    address: POOL, abi: poolAbi,
    functionName: 'lock', args: [tokenAddr, amountUnits(amount), RECIPIENT, nonce],
  });
  const lockReceipt = await pub.waitForTransactionReceipt({ hash: lockTx });
  console.log(`  lock tx: ${lockTx}  block: ${lockReceipt.blockNumber}`);
  return { approveTx, lockTx, lockBlock: String(lockReceipt.blockNumber), nonce };
}

async function postIntent(body) {
  const ep = body.operation === 'LOCK' ? '/v1/intents/lock' : '/v1/intents/burn';
  const res = await fetch(`${RELAYER}${ep}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`POST ${ep} ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function waitJob(jobId, timeoutMs = 300_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${RELAYER}/v1/jobs/${jobId}`);
    const j = await res.json();
    if (j.phase === 'completed') return j;
    if (j.phase === 'failed') return j;
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`Job ${jobId} timed out after ${timeoutMs}ms`);
}

async function getBalances() {
  const [usdc, usdt, wUsdc, wUsdt] = await Promise.all([
    pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [USER] }),
    pub.readContract({ address: USDT, abi: erc20Abi, functionName: 'balanceOf', args: [USER] }),
    pub.readContract({ address: W_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [USER] }),
    pub.readContract({ address: W_USDT, abi: erc20Abi, functionName: 'balanceOf', args: [USER] }),
  ]);
  return { usdc, usdt, wUsdc, wUsdt };
}

function fmtBal(b) {
  return `USDC=${formatUnits(b.usdc,DECIMALS)} USDT=${formatUnits(b.usdt,DECIMALS)} zkUSDC=${formatUnits(b.wUsdc,DECIMALS)} zkUSDT=${formatUnits(b.wUsdt,DECIMALS)}`;
}

// ===================== MAIN =====================
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║     ZK-STABLES REGISTRY — MULTI-DEPOSIT E2E TEST               ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  startAutoMine();

  const midRes = await fetch(`${RELAYER}/v1/midnight/contract`);
  const { contractAddress: MID_ADDR } = await midRes.json();
  console.log(`Midnight registry contract: ${MID_ADDR}`);
  
  const before = await getBalances();
  console.log(`Before: ${fmtBal(before)}`);

  // Track lock nonces (= deposit commitments) for later burns
  let lockUsdcNonce, lockUsdtNonce;

  // ============ PHASE 1: LOCK USDC (5 → Midnight) ============
  {
    const label = 'LOCK-USDC→Midnight';
    const { approveTx, lockTx, lockBlock, nonce } = await evmLock(USDC, 5, label);
    lockUsdcNonce = nonce;
    const intent = await postIntent({
      operation: 'LOCK', sourceChain: 'evm', destinationChain: 'midnight',
      asset: 'USDC', assetKind: 0, amount: '5', recipient: RECIPIENT,
      source: { evm: { txHash: lockTx, logIndex: 0, blockNumber: lockBlock, token: USDC, nonce } },
    });
    console.log(`  jobId: ${intent.jobId}`);
    const job = await waitJob(intent.jobId);
    report.push({ op: label, approveTx, lockTx, nonce, jobId: intent.jobId, phase: job.phase, hint: job.destinationHint, error: job.error });
    console.log(`  ${job.phase === 'completed' ? '✓' : '✗'} ${label} — ${job.phase}`);
  }

  // ============ PHASE 2: LOCK USDT (3 → Midnight) ============
  {
    const label = 'LOCK-USDT→Midnight';
    const { approveTx, lockTx, lockBlock, nonce } = await evmLock(USDT, 3, label);
    lockUsdtNonce = nonce;
    const intent = await postIntent({
      operation: 'LOCK', sourceChain: 'evm', destinationChain: 'midnight',
      asset: 'USDT', assetKind: 1, amount: '3', recipient: RECIPIENT,
      source: { evm: { txHash: lockTx, logIndex: 0, blockNumber: lockBlock, token: USDT, nonce } },
    });
    console.log(`  jobId: ${intent.jobId}`);
    const job = await waitJob(intent.jobId);
    report.push({ op: label, approveTx, lockTx, nonce, jobId: intent.jobId, phase: job.phase, hint: job.destinationHint, error: job.error });
    console.log(`  ${job.phase === 'completed' ? '✓' : '✗'} ${label} — ${job.phase}`);
  }

  const afterLock = await getBalances();
  console.log(`\nAfter LOCKs: ${fmtBal(afterLock)}`);

  // ============ PHASE 3: BURN USDC (Midnight→EVM, 2) ============
  // burnCommitmentHex = the deposit commitment from the LOCK (= the lock nonce)
  {
    const label = 'BURN-USDC-Midnight→EVM';
    const burnCommitmentHex = lockUsdcNonce.replace(/^0x/, '');
    const midTxId = randomBytes(32).toString('hex');
    console.log(`\n[${label}] burnCommitment (from lock nonce): 0x${burnCommitmentHex}`);
    const intent = await postIntent({
      operation: 'BURN', sourceChain: 'midnight', destinationChain: 'evm',
      asset: 'USDC', assetKind: 0, amount: '2', recipient: USER,
      burnCommitmentHex,
      source: { midnight: { txId: midTxId, contractAddress: MID_ADDR, destChainId: 2 } },
    });
    console.log(`  jobId: ${intent.jobId}`);
    const job = await waitJob(intent.jobId);
    report.push({ op: label, burnCommitmentHex: '0x' + burnCommitmentHex, midTxId, jobId: intent.jobId, phase: job.phase, hint: job.destinationHint, error: job.error });
    console.log(`  ${job.phase === 'completed' ? '✓' : '✗'} ${label} — ${job.phase}`);
  }

  // ============ PHASE 4: BURN USDT (Midnight→EVM, 1) ============
  {
    const label = 'BURN-USDT-Midnight→EVM';
    const burnCommitmentHex = lockUsdtNonce.replace(/^0x/, '');
    const midTxId = randomBytes(32).toString('hex');
    console.log(`\n[${label}] burnCommitment (from lock nonce): 0x${burnCommitmentHex}`);
    const intent = await postIntent({
      operation: 'BURN', sourceChain: 'midnight', destinationChain: 'evm',
      asset: 'USDT', assetKind: 1, amount: '1', recipient: USER,
      burnCommitmentHex,
      source: { midnight: { txId: midTxId, contractAddress: MID_ADDR, destChainId: 2 } },
    });
    console.log(`  jobId: ${intent.jobId}`);
    const job = await waitJob(intent.jobId);
    report.push({ op: label, burnCommitmentHex: '0x' + burnCommitmentHex, midTxId, jobId: intent.jobId, phase: job.phase, hint: job.destinationHint, error: job.error });
    console.log(`  ${job.phase === 'completed' ? '✓' : '✗'} ${label} — ${job.phase}`);
  }

  stopAutoMine();
  const afterBurn = await getBalances();

  // ===================== FINAL REPORT =====================
  console.log('\n\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║           FULL TRANSACTION REPORT — TX HASHES                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  
  for (const r of report) {
    console.log(`\n── ${r.op} ──`);
    console.log(`  jobId:  ${r.jobId}`);
    console.log(`  phase:  ${r.phase}`);
    if (r.error)     console.log(`  ERROR:  ${r.error}`);
    if (r.approveTx) console.log(`  EVM approve tx:   ${r.approveTx}`);
    if (r.lockTx)    console.log(`  EVM lock tx:      ${r.lockTx}`);
    if (r.nonce)     console.log(`  lock nonce:       ${r.nonce}`);
    if (r.burnCommitmentHex) console.log(`  burn commitment:  ${r.burnCommitmentHex}`);
    if (r.midTxId)   console.log(`  midnight txId:    ${r.midTxId}`);
    if (r.hint) {
      console.log(`  relayer log:`);
      for (const line of r.hint.split('\n').filter(l => l.trim())) {
        console.log(`    ${line.trim()}`);
      }
    }
  }

  console.log(`\n── EVM Balance Changes ──`);
  console.log(`  Before: ${fmtBal(before)}`);
  console.log(`  After:  ${fmtBal(afterBurn)}`);
  console.log(`  USDC Δ  : ${formatUnits(afterBurn.usdc - before.usdc, DECIMALS)}`);
  console.log(`  USDT Δ  : ${formatUnits(afterBurn.usdt - before.usdt, DECIMALS)}`);
  console.log(`  zkUSDC Δ: ${formatUnits(afterBurn.wUsdc - before.wUsdc, DECIMALS)}`);
  console.log(`  zkUSDT Δ: ${formatUnits(afterBurn.wUsdt - before.wUsdt, DECIMALS)}`);

  const jobsRes = await fetch(`${RELAYER}/v1/jobs`);
  const jobs = await jobsRes.json();
  console.log(`\n── All Relayer Jobs (${jobs.jobs.length} total) ──`);
  for (const j of jobs.jobs) {
    console.log(`  ${j.id}  ${j.intent?.operation ?? '?'}/${j.intent?.asset ?? '?'}  ${j.intent?.sourceChain ?? '?'}→${j.intent?.destinationChain ?? '?'}  phase=${j.phase}`);
  }

  const passed = report.filter(r => r.phase === 'completed').length;
  const total = report.length;
  console.log(`\n═══════ RESULT: ${passed}/${total} ${passed === total ? 'PASS ✓' : 'PARTIAL'} ═══════\n`);
  process.exit(passed === total ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
