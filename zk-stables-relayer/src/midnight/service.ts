/**
 * Relayer-side Midnight wallet + zk-stables-registry contract.
 *
 * Uses the multi-deposit registry contract: a single deployed instance supports
 * unlimited concurrent deposits, each tracked by maps keyed on `depositCommitment`.
 *
 * Wallet seed (first match):
 * - **`GENESIS_SEED_HASH_HEX`** — 64 hex chars used as the 32-byte HD seed.
 * - **`BIP39_MNEMONIC`** — BIP-39 phrase; seed = `bip39.mnemonicToSeed`.
 */
import { createHash } from 'node:crypto';
import { inspect } from 'node:util';
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import { ContractState as MidnightOnchainContractState } from '@midnight-ntwrk/compact-runtime';
import { deployContract, findDeployedContract, getPublicStates } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import type { ContractState as LedgerWasmContractState } from '@midnight-ntwrk/ledger-v8';
import { ZkStablesRegistry, zkStablesRegistryPrivateStateId } from '@zk-stables/midnight-contract';
import type { Logger } from 'pino';
import { midnightIndexerPing } from '../adapters/chainHealth.js';
import { zkStablesRegistryCompiledContract } from './zk-stables-compiled-contract.js';
import { RelayerMidnightConfig } from './config.js';
import { configureZkStablesRegistryProviders } from './providers.js';
import { initWalletWithSeed, type WalletContext } from './wallet.js';
import { holderLedgerPublicKey } from './holder-key.js';
import { withMidnightPipelineMutex } from './midnightPipelineMutex.js';
import { isMidnightRelayerInitEnabled } from '../adapters/midnightOperatorConsoleTx.js';

/** One queue for all registry txs — avoids LevelDB `open()` contention with a second process (e.g. ops `tsx` script). */
async function withMidnightPipelineMutexLogged<T>(
  logger: Logger,
  role: 'mint' | 'burn' | 'initiateBurn_http',
  depositPreview: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  logger.info({ role, deposit: depositPreview }, 'Midnight pipeline mutex: queued');
  return withMidnightPipelineMutex(async () => {
    const waitedMs = Date.now() - t0;
    logger.info(
      { role, deposit: depositPreview, waitedMs },
      waitedMs > 250
        ? 'Midnight pipeline mutex: acquired after wait (another job held wallet/LevelDB — ZK proves are serialized)'
        : 'Midnight pipeline mutex: acquired',
    );
    return fn();
  });
}

(globalThis as unknown as { WebSocket?: typeof WebSocket }).WebSocket = WebSocket;

export type MidnightRelayerHandle = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callTx: any;
  contractAddress: string;
  walletAddress: Uint8Array;
};

let initPromise: Promise<MidnightRelayerHandle | null> | null = null;

export function isMidnightBridgeEnabled(): boolean {
  return process.env.RELAYER_MIDNIGHT_ENABLED === 'true' || process.env.RELAYER_MIDNIGHT_ENABLED === '1';
}

function midnightIndexerBaseUrl(): string {
  return (process.env.RELAYER_MIDNIGHT_INDEXER_URL ?? 'http://127.0.0.1:8088/api/v4/graphql').trim();
}

function isTransientMidnightNetErr(e: unknown): boolean {
  const msg = String(e);
  /** Keep narrow: application / contract errors must not spin retries. */
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|socket hang up|ECONNRESET|Failed to fetch|network/i.test(msg);
}

/** Flatten Error.cause for logs (SDK often throws `Wallet.Sync: [object Object]`). */
function formatMidnightBootstrapErr(e: unknown): string {
  if (e instanceof Error) {
    const parts: string[] = [e.message];
    let c: unknown = e.cause;
    for (let i = 0; i < 6 && c !== undefined && c !== null; i++) {
      if (c instanceof Error) {
        parts.push(c.message);
        c = c.cause;
      } else {
        parts.push(typeof c === 'string' ? c : inspect(c, { depth: 6, breakLength: 120 }));
        break;
      }
    }
    return parts.join(' | ');
  }
  return inspect(e, { depth: 8, breakLength: 120 });
}

/**
 * Indexer/node restarts often yield transient dust-wallet stream decode failures (`Wallet.Sync`)
 * or LevelDB lock errors if a previous half-started facade was not stopped.
 */
function isRetryableMidnightWalletBootstrapErr(e: unknown): boolean {
  const s = formatMidnightBootstrapErr(e);
  if (/invalid.*mnemonic|Failed to initialize HDWallet|Failed to derive keys/i.test(s)) return false;
  /** Sync deadline failures use a separate small retry budget (`RELAYER_MIDNIGHT_WALLET_SYNC_TIMEOUT_RETRIES`). */
  if (/did not reach isSynced within/i.test(s)) return false;
  return /Wallet\.Sync|SyncWalletError|ParseResult|decode|Deserialize|deseriali[sz]e|SCHEMA|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|socket hang up|ECONNRESET|Resource temporarily unavailable|LEVEL_|Database failed to open|Unable to fetch block data|Failed to to obtain correct indexer|OtherWalletError|websocket|WebSocket/i.test(
    s,
  );
}

