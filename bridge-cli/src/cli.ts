#!/usr/bin/env node
import { Command } from 'commander';
import { isAddress, type Address, type Hex } from 'viem';
import { createPublicClient, http } from 'viem';
import { foundry } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { assetKind, loadEnv, loadRelayerBaseUrl, wrappedZkForAsset } from './config.js';
import { evmApproveAndLock, evmBurnZk, parseBurnedFromReceiptWithIndex, type ParsedBurned } from './evmOps.js';
import {
  getJob,
  postBurnIntent,
  postLockIntent,
  waitJob,
  type BurnIntentBody,
  type LockIntentBody,
  type RelayerJob,
} from './relayer.js';
import { buildBalanceSnapshot, dashboardConfigFromEnv } from './balances/snapshot.js';
import { runDashboard } from './dashboard.js';

/**
 * Merge options from program root down to the invoked subcommand (leaf wins).
 * Commander only puts `--addresses-json` etc. on `program.opts()` when they are
 * registered on the root; nested `cmd.opts()` does not include parent flags.
 */
function mergedOpts(cmd: Command): Record<string, unknown> {
  const root = cmd.parent ?? cmd;
  const chain: Command[] = [];
  let c: Command | null = cmd;
  while (c) {
    chain.push(c);
    c = c.parent;
  }
  const out: Record<string, unknown> = { ...root.opts() };
  for (let i = chain.length - 1; i >= 0; i--) {
    Object.assign(out, chain[i]!.opts());
  }
  return out;
}

/** Commander may pass `--follow false` as the string `"false"` (still truthy in JS). */
function wantFollow(opts: { follow?: unknown }, defaultFollow = true): boolean {
  const v = opts.follow;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  if (v === true || v === 'true') return true;
  return defaultFollow;
}

/** Poll relayer job with stderr heartbeats so Midnight/Cardano steps do not look hung. */
function waitJobWithHeartbeats(
  baseUrl: string,
  jobId: string,
  pollMs: number,
  timeoutMs: number,
): Promise<RelayerJob> {
  return waitJob(baseUrl, jobId, {
    pollMs,
    timeoutMs,
    onProgress: (j, elapsedMs) => {
      const sec = Math.round(elapsedMs / 1000);
      const tmo = Math.round(timeoutMs / 1000);
      process.stderr.write(
        `[zk-bridge] waiting job=${jobId} phase=${j.phase} ${sec}s / ${tmo}s timeout — Ctrl+C then: zk-bridge job ${jobId} --json\n`,
      );
    },
  });
}

function outJson(flag: boolean, obj: unknown) {
  if (flag) {
    process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
  } else {
    process.stdout.write(`${typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)}\n`);
  }
}

function normHex64(h: string): string {
  const x = h.replace(/^0x/i, '').trim().toLowerCase();
  if (x.length !== 64 || !/^[0-9a-f]+$/u.test(x)) {
    throw new Error('Expected 64 hex characters (32 bytes), optional 0x prefix.');
  }
  return x;
}

const program = new Command();
program
  .name('zk-bridge')
  .description(
    'ZK-Stables bridge operator CLI: live balances (dashboard), EVM pool lock → relayer LOCK (mint zk), ' +
      'and redeem flows per BURN_ANCHOR_SPEC.',
  )
  .option('--relayer-url <url>', 'Relayer base URL (or BRIDGE_CLI_RELAYER_URL)')
  .option('--rpc-url <url>', 'EVM JSON-RPC (or BRIDGE_CLI_EVM_RPC_URL)')
  .option('--private-key <hex>', 'EVM signer 0x… (or BRIDGE_CLI_EVM_PRIVATE_KEY)')
  .option('--addresses-json <path>', 'Deploy JSON: poolLock, mUSDC, mUSDT, wUSDC, wUSDT (or BRIDGE_CLI_ADDRESSES_JSON)')
  .option('--json', 'Print machine-readable JSON only', false);

