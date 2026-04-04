/**
 * Operator console: Cardano Mesh txs (mint+lock+release, burn intent prep).
 * Gated by RELAYER_OPERATOR_CONSOLE_CARDANO_TX or RELAYER_OPERATOR_CONSOLE_ALL + RELAYER_CARDANO_WALLET_MNEMONIC.
 * Exposing these routes on a public URL lets anyone trigger spends from the bridge wallet — use auth / private networks.
 */
import { cardanoIndexerMode } from './cardanoIndexer.js';

function envTrim(key: string): string {
  return String(process.env[key] ?? '').trim();
}

function isTruthyOpFlag(key: string): boolean {
  const v = envTrim(key).toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function isRelayerOperatorConsoleAllEnabled(): boolean {
  return isTruthyOpFlag('RELAYER_OPERATOR_CONSOLE_ALL');
}

function hasCardanoWalletMnemonic(): boolean {
  return Boolean(envTrim('RELAYER_CARDANO_WALLET_MNEMONIC') || envTrim('CARDANO_WALLET_MNEMONIC'));
}

export function isRelayerCardanoOperatorConsoleTxEnabled(): boolean {
  if (isRelayerOperatorConsoleAllEnabled()) {
    return hasCardanoWalletMnemonic() && cardanoIndexerMode() !== 'none';
  }
  if (!isTruthyOpFlag('RELAYER_OPERATOR_CONSOLE_CARDANO_TX')) return false;
  return hasCardanoWalletMnemonic() && cardanoIndexerMode() !== 'none';
}