function isMidnightWalletSyncTimeoutErr(e: unknown): boolean {
  return /did not reach isSynced within/i.test(formatMidnightBootstrapErr(e));
}

function midnightWalletInitRetryDelaysMs(): number[] {
  const raw = process.env.RELAYER_MIDNIGHT_WALLET_INIT_RETRY_DELAYS_MS?.trim();
  if (raw) {
    const xs = raw
      .split(/[, ]+/u)
      .map((x) => Number.parseInt(x, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (xs.length) return xs;
  }
  return [2000, 5000, 12000, 25000, 40000, 60000];
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** `findDeployedContract` can run a long time; without a cap, LOCK→Midnight jobs sit in `destination_handoff` forever. */
function findDeployedContractTimeoutMs(): number {
  const n = Number(process.env.RELAYER_MIDNIGHT_FIND_DEPLOYED_TIMEOUT_MS ?? '900000');
  return Math.max(60_000, Number.isFinite(n) ? n : 900_000);
}

async function findDeployedContractWithTimeout(
  logger: Logger,
  contractHex: string,
  providers: unknown,
  ps: ReturnType<typeof buildJoinPrivateState>,
) {
  const timeoutMs = findDeployedContractTimeoutMs();
  const t0 = Date.now();
  const heartbeatSec = Math.max(
    15,
    Math.min(120, Number.parseInt(process.env.RELAYER_MIDNIGHT_FIND_DEPLOYED_HEARTBEAT_SEC ?? '45', 10) || 45),
  );
  const hb = setInterval(() => {
    logger.info(
      {
        contract: contractHex,
        elapsedSec: Math.round((Date.now() - t0) / 1000),
        timeoutSec: Math.round(timeoutMs / 1000),
      },
      'Midnight: findDeployedContract still running (indexer/proof-server sync — increase RELAYER_MIDNIGHT_FIND_DEPLOYED_TIMEOUT_MS if legitimate first join)',
    );
  }, heartbeatSec * 1000);
  try {
    return await Promise.race([
      findDeployedContract(providers as never, {
        contractAddress: contractHex,
        compiledContract: zkStablesRegistryCompiledContract,
        privateStateId: zkStablesRegistryPrivateStateId,
        initialPrivateState: ps,
      }),
      sleepMs(timeoutMs).then(() => {
        throw new Error(
          `findDeployedContract timed out after ${timeoutMs}ms for RELAYER_MIDNIGHT_CONTRACT_ADDRESS=${contractHex}. ` +
            'Verify the contract exists on the Midnight network the indexer tracks, restart indexer + proof-server, increase RELAYER_MIDNIGHT_FIND_DEPLOYED_TIMEOUT_MS, then restart the relayer.',
        );
      }),
    ]);
  } finally {
    clearInterval(hb);
  }
}

async function openMidnightWalletWithRetries(logger: Logger, seed: Buffer): Promise<WalletContext> {
  const maxAttempts = Math.max(
    1,
    Math.min(12, Number.parseInt(process.env.RELAYER_MIDNIGHT_WALLET_INIT_MAX_ATTEMPTS ?? '6', 10) || 6),
  );
  const maxSyncHangRetries = Math.max(
    0,
    Math.min(4, Number.parseInt(process.env.RELAYER_MIDNIGHT_WALLET_SYNC_TIMEOUT_RETRIES ?? '2', 10) || 2),
  );
  const delays = midnightWalletInitRetryDelaysMs();
  let syncHangRetries = 0;
  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.info({ attempt, maxAttempts }, 'Midnight: initWalletWithSeed (+ sync) attempt');
      const walletCtx = await initWalletWithSeed(seed);
      logger.info({}, 'Midnight: initWalletWithSeed done; subscribing to wallet sync');
      logger.info(
        {},
        'Midnight: waiting for wallet sync (state.isSynced) — if this hangs, check indexer/node URLs and that the indexer is caught up',
      );
      await awaitWalletSynced(logger, walletCtx);
      return walletCtx;
    } catch (e) {
      last = e;
      const detail = formatMidnightBootstrapErr(e);
      logger.warn({ err: detail, attempt, maxAttempts }, 'Midnight: wallet bootstrap attempt failed');
      const syncHang = isMidnightWalletSyncTimeoutErr(e);
      if (syncHang) syncHangRetries += 1;
      const canRetry =
        attempt < maxAttempts &&
        (syncHang ? syncHangRetries <= maxSyncHangRetries : isRetryableMidnightWalletBootstrapErr(e));
      if (!canRetry) {
        throw new Error(`Midnight wallet bootstrap failed after ${attempt} attempt(s): ${detail}`, { cause: e as Error });
      }
      const wait = delays[Math.min(attempt - 1, delays.length - 1)] ?? 10_000;
      logger.info(
        { waitMs: wait, syncHangRetries, hint: 'after indexer/node restarts, wait for graphql:200 then restart relayer' },
        'Midnight: backing off before wallet init retry',
      );
      await sleepMs(wait);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function walletSyncTimeoutMs(): number {
  const n = Number(process.env.RELAYER_MIDNIGHT_WALLET_SYNC_TIMEOUT_MS ?? '1800000');
  return Math.max(60_000, Number.isFinite(n) ? n : 1_800_000);
}

/** Wallet SDK must reach `isSynced` before registry txs; never hang forever on a bad indexer. */
async function awaitWalletSynced(logger: Logger, walletCtx: WalletContext): Promise<void> {
  const syncMs = walletSyncTimeoutMs();
  logger.info({ syncTimeoutMs: syncMs }, 'Midnight: wallet sync deadline (RELAYER_MIDNIGHT_WALLET_SYNC_TIMEOUT_MS)');
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const t = setTimeout(() => {
      done(() => {
        try {
          sub.unsubscribe();
        } catch {
          /* ignore */
        }
        reject(
          new Error(
            `Midnight wallet did not reach isSynced within ${syncMs}ms — check indexer (${midnightIndexerBaseUrl()}) and node; restart indexer then relayer`,
          ),
        );
      });
    }, syncMs);
    const sub = walletCtx.wallet.state().subscribe((s) => {
      if (s.isSynced) {
        clearTimeout(t);
        done(() => {
          sub.unsubscribe();
          resolve();
        });
      }
    });
  });
}

async function assertMidnightIndexerReachable(logger: Logger): Promise<void> {
  const url = midnightIndexerBaseUrl();
  const ping = await midnightIndexerPing(url);
  if (!ping.ok) {
    throw new Error(
      `Midnight indexer not reachable at ${url} (${ping.error ?? `HTTP ${String(ping.status ?? '?')}`}). ` +
        `Start the indexer or set RELAYER_MIDNIGHT_INDEXER_URL before LOCK/BURN→Midnight.`,
    );
  }
  logger.info({ url, status: ping.status }, 'Midnight: indexer ping ok');
}

/** Result of indexer-only inspection before `initiateBurn` (no wallet / LevelDB). */
export type MidnightRegistryDepositBurnPreflight = {
  contractAddress: string | null;
  depositCommitmentHex: string;
  known: boolean;
  /** Registry `depositStatus` map lookup when `known`; decimal string of bigint. */
  depositStatus: string | null;
  /** `depositMintedUnshielded` when present (decimal string). */
  depositMintedUnshielded: string | null;
  okForInitiateBurn: boolean;
  reason: string;
};

/**
 * Read zk-stables-registry public ledger (indexer) for this deposit before paying the proof server for `initiateBurn`.
 * Uses `RELAYER_MIDNIGHT_CONTRACT_ADDRESS` + indexer HTTP/WS (same env as relayer).
 */
export async function readMidnightRegistryDepositBurnPreflight(
  logger: Logger,
  depositCommitment: Uint8Array,
): Promise<MidnightRegistryDepositBurnPreflight> {
  const depositCommitmentHex = Buffer.from(depositCommitment).toString('hex').toLowerCase();
  const contractAddress = process.env.RELAYER_MIDNIGHT_CONTRACT_ADDRESS?.trim().toLowerCase() ?? null;
  const row = (partial: Omit<MidnightRegistryDepositBurnPreflight, 'depositCommitmentHex'>): MidnightRegistryDepositBurnPreflight => ({
    depositCommitmentHex,
    ...partial,
  });

  if (!contractAddress) {
    return row({
      contractAddress: null,
      known: false,
      depositStatus: null,
      depositMintedUnshielded: null,
      okForInitiateBurn: false,
      reason:
        'RELAYER_MIDNIGHT_CONTRACT_ADDRESS is unset — indexer preflight cannot read the registry (set the same address as relayer GET /v1/midnight/contract).',
    });
  }

  try {
    await assertMidnightIndexerReachable(logger);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return row({
      contractAddress,
      known: false,
      depositStatus: null,
      depositMintedUnshielded: null,
      okForInitiateBurn: false,
      reason: msg,
    });
  }

  const cfg = new RelayerMidnightConfig();
  const indexerHttp = (process.env.RELAYER_MIDNIGHT_INDEXER_URL ?? cfg.indexer).trim();
  const indexerWs = cfg.indexerWS.trim();
  const pdp = indexerPublicDataProvider(indexerHttp, indexerWs);

  let contractState: unknown;
  try {
    ({ contractState } = await getPublicStates(pdp, contractAddress));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return row({
      contractAddress,
      known: false,
      depositStatus: null,
      depositMintedUnshielded: null,
      okForInitiateBurn: false,
      reason: `Indexer getPublicStates failed for contract ${contractAddress}: ${msg}`,
    });
  }

  const wasmState = contractState as LedgerWasmContractState;
  let onchainFull: MidnightOnchainContractState;
  try {
    onchainFull = MidnightOnchainContractState.deserialize(new Uint8Array(wasmState.serialize()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return row({
      contractAddress,
      known: false,
      depositStatus: null,
      depositMintedUnshielded: null,
      okForInitiateBurn: false,
      reason: `Could not deserialize registry contract state from indexer (wrong contract type or bytes): ${msg}`,
    });
  }

  let L: ReturnType<typeof ZkStablesRegistry.ledger>;
  try {
    // Same as local-cli `ZkStables.ledger(pub.initialContractState.data)` — compact `ledger()` reads the charged cell.
    L = ZkStablesRegistry.ledger(onchainFull.data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return row({
      contractAddress,
      known: false,
      depositStatus: null,
      depositMintedUnshielded: null,
      okForInitiateBurn: false,
      reason: `Could not open registry ledger view (contract/artifact mismatch): ${msg}`,
    });
  }

  if (!L.depositStatus.member(depositCommitment)) {
    return row({
      contractAddress,
      known: false,
      depositStatus: null,
      depositMintedUnshielded: null,
      okForInitiateBurn: false,
      reason:
        'Unknown deposit: this commitment is not on the registry ledger view (wrong RELAYER_MIDNIGHT_CONTRACT_ADDRESS, wrong deposit hex, or chain was reset — run a fresh mint and use the new `Deposit …` line from destinationHint).',
    });
  }

  const status = L.depositStatus.lookup(depositCommitment);
  const minted = L.depositMintedUnshielded.member(depositCommitment)
    ? L.depositMintedUnshielded.lookup(depositCommitment)
    : null;

  const ACTIVE = 1n;
  if (status !== ACTIVE) {
    const hint =
      status === 2n
        ? 'Deposit is exit-pending (`initiateBurn` already ran). Continue the burn pipeline / zk-bridge redeem or finalize on-chain; do not call initiateBurn again for the same commitment.'
        : 'Deposit exists but `depositStatus` is not active (1) — mint pipeline may be incomplete, or this deposit was already progressed/burned. Run a new mint or pick a mint report whose `Deposit` line matches current chain state.';
    return row({
      contractAddress,
      known: true,
      depositStatus: status.toString(10),
      depositMintedUnshielded: minted !== null ? minted.toString(10) : null,
      okForInitiateBurn: false,
      reason: `Not active: depositStatus=${status.toString(10)} (expected 1 for initiateBurn). ${hint}`,
    });
  }

  logger.info(
    { contractAddress, deposit: `${depositCommitmentHex.slice(0, 16)}…`, depositStatus: '1', minted: minted?.toString(10) },
    'Midnight: registry deposit preflight OK for initiateBurn',
  );

  return row({
    contractAddress,
    known: true,
    depositStatus: status.toString(10),
    depositMintedUnshielded: minted !== null ? minted.toString(10) : null,
    okForInitiateBurn: true,
    reason: 'depositStatus=1 (active); safe to call initiateBurn (proof server may still take minutes).',
  });
}

async function midnightPipelineStepGap(logger: Logger): Promise<void> {
  const ms = Math.max(0, Math.min(120_000, Number(process.env.RELAYER_MIDNIGHT_PIPELINE_STEP_GAP_MS ?? '2500')));
  if (ms <= 0) return;
  logger.info({ ms }, 'Midnight: brief pause between on-chain pipeline steps (indexer catch-up)');
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * `proveHolder`, mint/burn steps, etc. can sit inside the proof server for many minutes with no other SDK logs.
 * Periodic `still running` lines avoid mistaken "stuck relayer" diagnoses during ops / long mints.
 */
async function withMidnightProofHeartbeat(
  logger: Logger,
  step: string,
  depHex: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  work: () => Promise<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const intervalMs = Math.max(
    10_000,
    Math.min(300_000, Number.parseInt(process.env.RELAYER_MIDNIGHT_PROOF_HEARTBEAT_MS ?? '30000', 10) || 30_000),
  );
  const ps = process.env.RELAYER_MIDNIGHT_PROOF_SERVER?.trim() || '(RELAYER_MIDNIGHT_PROOF_SERVER unset — wallet default)';
  logger.info(
    { step, dep: depHex.slice(0, 24), intervalMs, proofServer: ps },
    `Midnight: ${step} — waiting on proof/indexer (this step often takes 1–15+ min; heartbeats every ${intervalMs}ms)`,
  );
  let ticks = 0;
  const id = setInterval(() => {
    ticks += 1;
    logger.info(
      { step, dep: depHex.slice(0, 24), waitedSec: Math.round((ticks * intervalMs) / 1000) },
      `Midnight: ${step} still running…`,
    );
  }, intervalMs);
  try {
    return await work();
  } finally {
    clearInterval(id);
  }
}

async function withMidnightNetRetries<T>(logger: Logger, op: string, fn: () => Promise<T>): Promise<T> {
  const max = Math.max(1, Math.min(20, Number(process.env.RELAYER_MIDNIGHT_NET_RETRIES ?? '8')));
  const delayMs = Math.max(500, Number(process.env.RELAYER_MIDNIGHT_NET_RETRY_MS ?? '8000'));
  let last: unknown;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < max - 1 && isTransientMidnightNetErr(e)) {
        logger.warn({ err: String(e), attempt: i + 1, max, op }, 'Midnight: transient network/indexer error, retrying');
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw e;
    }
  }
  throw last;
}

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 64) throw new Error('expected 32-byte hex string');
  return Uint8Array.from(Buffer.from(h, 'hex'));
}

function deriveBytes32HexFromGenesis(genesisSeedHashHex: string, label: string): string {
  const seed = genesisSeedHashHex.trim().replace(/^0x/, '').toLowerCase();
  if (!/^([0-9a-f]{64})$/.test(seed)) {
    throw new Error('GENESIS_SEED_HASH_HEX must be 64 hex characters');
  }
  return createHash('sha256').update(`${label}:${seed}`, 'utf8').digest('hex');
}

function parseGenesisSeedHashHex(): string | undefined {
  const raw = process.env.GENESIS_SEED_HASH_HEX?.trim().replace(/^0x/i, '') ?? '';
  if (!raw) return undefined;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('GENESIS_SEED_HASH_HEX must be exactly 64 hex characters');
  }
  return raw.toLowerCase();
}

type DerivedDeployKeys = {
  operatorSk: Uint8Array;
  holderSk: Uint8Array;
};

function derivedKeysForMidnight(genesisHex: string | undefined): DerivedDeployKeys {
  if (genesisHex) {
    return {
      operatorSk: hexToBytes32(
        process.env.OPERATOR_SK_HEX ?? deriveBytes32HexFromGenesis(genesisHex, 'zkstables:operatorSk:v1'),
      ),
      holderSk: hexToBytes32(process.env.HOLDER_SK_HEX ?? deriveBytes32HexFromGenesis(genesisHex, 'zkstables:holderSk:v1')),
    };
  }
  return {
    operatorSk: hexToBytes32(process.env.OPERATOR_SK_HEX ?? '01'.repeat(32)),
    holderSk: hexToBytes32(process.env.HOLDER_SK_HEX ?? '02'.repeat(32)),
  };
}

function buildJoinPrivateState(genesisHex: string | undefined): { operatorSecretKey: Uint8Array; holderSecretKey: Uint8Array } {
  const { operatorSk, holderSk } = derivedKeysForMidnight(genesisHex);
  return {
    operatorSecretKey: new Uint8Array(operatorSk),
    holderSecretKey: new Uint8Array(holderSk),
  };
}

async function resolveWalletSeed(logger: Logger, genesisHex: string | undefined): Promise<Buffer | null> {
  if (genesisHex) {
    logger.info('Midnight: HD wallet from GENESIS_SEED_HASH_HEX (32-byte seed; matches UI / local-cli run-genesis)');
    return Buffer.from(genesisHex, 'hex');
  }
  const mnemonic = process.env.BIP39_MNEMONIC?.trim();
  if (mnemonic && bip39.validateMnemonic(mnemonic)) {
    logger.info('Midnight: HD wallet from BIP39_MNEMONIC');
    return Buffer.from(await bip39.mnemonicToSeed(mnemonic));
  }
  logger.error(
    'RELAYER_MIDNIGHT_ENABLED requires GENESIS_SEED_HASH_HEX (64 hex) or valid BIP39_MNEMONIC — fund the derived addresses on local Midnight',
  );
  return null;
}

/** Single-flight init: sync wallet, join or deploy registry contract. */
export async function ensureMidnightRelayer(logger: Logger): Promise<MidnightRelayerHandle | null> {
  if (!isMidnightRelayerInitEnabled()) return null;
  if (!initPromise) {
    logger.info({}, 'Midnight: ensureMidnightRelayer bootstrapping wallet + registry (single-flight, first caller)');
    initPromise = (async (): Promise<MidnightRelayerHandle | null> => {
      const genesisHex = parseGenesisSeedHashHex();
      const seed = await resolveWalletSeed(logger, genesisHex);
      if (!seed) return null;

      const walletCtx = await openMidnightWalletWithRetries(logger, seed);
      logger.info({}, 'Midnight: wallet synced');

      const cpk = walletCtx.shieldedSecretKeys.coinPublicKey;
      const walletAddress = cpk ? Uint8Array.from(Buffer.from(cpk, 'hex').subarray(0, 32)) : new Uint8Array(32);

      logger.info({}, 'Midnight: configuring zk-stables-registry providers');
      const config = new RelayerMidnightConfig();
      const providers = await configureZkStablesRegistryProviders(walletCtx, config);
      const ps = buildJoinPrivateState(genesisHex);

      const existing = process.env.RELAYER_MIDNIGHT_CONTRACT_ADDRESS?.trim();
      if (existing) {
        logger.info(
          { contract: existing, timeoutSec: Math.round(findDeployedContractTimeoutMs() / 1000) },
          'Midnight: findDeployedContract starting (bounded by RELAYER_MIDNIGHT_FIND_DEPLOYED_TIMEOUT_MS)',
        );
        const joined = await findDeployedContractWithTimeout(logger, existing, providers, ps);
        const addr = String(joined.deployTxData.public.contractAddress ?? existing);
        logger.info({ contract: addr }, 'Midnight: findDeployedContract finished');
        return { callTx: joined.callTx, contractAddress: addr, walletAddress };
      }

      if (process.env.RELAYER_MIDNIGHT_AUTO_DEPLOY !== 'true' && process.env.RELAYER_MIDNIGHT_AUTO_DEPLOY !== '1') {
        logger.warn('Set RELAYER_MIDNIGHT_CONTRACT_ADDRESS or RELAYER_MIDNIGHT_AUTO_DEPLOY=true');
        return null;
      }

      logger.info('Midnight: deploying zk-stables-registry…');
      const deployed = await deployContract(providers, {
        compiledContract: zkStablesRegistryCompiledContract,
        privateStateId: zkStablesRegistryPrivateStateId,
        initialPrivateState: {
          operatorSecretKey: new Uint8Array(ps.operatorSecretKey),
          holderSecretKey: new Uint8Array(ps.holderSecretKey),
        },
      });
      const addr = String(deployed.deployTxData.public.contractAddress);
      logger.info({ contractAddress: addr }, 'Midnight: registry deployed');
      return { callTx: deployed.callTx, contractAddress: addr, walletAddress };
    })().catch((e) => {
      initPromise = null;
      throw e;
    });
  } else {
    logger.info({}, 'Midnight: ensureMidnightRelayer awaiting in-flight bootstrap (another caller holds init)');
  }
  try {
    const h = await initPromise;
    logger.info(
      { hasHandle: Boolean(h), contractAddress: h?.contractAddress },
      'Midnight: ensureMidnightRelayer finished',
    );
    return h;
  } catch (e) {
    logger.error({ err: e }, 'Midnight: ensureMidnightRelayer bootstrap failed');
    throw e;
  }
}

export async function getMidnightContractAddress(): Promise<string | null> {
  if (initPromise) {
    try {
      const h = await initPromise;
      if (h?.contractAddress?.trim()) return h.contractAddress.trim();
    } catch {
      /* fall through to env */
    }
  }
  const fromEnv = process.env.RELAYER_MIDNIGHT_CONTRACT_ADDRESS?.trim();
  return fromEnv || null;
}

/** Indexer reads: joined contract if booted, else `RELAYER_MIDNIGHT_CONTRACT_ADDRESS`. */
export async function resolveMidnightContractAddressForRead(): Promise<string | null> {
  return getMidnightContractAddress();
}

export type MintPipelineArgs = {
  depositCommitment: Uint8Array;
  assetKind: number;
  sourceChainId: bigint;
  amount: bigint;
  holderPk: Uint8Array;
};

/**
 * Registry mint pipeline: registerDeposit → proveHolder → mintWrappedUnshielded.
 * Each call takes the `dep` (depositCommitment) argument, allowing multiple deposits
 * on the same contract instance.
 */
export async function runMidnightMintPipeline(
  logger: Logger,
  args: MintPipelineArgs,
  bridgeRecipient?: string,
): Promise<string> {
  const depPreview = `${Buffer.from(args.depositCommitment).toString('hex').slice(0, 16)}…`;
  return withMidnightPipelineMutexLogged(logger, 'mint', depPreview, async () => {
    return withMidnightNetRetries(logger, 'mintPipeline', async () => {
      await assertMidnightIndexerReachable(logger);
      logger.info({ deposit: depPreview }, 'Midnight mint: indexer reachable, calling ensureMidnightRelayer');
      const h = await ensureMidnightRelayer(logger);
      logger.info({ deposit: depPreview, hasHandle: Boolean(h) }, 'Midnight mint: ensureMidnightRelayer returned');
      if (!h) return '';

      const depHex = Buffer.from(args.depositCommitment).toString('hex');
      const lines: string[] = [`Contract ${h.contractAddress}`, `Deposit ${depHex}`];
      if (bridgeRecipient) lines.push(`Intent recipient (hint): ${bridgeRecipient}`);

      logger.info({ dep: depHex }, 'Midnight: registerDeposit…');
      try {
        const r0 = await withMidnightProofHeartbeat(logger, 'registerDeposit', depHex, () =>
          h.callTx.registerDeposit(
            args.depositCommitment,
            args.assetKind,
            args.sourceChainId,
            args.amount,
            args.holderPk,
          ),
        );
        lines.push(`registerDeposit txId=${String(r0.public.txId)} txHash=${String(r0.public.txHash)}`);
      } catch (e) {
        const msg = String(e);
        if (msg.includes('already registered')) {
          logger.warn({ dep: depHex }, 'Midnight: deposit already registered (idempotent)');
          lines.push('registerDeposit skipped: already registered');
        } else {
          logger.error({ err: msg, dep: depHex }, 'Midnight: registerDeposit failed');
          throw e;
        }
      }
      await midnightPipelineStepGap(logger);

      logger.info({ dep: depHex }, 'Midnight: proveHolder…');
      try {
        const r1 = await withMidnightProofHeartbeat(logger, 'proveHolder', depHex, () =>
          h.callTx.proveHolder(args.depositCommitment),
        );
        lines.push(`proveHolder txId=${String(r1.public.txId)} txHash=${String(r1.public.txHash)}`);
      } catch (e) {
        logger.warn({ err: String(e), dep: depHex }, 'Midnight: proveHolder failed (may already be done)');
        lines.push(`proveHolder skipped/failed: ${String(e)}`);
      }
      await midnightPipelineStepGap(logger);

      logger.info({ dep: depHex }, 'Midnight: mintWrappedUnshielded…');
      try {
        const r2 = await withMidnightProofHeartbeat(logger, 'mintWrappedUnshielded', depHex, () =>
          h.callTx.mintWrappedUnshielded(args.depositCommitment),
        );
        lines.push(`mintWrappedUnshielded txId=${String(r2.public.txId)} txHash=${String(r2.public.txHash)}`);
      } catch (e) {
        const msg = String(e);
        if (msg.includes('Already minted') || msg.includes('already minted')) {
          logger.warn({ dep: depHex }, 'Midnight: mintWrappedUnshielded skipped (already minted for this deposit)');
          lines.push('mintWrappedUnshielded skipped: already minted unshielded');
        } else {
          logger.error({ err: msg, dep: depHex }, 'Midnight: mintWrappedUnshielded failed');
          throw e;
        }
      }

      return lines.join('\n');
    });
  });
}

export type MidnightInitiateBurnHttpResult = {
  txId: string;
  txHash: string;
  contractAddress: string;
};

/**
 * Submit a single `initiateBurn` on the relayer process (same LevelDB + mutex as mint/burn pipelines).
 * Used by `POST /v1/midnight/initiate-burn` so ops scripts never open the wallet DB while the relayer is proving.
 */
export async function submitMidnightInitiateBurnHttp(
  logger: Logger,
  args: { depositCommitment: Uint8Array; destChainId: bigint; recipientCommitment: Uint8Array },
): Promise<MidnightInitiateBurnHttpResult> {
  const depPreview = `${Buffer.from(args.depositCommitment).toString('hex').slice(0, 16)}…`;
  return withMidnightPipelineMutexLogged(logger, 'initiateBurn_http', depPreview, async () => {
    await assertMidnightIndexerReachable(logger);
    const h = await ensureMidnightRelayer(logger);
    if (!h) {
      throw new Error(
        'Midnight relayer unavailable (RELAYER_MIDNIGHT_ENABLED, GENESIS_SEED_HASH_HEX or BIP39_MNEMONIC, RELAYER_MIDNIGHT_CONTRACT_ADDRESS)',
      );
    }
    const depHex = Buffer.from(args.depositCommitment).toString('hex');
    const r = await withMidnightProofHeartbeat(logger, 'initiateBurn', depHex, () =>
      h.callTx.initiateBurn(args.depositCommitment, args.destChainId, args.recipientCommitment),
    );
    logger.info(
      { txHash: String(r.public.txHash), contract: h.contractAddress },
      'Midnight: initiateBurn tx submitted (wallet.submitTransaction completed)',
    );
    return {
      txId: String(r.public.txId),
      txHash: String(r.public.txHash),
      contractAddress: h.contractAddress,
    };
  });
}

export type BurnPipelineArgs = {
  depositCommitment: Uint8Array;
  destChainId: bigint;
  recipientCommitment: Uint8Array;
};

/**
 * Registry burn pipeline (correct order per contract assertions):
 *   initiateBurn(dep, destChain, recipientComm) → sendWrappedUnshieldedToUser(dep, userAddr) → finalizeBurn(dep)
 *
 * initiateBurn sets state to 2 (exit pending).
 * sendWrappedUnshieldedToUser requires state == 2.
 * finalizeBurn requires state == 2 and tokens released.
 *
 * Each step is idempotent — if a step was already executed, the error is caught
 * and the pipeline continues.
 */
export async function runMidnightBurnPipeline(logger: Logger, args: BurnPipelineArgs): Promise<string> {
  const depPreview = `${Buffer.from(args.depositCommitment).toString('hex').slice(0, 16)}…`;
  return withMidnightPipelineMutexLogged(logger, 'burn', depPreview, async () => {
    return withMidnightNetRetries(logger, 'burnPipeline', async () => {
      await assertMidnightIndexerReachable(logger);
      logger.info({ deposit: depPreview }, 'Midnight burn: indexer reachable, calling ensureMidnightRelayer');
      const h = await ensureMidnightRelayer(logger);
      logger.info({ deposit: depPreview, hasHandle: Boolean(h) }, 'Midnight burn: ensureMidnightRelayer returned');
      if (!h) {
        throw new Error(
          'Midnight relayer handle unavailable (contract/wallet not initialized); refusing to complete BURN without on-chain finalizeBurn',
        );
      }

      const depHex = Buffer.from(args.depositCommitment).toString('hex');
      const lines: string[] = [`Contract ${h.contractAddress}`, `Deposit ${depHex}`];

      const unknownDepositHint =
        'Unknown deposit means this commitment is not a row on the relayer’s joined zk-stables-registry — usually RELAYER_MIDNIGHT_CONTRACT_ADDRESS ≠ the contract you used in the UI, or depositCommitmentHex is not the ledger ticket (do not use burnCommitmentHex / recipientComm there).';

      // Step 1: initiateBurn — marks deposit as exit-pending (state 1→2)
      logger.info({ dep: depHex }, 'Midnight: initiateBurn…');
      try {
        const r0 = await withMidnightProofHeartbeat(logger, 'initiateBurn', depHex, () =>
          h.callTx.initiateBurn(args.depositCommitment, args.destChainId, args.recipientCommitment),
        );
        lines.push(`initiateBurn txId=${String(r0.public.txId)} txHash=${String(r0.public.txHash)}`);
      } catch (e) {
        const msg = String(e);
        if (msg.includes('Unknown deposit')) {
          logger.error({ dep: depHex, contract: h.contractAddress }, 'Midnight: initiateBurn Unknown deposit');
          throw new Error(`${msg}\n${unknownDepositHint}`);
        }
        if (msg.includes('exit pending') || msg.includes('Already') || msg.includes('Not active')) {
          logger.warn({ dep: depHex }, 'Midnight: initiateBurn skipped (already exit pending or finalized)');
          lines.push('initiateBurn skipped: already exit pending');
        } else {
          logger.error({ err: msg, dep: depHex }, 'Midnight: initiateBurn failed');
          throw e;
        }
      }

      // Step 2: sendWrappedUnshieldedToUser — requires state == 2 (exit pending)
      logger.info({ dep: depHex }, 'Midnight: sendWrappedUnshieldedToUser…');
      try {
        const walletAddr = h.walletAddress;
        const r_send = await withMidnightProofHeartbeat(logger, 'sendWrappedUnshieldedToUser', depHex, () =>
          h.callTx.sendWrappedUnshieldedToUser(args.depositCommitment, { bytes: walletAddr }),
        );
        lines.push(`sendWrappedUnshieldedToUser txId=${String(r_send.public.txId)} txHash=${String(r_send.public.txHash)}`);
      } catch (e) {
        const msg = String(e);
        if (msg.includes('Unknown deposit')) {
          logger.error({ dep: depHex, contract: h.contractAddress }, 'Midnight: sendWrapped Unknown deposit');
          throw new Error(`${msg}\n${unknownDepositHint}`);
        }
        if (msg.includes('Already released') || msg.includes('already released') || msg.includes('Already sent') || msg.includes('released')) {
          logger.warn({ dep: depHex }, 'Midnight: sendWrappedUnshieldedToUser skipped (already released)');
          lines.push('sendWrappedUnshieldedToUser skipped: already released');
        } else {
          logger.error({ err: msg, dep: depHex }, 'Midnight: sendWrappedUnshieldedToUser failed');
          throw e;
        }
      }

      // Step 3: finalizeBurn — requires state == 2 and tokens released
      logger.info({ dep: depHex }, 'Midnight: finalizeBurn…');
      try {
        const r = await withMidnightProofHeartbeat(logger, 'finalizeBurn', depHex, () =>
          h.callTx.finalizeBurn(args.depositCommitment),
        );
        lines.push(`finalizeBurn txId=${String(r.public.txId)} txHash=${String(r.public.txHash)}`);
      } catch (e) {
        const msg = String(e);
        if (msg.includes('Unknown deposit')) {
          logger.error({ dep: depHex, contract: h.contractAddress }, 'Midnight: finalizeBurn Unknown deposit');
          throw new Error(`${msg}\n${unknownDepositHint}`);
        }
        if (msg.includes('already finalized') || msg.includes('Already burned')) {
          logger.warn({ dep: depHex }, 'Midnight: finalizeBurn skipped (already finalized)');
          lines.push('finalizeBurn skipped: already finalized');
        } else {
          logger.error({ err: msg, dep: depHex }, 'Midnight: finalizeBurn failed');
          throw e;
        }
      }

      return lines.join('\n');
    });
  });
}

export function warmupMidnightRelayer(logger: Logger): Promise<MidnightRelayerHandle | null> {
  return ensureMidnightRelayer(logger);
}