program
  .command('mint')
  .description(
    'Lock underlying USDC/USDT on EVM (approve + ZkStablesPoolLock.lock), then POST LOCK to the relayer with the Locked log anchor. ' +
      'Destination mint/burn semantics follow the SRS: mint only after on-chain lock evidence. ' +
      'Midnight/Cardano settlement can take minutes: stderr shows progress every ~15s, or use --follow false and poll zk-bridge job <id>.',
  )
  .requiredOption('--destination <chain>', 'evm | cardano | midnight (HTTP mint path is EVM-locked → recipient on this chain)')
  .requiredOption('--asset <sym>', 'USDC | USDT')
  .requiredOption('--amount <decimal>', 'Human amount (6 decimals)')
  .requiredOption('--recipient <addr>', 'Destination recipient (0x for evm, addr* for cardano, Midnight address for midnight)')
  .option('--follow', 'Poll relayer job until completed/failed', true)
  .option('--wait-timeout-ms <n>', 'Max wait when following job', '900000')
  .option('--poll-ms <n>', 'Job poll interval', '2000')
  .action(async (opts, cmd) => {
    const global = mergedOpts(cmd);
    const json = Boolean(global.json);
    const dest = String(opts.destination).toLowerCase();
    if (!['evm', 'cardano', 'midnight'].includes(dest)) {
      throw new Error('--destination must be evm, cardano, or midnight');
    }
    const asset = String(opts.asset).toUpperCase();
    if (asset !== 'USDC' && asset !== 'USDT') throw new Error('--asset must be USDC or USDT');

    const env = loadEnv({
      relayerUrl: global.relayerUrl as string | undefined,
      rpcUrl: global.rpcUrl as string | undefined,
      privateKey: global.privateKey as string | undefined,
      addressesJson: global.addressesJson as string | undefined,
    });

    const { parsed, lockHash } = await evmApproveAndLock({
      env,
      asset: asset as 'USDC' | 'USDT',
      amountHuman: String(opts.amount),
      destination: dest as 'evm' | 'cardano' | 'midnight',
      recipientIntent: String(opts.recipient),
    });

    const body: LockIntentBody = {
      operation: 'LOCK',
      sourceChain: 'evm',
      destinationChain: dest,
      asset: asset as 'USDC' | 'USDT',
      assetKind: assetKind(asset as 'USDC' | 'USDT'),
      amount: String(opts.amount),
      recipient: String(opts.recipient).trim(),
      note: 'LOCK via @zk-stables/bridge-cli (EVM pool lock + relayer anchor)',
      source: {
        evm: {
          txHash: parsed.txHash,
          logIndex: parsed.logIndex,
          blockNumber: parsed.blockNumber.toString(),
          poolLockAddress: env.poolLock,
          token: parsed.token,
          nonce: parsed.nonce,
        },
      },
    };

    const { jobId, job } = await postLockIntent(env.relayerUrl, body);
    const base = { lockTxHash: lockHash, relayerJobId: jobId, job };

    if (!wantFollow(opts, true)) {
      outJson(json, { ok: true, ...base });
      return;
    }
    const waited = await waitJobWithHeartbeats(env.relayerUrl, jobId, Number(opts.pollMs) || 2000, Number(opts.waitTimeoutMs) || 900_000);
    outJson(json, { ok: waited.phase === 'completed', ...base, finalJob: waited });
    if (waited.phase === 'failed') process.exitCode = 1;
  });

const redeem = program.command('redeem').description('Submit BURN / redeem intents aligned with burn anchors (SRS BURN_ANCHOR_SPEC).');

