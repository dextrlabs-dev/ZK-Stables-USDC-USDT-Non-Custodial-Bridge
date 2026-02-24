/**
 * When relayer `GET /v1/demo/wallets` is disabled, still show a coherent demo identity set.
 */
import {
  ANVIL_DEMO_ACCOUNTS,
  DEMO_CARDANO_BECH32_DEST,
  DEMO_CARDANO_BECH32_PREVIEW,
  DEMO_MIDNIGHT_SHIELDED,
} from '../demo/constants.js';
import type { DemoWalletsResponse } from './relayerClient.js';

export function buildLocalDemoFallback(): DemoWalletsResponse {
  return {
    enabled: true,
    demoBalances: { usdc: '10000', usdt: '10000' },
    evm: {
      accounts: ANVIL_DEMO_ACCOUNTS.map((address, index) => ({
        index,
        path: `m/44'/60'/0'/0/${index}`,
        address,
      })),
    },
    cardano: {
      addresses: [
        { role: 'source' as const, bech32: DEMO_CARDANO_BECH32_PREVIEW },
        { role: 'destination' as const, bech32: DEMO_CARDANO_BECH32_DEST },
      ],
    },
    midnight: {
      shieldedExample: DEMO_MIDNIGHT_SHIELDED,
      unshieldedExample:
        'mn_addr_undeployed1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqu',
      note: 'Connect Lace or import the Hardhat/Anvil mnemonic in a Midnight wallet for a live address.',
    },
    warning: 'Using built-in public demo addresses (no relayer demo API). EVM keys are public test accounts.',
  };
}
