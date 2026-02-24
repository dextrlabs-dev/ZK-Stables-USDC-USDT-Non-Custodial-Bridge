/**
 * Relayer-side Midnight wallet + zk-stables contract (deploy/join + proveHolder + mintWrappedUnshielded).
 *
 * Wallet seed (first match):
 * - **`GENESIS_SEED_HASH_HEX`** — 64 hex chars used as the 32-byte HD seed (same as zk-stables-ui + `local-cli` run-genesis).
 * - **`BIP39_MNEMONIC`** — BIP-39 phrase; seed = `bip39.mnemonicToSeed`.
 *
 * When using genesis, deploy/join keys default from the same labels as `run-genesis-all.ts` unless overridden:
 * `DEPOSIT_COMMITMENT_HEX`, `OPERATOR_SK_HEX`, `HOLDER_SK_HEX`.
 */
import { createHash } from 'node:crypto';
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as Rx from 'rxjs';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { zkStablesPrivateStateId, AssetKind } from '@zk-stables/midnight-contract';
import type { Logger } from 'pino';
import { zkStablesCompiledContract } from './zk-stables-compiled-contract.js';
import { RelayerMidnightConfig } from './config.js';
import { configureZkStablesProviders } from './providers.js';
import { initWalletWithSeed } from './wallet.js';
import { holderLedgerPublicKey } from './holder-key.js';

(globalThis as unknown as { WebSocket?: typeof WebSocket }).WebSocket = WebSocket;

export type MidnightRelayerHandle = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callTx: any;
  contractAddress: string;
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

/** Same derivation as `local-cli/src/run-genesis-all.ts` / UI `deriveBytes32HexFromGenesis`. */
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
  depositCommitment: Uint8Array;
  operatorSk: Uint8Array;
  holderSk: Uint8Array;
};

function derivedKeysForMidnight(genesisHex: string | undefined): DerivedDeployKeys {
  if (genesisHex) {
    return {
      depositCommitment: hexToBytes32(
        process.env.DEPOSIT_COMMITMENT_HEX ?? deriveBytes32HexFromGenesis(genesisHex, 'zkstables:depositCommitment:v1'),
      ),
      operatorSk: hexToBytes32(
        process.env.OPERATOR_SK_HEX ?? deriveBytes32HexFromGenesis(genesisHex, 'zkstables:operatorSk:v1'),
      ),
      holderSk: hexToBytes32(process.env.HOLDER_SK_HEX ?? deriveBytes32HexFromGenesis(genesisHex, 'zkstables:holderSk:v1')),
    };
  }
  return {
    depositCommitment: hexToBytes32(process.env.DEPOSIT_COMMITMENT_HEX ?? '00'.repeat(32)),
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

/** Single-flight init: sync wallet, join or deploy contract. */
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

      const config = new RelayerMidnightConfig();
      const providers = await configureZkStablesProviders(walletCtx, config);
      const ps = buildJoinPrivateState(genesisHex);

      const existing = process.env.RELAYER_MIDNIGHT_CONTRACT_ADDRESS?.trim();
      if (existing) {
        logger.info({ contract: existing }, 'Midnight: joining existing contract');
        const joined = await findDeployedContract(providers as never, {
          contractAddress: existing,
          compiledContract: zkStablesCompiledContract,
          privateStateId: zkStablesPrivateStateId,
          initialPrivateState: ps,
        });
        const addr = String(joined.deployTxData.public.contractAddress ?? existing);
        return { callTx: joined.callTx, contractAddress: addr };
      }

      if (process.env.RELAYER_MIDNIGHT_AUTO_DEPLOY !== 'true' && process.env.RELAYER_MIDNIGHT_AUTO_DEPLOY !== '1') {
        logger.warn('Set RELAYER_MIDNIGHT_CONTRACT_ADDRESS or RELAYER_MIDNIGHT_AUTO_DEPLOY=true');
        return null;
      }

      const dk = derivedKeysForMidnight(genesisHex);
      const ownerPk = holderLedgerPublicKey(dk.holderSk);

      logger.info('Midnight: deploying zk-stables…');
      const deployed = await deployContract(providers, {
        compiledContract: zkStablesCompiledContract,
        privateStateId: zkStablesPrivateStateId,
        initialPrivateState: {
          operatorSecretKey: new Uint8Array(dk.operatorSk),
          holderSecretKey: new Uint8Array(dk.holderSk),
        },
        args: [dk.depositCommitment, AssetKind.USDC, 1n, 1_000_000n, new Uint8Array(ownerPk)],
      });
      const addr = String(deployed.deployTxData.public.contractAddress);
      logger.info({ contractAddress: addr }, 'Midnight: deployed');
      return { callTx: deployed.callTx, contractAddress: addr };
    })().catch((e) => {
      initPromise = null;
      throw e;
    });
  }
  return initPromise;
}

/**
 * After stub/real proof: run on-chain Midnight steps for demo bridge (proveHolder → mintWrappedUnshielded).
 * Idempotent-ish: proveHolder failures may be ignored; `mintWrappedUnshielded` runs at most once per
 * contract instance — repeat LOCK→Midnight jobs hit "Already minted unshielded" and are treated as OK.
 */
export async function runMidnightMintPipeline(logger: Logger, bridgeRecipient?: string): Promise<string> {
  const h = await ensureMidnightRelayer(logger);
  if (!h) return '';

  const lines: string[] = [`Contract ${h.contractAddress}`];
  if (bridgeRecipient) lines.push(`Intent recipient (hint): ${bridgeRecipient}`);

  logger.info('Midnight: proveHolder…');
  try {
    const r1 = await h.callTx.proveHolder();
    lines.push(`proveHolder txId=${String(r1.public.txId)} txHash=${String(r1.public.txHash)}`);
  } catch (e) {
    logger.warn({ err: String(e) }, 'Midnight: proveHolder failed (may already be done)');
    lines.push(`proveHolder skipped/failed: ${String(e)}`);
  }

  logger.info('Midnight: mintWrappedUnshielded…');
  try {
    const r2 = await h.callTx.mintWrappedUnshielded();
    lines.push(`mintWrappedUnshielded txId=${String(r2.public.txId)} txHash=${String(r2.public.txHash)}`);
  } catch (e) {
    const msg = String(e);
    if (msg.includes('Already minted unshielded')) {
      logger.warn('Midnight: mintWrappedUnshielded skipped (contract already minted unshielded once — expected on repeat LOCK→Midnight jobs)');
      lines.push('mintWrappedUnshielded skipped: already minted unshielded on this contract instance');
    } else {
      logger.error({ err: msg }, 'Midnight: mintWrappedUnshielded failed');
      throw e;
    }
  }

  return lines.join('\n');
}

export function warmupMidnightRelayer(logger: Logger): Promise<MidnightRelayerHandle | null> {
  return ensureMidnightRelayer(logger);
}