redeem
  .command('evm')
  .description('Burn zkUSDC/zkUSDT on EVM (ZkStablesWrappedToken.burn) then POST BURN with source.evm from Burned log (or attach an existing burn tx).')
  .requiredOption('--asset <sym>', 'USDC | USDT')
  .requiredOption('--payout <0x>', 'EVM address receiving unlocked underlying mUSDC/mUSDT')
  .option('--amount <decimal>', 'Human burn amount (6 decimals); required unless --from-tx is set')
  .option('--burn-commitment <0x>', '32-byte burn commitment; random if omitted')
  .option('--from-tx <0x>', 'Use an existing burn transaction instead of sending burn()')
  .option('--follow', 'Poll relayer job until completed/failed', true)
  .option('--wait-timeout-ms <n>', 'Max wait when following job', '900000')
  .option('--poll-ms <n>', 'Job poll interval', '2000')
  .action(async (opts, cmd) => {
    const global = mergedOpts(cmd);
    const json = Boolean(global.json);
    const asset = String(opts.asset).toUpperCase();
    if (asset !== 'USDC' && asset !== 'USDT') throw new Error('--asset must be USDC or USDT');
    const payout = String(opts.payout).trim();
    if (!isAddress(payout)) throw new Error('--payout must be a 0x address');

    const env = loadEnv({
      relayerUrl: global.relayerUrl as string | undefined,
      rpcUrl: global.rpcUrl as string | undefined,
      privateKey: global.privateKey as string | undefined,
      addressesJson: global.addressesJson as string | undefined,
    });
    const wrapped = wrappedZkForAsset(env, asset as 'USDC' | 'USDT');

    let parsed: ParsedBurned;
    let burnHash: Hex;
    let logIndex: number;
    let blockNumber: string;

    const pub = createPublicClient({ chain: foundry, transport: http(env.rpcUrl) });
    const fromTx = (opts.fromTx as string | undefined)?.trim();
    if (fromTx) {
      if (!/^0x[0-9a-fA-F]{64}$/u.test(fromTx)) throw new Error('--from-tx must be a 0x-prefixed tx hash');
      const receipt = await pub.getTransactionReceipt({ hash: fromTx as Hex });
      const withIx = parseBurnedFromReceiptWithIndex(receipt, wrapped);
      if (!withIx) throw new Error('No Burned event for this zk token in the given transaction.');
      parsed = withIx.parsed;
      burnHash = receipt.transactionHash;
      logIndex = withIx.logIndex;
      blockNumber = withIx.blockNumber.toString();
    } else {
      const amt = String(opts.amount ?? '').trim();
      if (!amt) throw new Error('Provide --amount or --from-tx');
      const bc = opts.burnCommitment ? (String(opts.burnCommitment).trim() as Hex) : undefined;
      if (bc && !/^0x[0-9a-fA-F]{64}$/u.test(bc)) throw new Error('--burn-commitment must be 32-byte hex');
      const r = await evmBurnZk({
        env,
        asset: asset as 'USDC' | 'USDT',
        amountHuman: amt,
        payoutAddress: payout as Address,
        burnCommitment: bc,
      });
      burnHash = r.burnHash;
      const receipt = await pub.getTransactionReceipt({ hash: burnHash });
      const withIx = parseBurnedFromReceiptWithIndex(receipt, wrapped);
      if (!withIx) {
        throw new Error('Burn transaction mined but Burned log not found — check token address and network.');
      }
      parsed = withIx.parsed;
      logIndex = withIx.logIndex;
      blockNumber = withIx.blockNumber.toString();
    }

    const body: BurnIntentBody = {
      operation: 'BURN',
      sourceChain: 'evm',
      destinationChain: 'evm',
      asset: asset as 'USDC' | 'USDT',
      assetKind: assetKind(asset as 'USDC' | 'USDT'),
      amount: parsed.amount,
      recipient: payout,
      burnCommitmentHex: normHex64(parsed.burnCommitmentHex),
      note: 'BURN via @zk-stables/bridge-cli (EVM zk burn + Burned anchor)',
      source: {
        evm: {
          txHash: burnHash,
          logIndex,
          blockNumber,
          wrappedTokenAddress: wrapped,
          nonce: parsed.nonce,
          fromAddress: parsed.from,
        },
      },
    };

    const { jobId, job } = await postBurnIntent(env.relayerUrl, body);
    const base = { burnTxHash: burnHash, relayerJobId: jobId, job };

    if (!wantFollow(opts, true)) {
      outJson(json, { ok: true, ...base });
      return;
    }
    const waited = await waitJobWithHeartbeats(env.relayerUrl, jobId, Number(opts.pollMs) || 2000, Number(opts.waitTimeoutMs) || 900_000);
    outJson(json, { ok: waited.phase === 'completed', ...base, finalJob: waited });
    if (waited.phase === 'failed') process.exitCode = 1;
  });

