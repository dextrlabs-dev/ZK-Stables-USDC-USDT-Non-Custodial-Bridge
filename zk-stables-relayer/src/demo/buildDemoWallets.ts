/**
 * Deterministic demo wallets for local UI (SRS demo / integration).
 * Secrets are omitted when NODE_ENV=production.
 */
import { mnemonicToAccount } from 'viem/accounts';
import { toHex } from 'viem';

/** Same phrase as Hardhat / Anvil default — public, never for mainnet. */
export const DEFAULT_DEMO_MNEMONIC =
  'test test test test test test test test test test test junk';

export type DemoEvmAccount = {
  index: number;
  path: string;
  address: `0x${string}`;
  /** Only in non-production when demo wallets enabled. */
  privateKey?: `0x${string}`;
};

export type DemoCardanoAddress = {
  role: 'source' | 'destination';
  bech32: string;
  /** Hex payment credential / stake-style cred for UI paste (may be synthetic for demo). */
  paymentCredHex?: string;
};

export type DemoMidnightAddresses = {
  /** Example shielded bech32 (undeployed) — import mnemonic in Lace to obtain real addr. */
  shieldedExample: string;
  unshieldedExample: string;
  note: string;
};

export type DemoWalletsResponse = {
  enabled: true;
  /** Demo USDC/USDT balances (UI only; not on-chain verified). */
  demoBalances: { usdc: string; usdt: string };
  evm: {
    mnemonic?: string;
    accounts: DemoEvmAccount[];
  };
  cardano: {
    mnemonic?: string;
    addresses: DemoCardanoAddress[];
  };
  midnight: {
    mnemonic?: string;
  } & DemoMidnightAddresses;
  warning: string;
};

function deriveEvmAccounts(mnemonic: string, count: number, exposeSecrets: boolean): DemoEvmAccount[] {
  const out: DemoEvmAccount[] = [];
  for (let i = 0; i < count; i += 1) {
    const acc = mnemonicToAccount(mnemonic, { addressIndex: i });
    const hd = acc.getHdKey();
    const pk = hd.privateKey;
    const path = `m/44'/60'/0'/0/${i}`;
    out.push({
      index: i,
      path,
      address: acc.address,
      privateKey: exposeSecrets && pk ? (toHex(pk) as `0x${string}`) : undefined,
    });
  }
  return out;
}

export function buildDemoWallets(): DemoWalletsResponse {
  const exposeSecrets = process.env.NODE_ENV !== 'production';
  const evmMnemonic = (process.env.RELAYER_DEMO_MNEMONIC_EVM ?? DEFAULT_DEMO_MNEMONIC).trim();
  const cardanoMnemonic = (process.env.RELAYER_DEMO_MNEMONIC_CARDANO ?? evmMnemonic).trim();
  const midnightMnemonic = (process.env.RELAYER_DEMO_MNEMONIC_MIDNIGHT ?? evmMnemonic).trim();

  const cardanoSrc =
    process.env.RELAYER_DEMO_CARDANO_ADDRESS_SRC?.trim() ||
    'addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn';
  const cardanoDst =
    process.env.RELAYER_DEMO_CARDANO_ADDRESS_DST?.trim() ||
    'addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn';

  const shielded =
    process.env.RELAYER_DEMO_MIDNIGHT_SHIELDED?.trim() ||
    'mn_addr_undeployed1ry6lnrfldz80fdvwrpxf5yyfftej5mjjj466dfpgcymh955j3gusey46r3';
  const unshielded =
    process.env.RELAYER_DEMO_MIDNIGHT_UNSHIELDED?.trim() ||
    'mn_addr_undeployed1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqu';

  const credHex = process.env.RELAYER_DEMO_CARDANO_PAYMENT_CRED_HEX?.trim();

  return {
    enabled: true,
    demoBalances: {
      usdc: process.env.RELAYER_DEMO_BALANCE_USDC ?? '10000',
      usdt: process.env.RELAYER_DEMO_BALANCE_USDT ?? '10000',
    },
    evm: {
      mnemonic: exposeSecrets ? evmMnemonic : undefined,
      accounts: deriveEvmAccounts(evmMnemonic, 3, exposeSecrets),
    },
    cardano: {
      mnemonic: exposeSecrets ? cardanoMnemonic : undefined,
      addresses: [
        { role: 'source', bech32: cardanoSrc, paymentCredHex: credHex },
        { role: 'destination', bech32: cardanoDst },
      ],
    },
    midnight: {
      mnemonic: exposeSecrets ? midnightMnemonic : undefined,
      shieldedExample: shielded,
      unshieldedExample: unshielded,
      note:
        'Midnight shielded/unshielded addresses come from Lace or local-cli after importing the demo mnemonic; examples above are for copy/paste in undeployed dev.',
    },
    warning:
      'Demo mnemonics and private keys are for local development only. Never use these on mainnet or with real funds.',
  };
}
