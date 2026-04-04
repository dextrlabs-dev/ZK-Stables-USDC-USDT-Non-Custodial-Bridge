/**
 * Operator console: allow Midnight wallet/registry txs when RELAYER_MIDNIGHT_ENABLED is off
 * but RELAYER_OPERATOR_CONSOLE_MIDNIGHT_TX (or RELAYER_OPERATOR_CONSOLE_ALL) is set with seed + contract.
 * Anyone who can reach these endpoints can spend the Midnight operator wallet — keep off public networks.
 */
import * as bip39 from 'bip39';

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

function hasMidnightWalletSecret(): boolean {
  const g = envTrim('GENESIS_SEED_HASH_HEX').replace(/^0x/i, '');
  if (g && /^[0-9a-fA-F]{64}$/u.test(g)) return true;
  const m = envTrim('BIP39_MNEMONIC');
  return Boolean(m && bip39.validateMnemonic(m));
}

function hasMidnightContractConfig(): boolean {
  return Boolean(envTrim('RELAYER_MIDNIGHT_CONTRACT_ADDRESS')) || isTruthyOpFlag('RELAYER_MIDNIGHT_AUTO_DEPLOY');
}

/** Gated Midnight operator HTTP (initiateBurn, one-shot redeem, etc.). */
export function isRelayerMidnightOperatorConsoleTxEnabled(): boolean {
  if (isRelayerOperatorConsoleAllEnabled()) {
    return hasMidnightWalletSecret() && hasMidnightContractConfig();
  }
  if (!isTruthyOpFlag('RELAYER_OPERATOR_CONSOLE_MIDNIGHT_TX')) return false;
  return hasMidnightWalletSecret() && hasMidnightContractConfig();
}

/** Bootstrap `ensureMidnightRelayer` / warmup when full bridge OR operator-console Midnight is on. */
export function isMidnightRelayerInitEnabled(): boolean {
  const fullBridge =
    process.env.RELAYER_MIDNIGHT_ENABLED === 'true' || process.env.RELAYER_MIDNIGHT_ENABLED === '1';
  return fullBridge || isRelayerMidnightOperatorConsoleTxEnabled();
}
