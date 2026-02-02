import '@nomicfoundation/hardhat-toolbox';
import { type HardhatUserConfig } from 'hardhat/config';

const anvilUrl = process.env.EVM_RPC_URL ?? 'http://127.0.0.1:8545';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  networks: {
    anvil: {
      url: anvilUrl,
      chainId: 31337,
    },
  },
};

export default config;