redeem
  .command('cardano')
  .description(
    'POST BURN after zk is released from lock_pool (BridgeRelease): burnCommitmentHex must match the lock inline datum recipient_commitment; ' +
      'lock-tx/outputIndex point at the lock UTxO; spend-tx is the BridgeRelease tx. Underlying USDC/USDT unlocks on EVM to --payout.',
  )
  .requiredOption('--asset <sym>', 'USDC | USDT')
  .requiredOption('--amount <decimal>', 'Human amount (matches relayer / lock datum; typically 6 decimals)')
  .requiredOption('--payout <0x>', 'EVM address for underlying USDC/USDT unlock')
  .requiredOption('--burn-commitment <hex>', '64 hex chars = lock datum recipient_commitment')
  .requiredOption('--lock-tx <hex>', 'Lock UTxO transaction id (64 hex, no 0x)')
  .requiredOption('--lock-output-index <n>', 'Lock UTxO output index', (v) => Number.parseInt(v, 10))
  .requiredOption('--spend-tx <hex>', 'BridgeRelease transaction id (64 hex)')
  .option('--lock-nonce <str>', 'Decimal lock nonce from inline datum when required by your deployment')
  .option('--follow', 'Poll relayer job until completed/failed', true)
  .option('--wait-timeout-ms <n>', 'Max wait when following job', '900000')
  .option('--poll-ms <n>', 'Job poll interval', '2000')
  .action(async (opts, cmd) => {
    const global = mergedOpts(cmd);
    const json = Boolean(global.json);
    const asset = String(opts.asset).toUpperCase();
    if (asset !== 'USDC' && asset !== 'USDT') throw new Error('--asset must be USDC or USDT');
    if (!isAddress(String(opts.payout).trim())) throw new Error('--payout must be 0x…');

    const relayerUrl = loadRelayerBaseUrl(global.relayerUrl as string | undefined);

    const body: BurnIntentBody = {
      operation: 'BURN',
      sourceChain: 'cardano',
      destinationChain: 'evm',
      asset: asset as 'USDC' | 'USDT',
      assetKind: assetKind(asset as 'USDC' | 'USDT'),
      amount: String(opts.amount),
      recipient: String(opts.payout).trim(),
      burnCommitmentHex: normHex64(String(opts.burnCommitment)),
      note: 'BURN via @zk-stables/bridge-cli (Cardano lock anchor + BridgeRelease spend)',
      source: {
        cardano: {
          txHash: normHex64(String(opts.lockTx)),
          outputIndex: Number(opts.lockOutputIndex),
          spendTxHash: normHex64(String(opts.spendTx)),
          ...(opts.lockNonce ? { lockNonce: String(opts.lockNonce).trim() } : {}),
        },
      },
    };

    const { jobId, job } = await postBurnIntent(relayerUrl, body);
    const base = { relayerJobId: jobId, job };
    if (!wantFollow(opts, true)) {
      outJson(json, { ok: true, ...base });
      return;
    }
    const waited = await waitJobWithHeartbeats(relayerUrl, jobId, Number(opts.pollMs) || 2000, Number(opts.waitTimeoutMs) || 900_000);
    outJson(json, { ok: waited.phase === 'completed', ...base, finalJob: waited });
    if (waited.phase === 'failed') process.exitCode = 1;
  });

redeem
  .command('midnight')
  .description(
    'POST BURN after on-chain initiateBurn on Midnight: requires recipientComm as burnCommitmentHex and ledger deposit key (depositCommitmentHex).',
  )
  .requiredOption('--asset <sym>', 'USDC | USDT')
  .requiredOption('--amount <decimal>', 'Human amount; must match the ledger deposit row for strict relayer checks')
  .requiredOption('--payout <0x>', 'EVM address for underlying unlock')
  .requiredOption('--burn-commitment <hex>', '64 hex = recipientComm passed to initiateBurn')
  .requiredOption('--deposit-commitment <hex>', '64 hex = registry ledger deposit key (not the same as burn commitment)')
  .requiredOption('--tx-id <id>', 'Midnight transaction id from initiateBurn (hex or bech32 form accepted as string)')
  .option('--dest-chain-id <n>', 'destChain argument to initiateBurn (decimal)', '2')
  .option('--contract <addr>', 'Optional Midnight contract address echo for relayer disambiguation')
  .option('--follow', 'Poll relayer job until completed/failed', true)
  .option('--wait-timeout-ms <n>', 'Max wait when following job', '900000')
  .option('--poll-ms <n>', 'Job poll interval', '2000')
  .action(async (opts, cmd) => {
    const global = mergedOpts(cmd);
    const json = Boolean(global.json);
    const asset = String(opts.asset).toUpperCase();
    if (asset !== 'USDC' && asset !== 'USDT') throw new Error('--asset must be USDC or USDT');
    if (!isAddress(String(opts.payout).trim())) throw new Error('--payout must be 0x…');

    const relayerUrl = loadRelayerBaseUrl(global.relayerUrl as string | undefined);

    const body: BurnIntentBody = {
      operation: 'BURN',
      sourceChain: 'midnight',
      destinationChain: 'evm',
      asset: asset as 'USDC' | 'USDT',
      assetKind: assetKind(asset as 'USDC' | 'USDT'),
      amount: String(opts.amount),
      recipient: String(opts.payout).trim(),
      burnCommitmentHex: normHex64(String(opts.burnCommitment)),
      note: 'BURN via @zk-stables/bridge-cli (Midnight initiateBurn anchor)',
      source: {
        midnight: {
          txId: String(opts.txId).trim(),
          destChainId: Number.parseInt(String(opts.destChainId), 10),
          depositCommitmentHex: normHex64(String(opts.depositCommitment)),
          ...(opts.contract ? { contractAddress: String(opts.contract).trim() } : {}),
        },
      },
    };

    const { jobId, job } = await postBurnIntent(relayerUrl, body);
    const base = { relayerJobId: jobId, job };
    if (!wantFollow(opts, true)) {
      outJson(json, { ok: true, ...base });
      return;
    }
    const waited = await waitJobWithHeartbeats(relayerUrl, jobId, Number(opts.pollMs) || 2000, Number(opts.waitTimeoutMs) || 900_000);
    outJson(json, { ok: waited.phase === 'completed', ...base, finalJob: waited });
    if (waited.phase === 'failed') process.exitCode = 1;
  });

