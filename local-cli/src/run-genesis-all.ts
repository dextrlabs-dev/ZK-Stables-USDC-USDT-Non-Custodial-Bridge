/**
 * Full zk-stables circuit run using the same **genesis seed hash** semantics as zk-stables-ui
 * (`deriveBytes32HexFromGenesis` + HD wallet from 32-byte seed hash).
 *
 * Env:
 * - `GENESIS_SEED_HASH_HEX` – 64 hex chars (default: 000…001 from the UI demo).
 * - `AUTO_FUND` – if `1` or `true`, runs `yarn fund` for **shielded and unshielded** addresses, waits for UTXOs,
 *   then registers **DUST** (same idea as `yarn fund-and-register-dust`, but for this genesis-derived wallet).
 * - `MIDNIGHT_LOCAL_NETWORK_DIR` – defaults to `/root/midnight-local-network` (override if your clone differs).
 *
 * Prerequisites: Docker stack (node 9944, indexer 8088, proof-server 6300), same as `run-all-operations.ts`.
 * Install Node deps from the **repo root** (`npm install`) so contract + `compact-runtime` share one `node_modules`
 * (avoids `ContractMaintenanceAuthority` / duplicate WASM issues). Use `npm run run-genesis -w @zk-stables/local-cli`.
 *
 * If the process seems stuck after deploy, it is usually inside **proveHolder** (silent ZK proving can take many
 * minutes) or **fee balancing** without DUST — use `AUTO_FUND=1` once so unshielded + DUST are set up.
 * If **proveHolder** (or other contract calls) fail at submit with `Invalid Transaction: Custom error: 138`, dust
 * fee margin is often too low: use the same `additionalFeeOverhead` as midnight-local-network (`wallet.ts`, 300e15).
 *
 * Debugging (stderr): `MIDNIGHT_LOCAL_CLI_DEBUG=1` logs prove/balance/submit/indexer-watch phases in `providers.ts`.
 * `MIDNIGHT_BALANCE_TX_MS` (default 900000) caps fee-balancing; `MIDNIGHT_WATCH_TX_PER_ID_MS` (default 180000) caps
 * each indexer segment id wait.
 * A **fresh** LevelDB private-state dir is used each run unless you set `MIDNIGHT_PRIVATE_STATE_STORE` (avoids
 * stale keys that can yield "Failed to prove: bad input" on deploy).
 * - `GENESIS_INDEXER_WAIT_MS` (default 120000) — after deploy, poll until indexer contract state matches local
 *   verifier keys before the first circuit call.
 * - `GENESIS_FUND_ONLY` — if `1` or `true`, run wallet sync + `AUTO_FUND` path (yarn fund + dust registration) then
 *   exit (no contract deploy). Use for relayer `RELAYER_MIDNIGHT_AUTO_DEPLOY` when the genesis wallet lacks dust.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import { firstValueFrom, filter, take } from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { ContractExecutable } from '@midnight-ntwrk/compact-js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import { deployContract, getPublicStates, verifyContractState } from '@midnight-ntwrk/midnight-js-contracts';
import { zkStablesPrivateStateId, AssetKind } from '@zk-stables/midnight-contract';
import { zkStablesCompiledContract } from './zk-stables-compiled-contract.js';
import { LocalUndeployedConfig } from './config.js';
import { configureZkStablesProviders } from './providers.js';
import { initWalletWithSeed, type WalletContext } from './wallet.js';
import { holderLedgerPublicKey } from './holder-key.js';

(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;

function logStep(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * After deploy, the indexer can briefly serve contract state that does not yet include all verifier keys
 * (or lags the chain). Proving against that view yields a tx the node rejects (often pool "Custom" errors).
 */
async function waitForIndexerContractReady(
  providers: Awaited<ReturnType<typeof configureZkStablesProviders>>,
  contractAddress: string,
  timeoutMs: number,
): Promise<void> {
  const circuitIds = ContractExecutable.make(zkStablesCompiledContract).getProvableCircuitIds();
  const verifierKeys = await providers.zkConfigProvider.getVerifierKeys(circuitIds);
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const { contractState } = await getPublicStates(providers.publicDataProvider, contractAddress);
      verifyContractState(verifierKeys, contractState);
      return;
    } catch (e) {
      lastErr = e;
      await sleep(1500);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Poll until unshielded UTXOs appear (genesis fund lands on-chain / indexer). */
async function waitForUnshieldedUtxos(ctx: WalletContext, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await firstValueFrom(ctx.wallet.state().pipe(take(1)));
    if (s.isSynced && s.unshielded.availableCoins.length > 0) {
      return;
    }
    await sleep(1500);
  }
  throw new Error(
    `No unshielded UTXOs after ${timeoutMs}ms. Fund the printed unshielded address (yarn fund <addr> in midnight-local-network) or retry with AUTO_FUND=1.`,
  );
}

