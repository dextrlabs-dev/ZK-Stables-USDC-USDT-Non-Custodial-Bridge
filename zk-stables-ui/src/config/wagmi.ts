import { createConfig, http, injected, mock } from 'wagmi';
import { hardhat, mainnet, sepolia } from 'viem/chains';
import { ANVIL_DEMO_ACCOUNTS, demoWalletsEnabled } from '../demo/constants.js';

const sepoliaRpc = import.meta.env.VITE_ETH_SEPOLIA_RPC_URL;
const mainnetRpc = import.meta.env.VITE_ETH_MAINNET_RPC_URL;

const connectors = demoWalletsEnabled()
  ? [
      injected(),
      mock({
        accounts: [ANVIL_DEMO_ACCOUNTS[0], ANVIL_DEMO_ACCOUNTS[1], ANVIL_DEMO_ACCOUNTS[2]],
        features: { reconnect: true },
      }),
    ]
  : [injected()];

export const wagmiConfig = createConfig({
  // Hardhat first: mock connector's initial chain + RPC URL come from chains[0]; must be local 31337 (not Sepolia RPC).
  chains: [hardhat, sepolia, mainnet],
  connectors,
  transports: {
    [hardhat.id]: http(import.meta.env.VITE_ETH_LOCALHOST_RPC_URL || 'http://127.0.0.1:8545'),
    [sepolia.id]: http(sepoliaRpc || undefined),
    [mainnet.id]: http(mainnetRpc || undefined),
  },
});