program
  .command('job')
  .description('Fetch a relayer job by id, optionally follow until completed/failed.')
  .argument('<id>', 'Job UUID from POST /v1/intents/*')
  .option('--follow', 'Poll until terminal phase', false)
  .option('--poll-ms <n>', 'Poll interval', '2000')
  .option('--timeout-ms <n>', 'Max wait with --follow', '900000')
  .action(async (id, opts, cmd) => {
    const global = mergedOpts(cmd);
    const json = Boolean(global.json);
    const relayerUrl = loadRelayerBaseUrl(global.relayerUrl as string | undefined);
    if (!wantFollow(opts, false)) {
      const job = await getJob(relayerUrl, id);
      outJson(json, job);
      return;
    }
    const waited = await waitJobWithHeartbeats(relayerUrl, id, Number(opts.pollMs) || 2000, Number(opts.timeoutMs) || 900_000);
    outJson(json, waited);
    if (waited.phase === 'failed') process.exitCode = 1;
  });

program
  .command('balances')
  .description(
    'Print one JSON snapshot: EVM mUSDC/mUSDT (underlying), Cardano native zk units, Midnight unshielded zk (raw token types optional).',
  )
  .action(async (_opts, cmd) => {
    const global = mergedOpts(cmd);
    const json = Boolean(global.json);
    const env = loadEnv({
      relayerUrl: global.relayerUrl as string | undefined,
      rpcUrl: global.rpcUrl as string | undefined,
      privateKey: global.privateKey as string | undefined,
      addressesJson: global.addressesJson as string | undefined,
    });
    const snap = await buildBalanceSnapshot(env, dashboardConfigFromEnv(env));
    outJson(json, snap);
  });

program
  .command('dashboard')
  .description(
    'TTY dashboard: auto-refresh balances. Keys: [r] refresh, [m] run a zk-bridge command (mint/redeem/…), [q] quit.',
  )
  .option('--interval-ms <n>', 'Refresh interval in ms', '2500')
  .action(async (opts, cmd) => {
    const global = mergedOpts(cmd);
    const env = loadEnv({
      relayerUrl: global.relayerUrl as string | undefined,
      rpcUrl: global.rpcUrl as string | undefined,
      privateKey: global.privateKey as string | undefined,
      addressesJson: global.addressesJson as string | undefined,
    });
    await runDashboard({ env, intervalMs: Number(opts.intervalMs) || 2500 });
  });

program
  .command('info')
  .description('Show parsed environment and human-readable token mapping (no chain writes).')
  .action(async (_opts, cmd) => {
    const global = mergedOpts(cmd);
    const json = Boolean(global.json);
    const env = loadEnv({
      relayerUrl: global.relayerUrl as string | undefined,
      rpcUrl: global.rpcUrl as string | undefined,
      privateKey: global.privateKey as string | undefined,
      addressesJson: global.addressesJson as string | undefined,
    });
    const signer = privateKeyToAccount(env.privateKey).address;
    let relayerBridge: Record<string, unknown> | undefined;
    try {
      const res = await fetch(`${env.relayerUrl.replace(/\/$/, '')}/v1/bridge/recipients`, { cache: 'no-store' });
      if (res.ok) {
        relayerBridge = (await res.json()) as Record<string, unknown>;
      }
    } catch {
      /* optional */
    }
    const evmBridge = typeof relayerBridge?.evmRecipient === 'string' ? relayerBridge.evmRecipient.trim() : '';
    const mintHint =
      evmBridge && signer.toLowerCase() === evmBridge.toLowerCase()
        ? 'Pool-lock watcher may race HTTP mint: set RELAYER_BRIDGE_EVM_RECIPIENT to a different 0x than BRIDGE_CLI_EVM_PRIVATE_KEY.'
        : undefined;
    outJson(json, {
      relayerUrl: env.relayerUrl,
      rpcUrl: env.rpcUrl,
      signer,
      poolLock: env.poolLock,
      underlyingUsdc: env.usdcUnderlying,
      underlyingUsdt: env.usdtUnderlying,
      zkUsdc: env.zkUsdc,
      zkUsdt: env.zkUsdt,
      ...(relayerBridge ? { relayerBridgeRecipients: relayerBridge } : {}),
      ...(mintHint ? { mintCrossChainWarning: mintHint } : {}),
    });
  });

program.showHelpAfterError();
void program.parseAsync(process.argv).catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