/** Register unshielded UTXOs for DUST generation (required for many contract fee paths on local undeployed). */
async function registerDustGenerationIfNeeded(ctx: WalletContext): Promise<void> {
  await ctx.wallet.dust.waitForSyncedState();
  let st = await firstValueFrom(ctx.wallet.state().pipe(filter((s) => s.isSynced), take(1)));

  function collectUnregisteredUtxos(walletState: typeof st) {
    return walletState.unshielded.availableCoins
      .filter((coin) => !coin.meta.registeredForDustGeneration)
      .map((c) => ({
        ...c.utxo,
        ctime: new Date(c.meta.ctime),
        registeredForDustGeneration: c.meta.registeredForDustGeneration,
      }));
  }

  let utxos = collectUnregisteredUtxos(st);
  const dustNow = st.dust.balance(new Date());
  if (utxos.length === 0 && dustNow > 0n) {
    logStep(
      `DUST: skip registration (dust=${dustNow} > 0 and every unshielded UTXO is already registered for DUST).`,
    );
    return;
  }

  const pollMs = 3000;
  const maxWaitMs = Number.parseInt(process.env.GENESIS_DUST_REGISTER_WAIT_MS ?? '120000', 10);
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    st = await firstValueFrom(ctx.wallet.state().pipe(filter((s) => s.isSynced), take(1)));
    utxos = collectUnregisteredUtxos(st);
    if (utxos.length > 0) {
      break;
    }
    logStep(
      `DUST: waiting for unregistered unshielded UTXOs (funding may still be indexing)… dust=${st.dust.balance(new Date())} unshieldedCoins=${st.unshielded.availableCoins.length}`,
    );
    await sleep(pollMs);
  }

  if (utxos.length === 0) {
    logStep(
      `DUST: no unregistered unshielded UTXOs after ${maxWaitMs}ms — dust=${st.dust.balance(new Date())}. ` +
        `Later circuits may fail with "Dust balancing did not converge"; widen GENESIS_DUST_REGISTER_WAIT_MS or run fund-and-register-dust for this wallet.`,
    );
    return;
  }

  logStep(`DUST: submitting dust-generation registration (${utxos.length} UTXO(s))…`);
  const ttl = new Date(Date.now() + 10 * 60 * 1000);
  const registerTx = await ctx.wallet.dust.createDustGenerationTransaction(
    new Date(),
    ttl,
    utxos,
    ctx.unshieldedKeystore.getPublicKey(),
    st.dust.address,
  );
  const intent = registerTx.intents?.get(1);
  if (!intent) {
    throw new Error('Dust generation intent not found on transaction');
  }
  const signature = ctx.unshieldedKeystore.signData(intent.signatureData(1));
  const recipe = await ctx.wallet.dust.addDustGenerationSignature(registerTx, signature);
  const transaction = await ctx.wallet.finalizeTransaction(recipe);
  await ctx.wallet.submitTransaction(transaction);

  await firstValueFrom(
    ctx.wallet.state().pipe(
      filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n),
      take(1),
    ),
  );
  logStep('DUST: registration complete (dust balance > 0).');
}

