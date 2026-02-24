/**
 * SRS-aligned relayer configuration (Lock→Prove→Mint, Burn→Prove→Unlock across EVM, Cardano, Midnight).
 * When strict mode is on, every chain adapter and operator path required by the architecture must be present.
 */
import type { Logger } from 'pino';
import * as bip39 from 'bip39';
import { cardanoIndexerMode } from '../adapters/cardanoIndexer.js';
import { isMidnightBridgeEnabled } from '../midnight/service.js';

function envTrim(key: string): string {
  return String(process.env[key] ?? '').trim();
}

function isTruthyFlag(key: string): boolean {
  const v = envTrim(key).toLowerCase();
  return v === 'true' || v === '1';
}

/** `RELAYER_SRS_STRICT=true` enforces the full SRS stack (default in integration template). */
export function isSrsStrictMode(): boolean {
  return isTruthyFlag('RELAYER_SRS_STRICT');
}

function hasCardanoWalletMnemonic(): boolean {
  return Boolean(envTrim('RELAYER_CARDANO_WALLET_MNEMONIC') || envTrim('CARDANO_WALLET_MNEMONIC'));
}

function hasMidnightWalletSecret(): boolean {
  const g = envTrim('GENESIS_SEED_HASH_HEX').replace(/^0x/i, '');
  if (g && /^[0-9a-fA-F]{64}$/.test(g)) return true;
  const m = envTrim('BIP39_MNEMONIC');
  return Boolean(m && bip39.validateMnemonic(m));
}

function hasMidnightContractConfig(): boolean {
  return Boolean(envTrim('RELAYER_MIDNIGHT_CONTRACT_ADDRESS')) || isTruthyFlag('RELAYER_MIDNIGHT_AUTO_DEPLOY');
}

function fatal(logger: Logger, msg: string): never {
  logger.fatal(msg);
  process.exit(1);
}

/** Legacy: only Midnight + Cardano indexer/features (kept for existing .env files). */
function assertLegacyMidnightCardano(logger: Logger): void {
  if (!isMidnightBridgeEnabled()) {
    fatal(
      logger,
      'RELAYER_REQUIRE_MIDNIGHT_AND_CARDANO: set RELAYER_MIDNIGHT_ENABLED=true and GENESIS_SEED_HASH_HEX or BIP39_MNEMONIC',
    );
  }
  if (cardanoIndexerMode() === 'none') {
    fatal(logger, 'RELAYER_REQUIRE_MIDNIGHT_AND_CARDANO: set RELAYER_YACI_URL or RELAYER_BLOCKFROST_PROJECT_ID');
  }
  const w = isTruthyFlag('RELAYER_CARDANO_WATCHER_ENABLED');
  const b = isTruthyFlag('RELAYER_CARDANO_BRIDGE_ENABLED');
  if (!w && !b) {
    fatal(
      logger,
      'RELAYER_REQUIRE_MIDNIGHT_AND_CARDANO: set RELAYER_CARDANO_WATCHER_ENABLED=true and/or RELAYER_CARDANO_BRIDGE_ENABLED=true',
    );
  }
  logger.info('RELAYER_REQUIRE_MIDNIGHT_AND_CARDANO: Midnight + Cardano checks passed');
}

/**
 * Full SRS: three chains × LOCK/BURN support — EVM watchers + pool + mint + unlock, Cardano indexer + watcher + payout,
 * Midnight automation, demo wallets API, bridge operator recipients.
 */
function assertSrsStrict(logger: Logger): void {
  const missing: string[] = [];
  const need = (name: string) => {
    if (!envTrim(name)) missing.push(name);
  };

  // EVM — LOCK ingestion, BURN ingestion, BURN→unlock, LOCK→EVM mint
  need('RELAYER_EVM_LOCK_ADDRESS');
  need('RELAYER_EVM_WRAPPED_TOKEN');
  need('RELAYER_EVM_POOL_LOCK');
  need('RELAYER_EVM_UNDERLYING_TOKEN');
  need('RELAYER_EVM_PRIVATE_KEY');
  need('RELAYER_EVM_BRIDGE_MINT');

  // Cardano — indexer, lock script address, both operations (ingest + settle)
  if (cardanoIndexerMode() === 'none') {
    missing.push('RELAYER_YACI_URL or RELAYER_BLOCKFROST_PROJECT_ID');
  }
  need('RELAYER_CARDANO_LOCK_ADDRESS');
  if (!hasCardanoWalletMnemonic()) {
    missing.push('RELAYER_CARDANO_WALLET_MNEMONIC (or CARDANO_WALLET_MNEMONIC)');
  }
  if (!isTruthyFlag('RELAYER_CARDANO_WATCHER_ENABLED')) missing.push('RELAYER_CARDANO_WATCHER_ENABLED=true');
  if (!isTruthyFlag('RELAYER_CARDANO_BRIDGE_ENABLED')) missing.push('RELAYER_CARDANO_BRIDGE_ENABLED=true');

  // Midnight — wallet + contract
  if (!isMidnightBridgeEnabled()) missing.push('RELAYER_MIDNIGHT_ENABLED=true');
  if (!hasMidnightWalletSecret()) missing.push('GENESIS_SEED_HASH_HEX (64 hex) or BIP39_MNEMONIC');
  if (!hasMidnightContractConfig()) missing.push('RELAYER_MIDNIGHT_CONTRACT_ADDRESS or RELAYER_MIDNIGHT_AUTO_DEPLOY=true');

  // SRS bridge UI / demo operator identities
  if (!isTruthyFlag('RELAYER_ENABLE_DEMO_WALLETS')) missing.push('RELAYER_ENABLE_DEMO_WALLETS=true');
  need('RELAYER_BRIDGE_EVM_RECIPIENT');
  need('RELAYER_BRIDGE_CARDANO_RECIPIENT');
  need('RELAYER_BRIDGE_MIDNIGHT_RECIPIENT');

  if (missing.length > 0) {
    fatal(
      logger,
      `RELAYER_SRS_STRICT: missing or invalid — ${missing.join('; ')}. See docs/SRS_RELAYER_REQUIREMENTS.md`,
    );
  }

  logger.info('RELAYER_SRS_STRICT: SRS relayer configuration checks passed (EVM + Cardano + Midnight + demo + bridge recipients)');
}

/**
 * Call once at process startup. Order:
 * 1. `RELAYER_SRS_STRICT=true` → full SRS matrix (nothing optional).
 * 2. Else `RELAYER_REQUIRE_MIDNIGHT_AND_CARDANO=true` → legacy Midnight + Cardano only.
 */
export function assertRelayerStartupConfig(logger: Logger): void {
  if (isSrsStrictMode()) {
    assertSrsStrict(logger);
    return;
  }
  const legacy = isTruthyFlag('RELAYER_REQUIRE_MIDNIGHT_AND_CARDANO');
  if (legacy) {
    assertLegacyMidnightCardano(logger);
  }
}
