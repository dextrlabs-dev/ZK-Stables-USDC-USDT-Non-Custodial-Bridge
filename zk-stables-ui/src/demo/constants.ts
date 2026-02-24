import type { Address } from 'viem';

/** Hardhat / Anvil default rich accounts (public test keys — never use on mainnet). */
export const ANVIL_DEMO_ACCOUNTS = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
] as const satisfies readonly Address[];

/** Example Midnight shielded address on undeployed (for docs / UI copy). */
export const DEMO_MIDNIGHT_SHIELDED =
  'mn_addr_undeployed1ry6lnrfldz80fdvwrpxf5yyfftej5mjjj466dfpgcymh955j3gusey46r3';

/** Synthetic CIP-30-style payload (hex payment credential) for UI-only demo when no extension is present. */
export const DEMO_CARDANO_USED_HEX =
  '005868020a9edf2045716fa575bb82e694f23a785bdfddb6db2cbf750000000000000000000000000';

/** Testnet bech32 (matches Yaci / RELAYER_CARDANO_NETWORK_ID=0). Mainnet addr1… breaks Mesh tx build with preview. */
export const DEMO_CARDANO_BECH32_PREVIEW =
  'addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn';

/** Second demo Cardano address for bridge “destination” when relayer demo API is off. */
export const DEMO_CARDANO_BECH32_DEST =
  'addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn';

export function demoWalletsEnabled(): boolean {
  if (import.meta.env.VITE_ENABLE_DEMO_WALLETS === 'false') return false;
  if (import.meta.env.VITE_ENABLE_DEMO_WALLETS === 'true') return true;
  return import.meta.env.DEV;
}