function deriveBytes32HexFromGenesis(genesisSeedHashHex: string, label: string): string {
  const seed = genesisSeedHashHex.trim().replace(/^0x/, '').toLowerCase();
  if (!/^([0-9a-f]{64})$/.test(seed)) {
    throw new Error('GENESIS_SEED_HASH_HEX must be 64 hex characters');
  }
  const payload = `${label}:${seed}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 64) throw new Error('expected 32-byte hex string');
  return Uint8Array.from(Buffer.from(h, 'hex'));
}

function logTx(label: string, pub: { txId: unknown; txHash: unknown; blockHeight?: unknown }): void {
  const bh = pub.blockHeight !== undefined ? ` blockHeight=${pub.blockHeight}` : '';
  console.log(`${label}: txId=${String(pub.txId)} txHash=${String(pub.txHash)}${bh}`);
}

async function main(): Promise<void> {
  if (process.env.MIDNIGHT_LOCAL_CLI_DEBUG === undefined) {
    process.env.MIDNIGHT_LOCAL_CLI_DEBUG = '1';
  }
  if (!process.env.MIDNIGHT_PRIVATE_STATE_STORE) {
    process.env.MIDNIGHT_PRIVATE_STATE_STORE = `zk-stables-genesis-${Date.now()}`;
    logStep(`MIDNIGHT_PRIVATE_STATE_STORE=${process.env.MIDNIGHT_PRIVATE_STATE_STORE} (fresh signing keys per run)`);
  }

  const genesisHex =
    process.env.GENESIS_SEED_HASH_HEX ?? '0000000000000000000000000000000000000000000000000000000000000001';

  const depositHex = deriveBytes32HexFromGenesis(genesisHex, 'zkstables:depositCommitment:v1');
  const opHex = deriveBytes32HexFromGenesis(genesisHex, 'zkstables:operatorSk:v1');
  const holderHex = deriveBytes32HexFromGenesis(genesisHex, 'zkstables:holderSk:v1');

  console.log('Genesis seed hash:', genesisHex);
  console.log('Derived depositCommitment:', depositHex);
  console.log('Derived operatorSk:', opHex.slice(0, 16) + '…');

  const seedBytes = Buffer.from(genesisHex, 'hex');
  const walletCtx = await initWalletWithSeed(seedBytes);

  logStep('Waiting for wallet sync…');
  const synced = await firstValueFrom(walletCtx.wallet.state().pipe(filter((s) => s.isSynced), take(1)));
  const shieldedAddr = synced.shielded?.address;
  if (!shieldedAddr) {
    throw new Error('Wallet sync did not expose shielded address');
  }
  const shieldedBech32 = MidnightBech32m.encode('undeployed', shieldedAddr).toString();
  const unshieldedBech32 = walletCtx.unshieldedKeystore.getBech32Address().toString();
  logStep(`Synced. Shielded: ${shieldedBech32}`);
  logStep(`Unshielded (fund this for DUST path): ${unshieldedBech32}`);

  const autoFund = process.env.AUTO_FUND === '1' || process.env.AUTO_FUND === 'true';
  const fundOnly = process.env.GENESIS_FUND_ONLY === '1' || process.env.GENESIS_FUND_ONLY === 'true';
  const mlnDir = process.env.MIDNIGHT_LOCAL_NETWORK_DIR ?? '/root/midnight-local-network';
  if (autoFund || fundOnly) {
    if (!existsSync(`${mlnDir}/package.json`)) {
      throw new Error(`AUTO_FUND / GENESIS_FUND_ONLY set but MIDNIGHT_LOCAL_NETWORK_DIR not found: ${mlnDir}`);
    }
    logStep('AUTO_FUND: yarn fund (shielded)…');
    execFileSync('yarn', ['fund', shieldedBech32], { cwd: mlnDir, stdio: 'inherit' });
    logStep('AUTO_FUND: yarn fund (unshielded)…');
    execFileSync('yarn', ['fund', unshieldedBech32], { cwd: mlnDir, stdio: 'inherit' });
    logStep('AUTO_FUND: waiting for unshielded UTXOs to appear in wallet…');
    await waitForUnshieldedUtxos(walletCtx, 240_000);
    await registerDustGenerationIfNeeded(walletCtx);
    if (fundOnly) {
      logStep('GENESIS_FUND_ONLY=1 — wallet funded + dust registered; exiting before deploy.');
      return;
    }
  } else {
    const dustBal = synced.dust.balance(new Date());
    if (dustBal <= 0n) {
      logStep(
        `WARNING: dust balance is ${dustBal}. Without unshielded funds + DUST registration, prove/mint often hang. Use AUTO_FUND=1 once or fund unshielded + register dust (see midnight-local-network README).`,
      );
    }
  }

  const opSk = hexToBytes32(opHex);
  const holderSk = hexToBytes32(holderHex);
  const ownerPk = holderLedgerPublicKey(holderSk);
  const depositCommitment = hexToBytes32(depositHex);

  const config = new LocalUndeployedConfig();
  const providers = await configureZkStablesProviders(walletCtx, config);

  logStep('Deploying zk-stables (proving may take several minutes)…');
  const deployed = await deployContract(providers, {
    compiledContract: zkStablesCompiledContract,
    privateStateId: zkStablesPrivateStateId,
    initialPrivateState: {
      operatorSecretKey: new Uint8Array(opSk),
      holderSecretKey: new Uint8Array(holderSk),
    },
    args: [depositCommitment, AssetKind.USDC, 1n, 1_000_000n, new Uint8Array(ownerPk)],
  });

  logTx('deploy', deployed.deployTxData.public);
  console.log('Contract address:', deployed.deployTxData.public.contractAddress);

  // Let wallet + indexer catch up so the next call’s proof uses the same contract/Zswap view as the node.
  logStep('Post-deploy: waiting for synced wallet state…');
  await walletCtx.wallet.waitForSyncedState();

  const deployAddr = deployed.deployTxData.public.contractAddress;
  const indexerWaitMs = Number.parseInt(process.env.GENESIS_INDEXER_WAIT_MS ?? '120000', 10);
  logStep(
    `Post-deploy: waiting up to ${indexerWaitMs}ms for indexer contract state to match local verifier keys…`,
  );
  await waitForIndexerContractReady(providers, deployAddr, indexerWaitMs);

  const { callTx } = deployed;
  const recipientUserAddr = {
    bytes: ledger.encodeUserAddress(walletCtx.unshieldedKeystore.getAddress()),
  };

  logStep('proveHolder: proving + balancing + submit (no further logs until proof/indexer complete; often several minutes)…');
  logTx('proveHolder', (await callTx.proveHolder()).public);

  logStep('mintWrappedUnshielded: proving + submit…');
  logTx('mintWrappedUnshielded', (await callTx.mintWrappedUnshielded()).public);

  logStep('initiateBurn…');
  logTx('initiateBurn', (await callTx.initiateBurn(2n, hexToBytes32('aa'.repeat(32)))).public);

  logStep('sendWrappedUnshieldedToUser…');
  logTx('sendWrappedUnshieldedToUser', (await callTx.sendWrappedUnshieldedToUser(recipientUserAddr)).public);

  logStep('finalizeBurn…');
  logTx('finalizeBurn', (await callTx.finalizeBurn()).public);

  logStep('Done. All circuits submitted (genesis seed hash flow).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
