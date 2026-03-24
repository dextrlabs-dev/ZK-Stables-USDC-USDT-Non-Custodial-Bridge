#!/usr/bin/env node
/** Minimal 1 LOCK + 1 BURN test — fresh Anvil deploy. */
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { randomBytes } from 'node:crypto';

const R = 'http://127.0.0.1:8787', RPC = 'http://127.0.0.1:8545';
const USDC = '0x7a2088a1bFc9d81c55368AE168C2C02570cB814F';
const POOL = '0xc5a5C42992dECbae36851359345FE25997F5C42d';
const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const acc = privateKeyToAccount(PK);
const chain = { ...foundry, id: 31337 };
const pub = createPublicClient({ chain, transport: http(RPC) });
const w = createWalletClient({ account: acc, chain, transport: http(RPC) });
const erc20 = parseAbi(['function approve(address,uint256) external returns (bool)','function balanceOf(address) view returns (uint256)']);
const poolAbi = parseAbi(['function lock(address token,uint256 amount,address recipient,bytes32 nonce) external']);

async function post(body) {
  const ep = body.operation === 'LOCK' ? '/v1/intents/lock' : '/v1/intents/burn';
  const r = await fetch(`${R}${ep}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(d)}`); return d;
}
async function wait(id, ms=900000) {
  const t=Date.now();
  while (Date.now()-t<ms) {
    const r = await fetch(`${R}/v1/jobs/${id}`); const j = await r.json();
    if (j.phase==='completed'||j.phase==='failed') return j;
    process.stdout.write('.');
    await new Promise(r=>setTimeout(r,8000));
  }
  throw new Error('timeout');
}

async function main() {
  console.log('Waiting for relayer midnight bridge...');
  for (let i = 0; i < 300; i++) {
    try {
      const h = await (await fetch(`${R}/v1/health/chains`)).json();
      if (h.relayerBridge?.midnight) { console.log('Midnight bridge ready!'); break; }
      if (i % 10 === 0) console.log(`  [${i*5}s] midnight=${h.relayerBridge?.midnight}`);
    } catch {}
    await new Promise(r => setTimeout(r, 5000));
  }

  const mid = await (await fetch(`${R}/v1/midnight/contract`)).json();
  console.log(`Registry: ${mid.contractAddress}\n`);

  // LOCK 1 USDC → Midnight
  const nonce = '0x'+randomBytes(32).toString('hex');
  const apTx = await w.writeContract({ address:USDC, abi:erc20, functionName:'approve', args:[POOL, 1000000n] });
  await pub.waitForTransactionReceipt({hash:apTx});
  const lkTx = await w.writeContract({ address:POOL, abi:poolAbi, functionName:'lock', args:[USDC, 1000000n, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', nonce] });
  const lkR = await pub.waitForTransactionReceipt({hash:lkTx});
  console.log(`LOCK  approve=${apTx}`);
  console.log(`LOCK  lockTx =${lkTx} block=${lkR.blockNumber}`);

  const li = await post({ operation:'LOCK', sourceChain:'evm', destinationChain:'midnight', asset:'USDC', assetKind:0, amount:'1',
    recipient:'0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    source:{ evm:{ txHash:lkTx, logIndex:0, blockNumber:String(lkR.blockNumber), token:USDC, nonce } } });
  console.log(`LOCK  jobId=${li.jobId}`);
  process.stdout.write('  waiting');
  const lj = await wait(li.jobId);
  console.log(`\n  LOCK phase=${lj.phase}`);
  if (lj.error) console.log(`  ERROR: ${lj.error}`);
  if (lj.destinationHint) { for (const l of lj.destinationHint.split('\n').filter(Boolean)) console.log(`  ${l.trim()}`); }

  // BURN 1 USDC from Midnight → EVM (uses lock nonce as depositCommitment)
  const bc = nonce.replace(/^0x/,'');
  const midTxId = randomBytes(32).toString('hex');
  console.log(`\nBURN  burnCommitment=0x${bc}`);
  const bi = await post({ operation:'BURN', sourceChain:'midnight', destinationChain:'evm', asset:'USDC', assetKind:0, amount:'1',
    recipient:acc.address, burnCommitmentHex:bc,
    source:{ midnight:{ txId:midTxId, contractAddress:mid.contractAddress, destChainId:2 } } });
  console.log(`BURN  jobId=${bi.jobId}`);
  process.stdout.write('  waiting');
  const bj = await wait(bi.jobId);
  console.log(`\n  BURN phase=${bj.phase}`);
  if (bj.error) console.log(`  ERROR: ${bj.error}`);
  if (bj.destinationHint) { for (const l of bj.destinationHint.split('\n').filter(Boolean)) console.log(`  ${l.trim()}`); }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`LOCK: ${lj.phase}  |  BURN: ${bj.phase}`);
  console.log(`${'═'.repeat(50)}`);
  process.exit(lj.phase==='completed' && bj.phase==='completed' ? 0 : 1);
}
main().catch(e=>{ console.error(e); process.exit(1); });
