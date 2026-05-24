import { readFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { config } from '../config.js';

export type DeployAddresses = {
  USDC: `0x${string}`;
  USDT: `0x${string}`;
  poolLock: `0x${string}`;
  bridgeMint: `0x${string}`;
  wUSDC: `0x${string}`;
  wUSDT: `0x${string}`;
};

const ANVIL_PRIVATE_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
] as const;

const chain = { ...foundry, id: 31337 };

export function getAnvilAccounts() {
  return ANVIL_PRIVATE_KEYS.map(pk => ({
    account: privateKeyToAccount(pk),
    wallet: createWalletClient({
      account: privateKeyToAccount(pk),
      chain,
      transport: http(config.evmRpcUrl),
    }),
  }));
}

export function getPublicClient() {
  return createPublicClient({ chain, transport: http(config.evmRpcUrl) });
}

export async function loadAddresses(): Promise<DeployAddresses> {
  try {
    const raw = await readFile(config.addrsJson, 'utf-8');
    const data = JSON.parse(raw);
    return {
      USDC: data.USDC || data.usdc,
      USDT: data.USDT || data.usdt,
      poolLock: data.POOL || data.poolLock || data.pool,
      bridgeMint: data.bridgeMint || data.BRIDGE_MINT,
      wUSDC: data.wUSDC || data.WUSDC,
      wUSDT: data.wUSDT || data.WUSDT,
    };
  } catch {
    return {
      USDC: '0x7a2088a1bFc9d81c55368AE168C2C02570cB814F',
      USDT: '0x36C02dA8a0983159322a80FFE9F24b1acfF8B570',
      poolLock: '0xc5a5C42992dECbae36851359345FE25997F5C42d',
      bridgeMint: '0x0000000000000000000000000000000000000000',
      wUSDC: '0x0000000000000000000000000000000000000000',
      wUSDT: '0x0000000000000000000000000000000000000000',
    };
  }
}

const erc20Abi = parseAbi([
  'function approve(address,uint256) external returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

const poolAbi = parseAbi([
  'function lock(address token,uint256 amount,address recipient,bytes32 nonce) external',
]);

export { erc20Abi, poolAbi };
