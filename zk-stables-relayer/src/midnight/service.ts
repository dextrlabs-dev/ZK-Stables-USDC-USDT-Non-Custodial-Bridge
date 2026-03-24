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
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as Rx from 'rxjs';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { zkStablesRegistryPrivateStateId } from '@zk-stables/midnight-contract';
import type { Logger } from 'pino';
import { zkStablesRegistryCompiledContract } from './zk-stables-compiled-contract.js';
import { RelayerMidnightConfig } from './config.js';
import { configureZkStablesRegistryProviders } from './providers.js';
import { initWalletWithSeed } from './wallet.js';
import { holderLedgerPublicKey } from './holder-key.js';
import { withMidnightPipelineMutex } from './midnightPipelineMutex.js';

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
  if (!isMidnightBridgeEnabled()) return null;
  if (!initPromise) {
    initPromise = (async (): Promise<MidnightRelayerHandle | null> => {
      const genesisHex = parseGenesisSeedHashHex();
      const seed = await resolveWalletSeed(logger, genesisHex);
      if (!seed) return null;

      const walletCtx = await initWalletWithSeed(seed);
      logger.info('Midnight: waiting for wallet sync…');
      await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
      logger.info('Midnight: wallet synced');

      const cpk = walletCtx.shieldedSecretKeys.coinPublicKey;
      const walletAddress = cpk ? Uint8Array.from(Buffer.from(cpk, 'hex').subarray(0, 32)) : new Uint8Array(32);

      const config = new RelayerMidnightConfig();
      const providers = await configureZkStablesRegistryProviders(walletCtx, config);
      const ps = buildJoinPrivateState(genesisHex);

      const existing = process.env.RELAYER_MIDNIGHT_CONTRACT_ADDRESS?.trim();
      if (existing) {
        logger.info({ contract: existing }, 'Midnight: joining existing registry contract');
        const joined = await findDeployedContract(providers as never, {
          contractAddress: existing,
          compiledContract: zkStablesRegistryCompiledContract,
          privateStateId: zkStablesRegistryPrivateStateId,
          initialPrivateState: ps,
        });
        const addr = String(joined.deployTxData.public.contractAddress ?? existing);
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
  }
  return initPromise;
}

export async function getMidnightContractAddress(): Promise<string | null> {
  if (!initPromise) return null;
  try {
    const h = await initPromise;
    return h?.contractAddress ?? null;
  } catch {
    return null;
  }
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
  return withMidnightPipelineMutex(async () => {
    const h = await ensureMidnightRelayer(logger);
    if (!h) return '';

    const depHex = Buffer.from(args.depositCommitment).toString('hex');
    const lines: string[] = [`Contract ${h.contractAddress}`, `Deposit ${depHex}`];
    if (bridgeRecipient) lines.push(`Intent recipient (hint): ${bridgeRecipient}`);

    logger.info({ dep: depHex }, 'Midnight: registerDeposit…');
    try {
      const r0 = await h.callTx.registerDeposit(
        args.depositCommitment,
        args.assetKind,
        args.sourceChainId,
        args.amount,
        args.holderPk,
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

    logger.info({ dep: depHex }, 'Midnight: proveHolder…');
    try {
      const r1 = await h.callTx.proveHolder(args.depositCommitment);
      lines.push(`proveHolder txId=${String(r1.public.txId)} txHash=${String(r1.public.txHash)}`);
    } catch (e) {
      logger.warn({ err: String(e), dep: depHex }, 'Midnight: proveHolder failed (may already be done)');
      lines.push(`proveHolder skipped/failed: ${String(e)}`);
    }

    logger.info({ dep: depHex }, 'Midnight: mintWrappedUnshielded…');
    try {
      const r2 = await h.callTx.mintWrappedUnshielded(args.depositCommitment);
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
  return withMidnightPipelineMutex(async () => {
    const h = await ensureMidnightRelayer(logger);
    if (!h) return '';

    const depHex = Buffer.from(args.depositCommitment).toString('hex');
    const lines: string[] = [`Contract ${h.contractAddress}`, `Deposit ${depHex}`];

    // Step 1: initiateBurn — marks deposit as exit-pending (state 1→2)
    logger.info({ dep: depHex }, 'Midnight: initiateBurn…');
    try {
      const r0 = await h.callTx.initiateBurn(
        args.depositCommitment,
        args.destChainId,
        args.recipientCommitment,
      );
      lines.push(`initiateBurn txId=${String(r0.public.txId)} txHash=${String(r0.public.txHash)}`);
    } catch (e) {
      const msg = String(e);
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
      const r_send = await h.callTx.sendWrappedUnshieldedToUser(
        args.depositCommitment,
        { bytes: walletAddr },
      );
      lines.push(`sendWrappedUnshieldedToUser txId=${String(r_send.public.txId)} txHash=${String(r_send.public.txHash)}`);
    } catch (e) {
      const msg = String(e);
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
      const r = await h.callTx.finalizeBurn(args.depositCommitment);
      lines.push(`finalizeBurn txId=${String(r.public.txId)} txHash=${String(r.public.txHash)}`);
    } catch (e) {
      const msg = String(e);
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
}

export function warmupMidnightRelayer(logger: Logger): Promise<MidnightRelayerHandle | null> {
  return ensureMidnightRelayer(logger);
}
