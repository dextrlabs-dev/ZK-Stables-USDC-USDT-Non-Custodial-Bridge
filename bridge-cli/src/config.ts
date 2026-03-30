import { readFileSync } from 'node:fs';
import type { Address } from 'viem';
import { getAddress, isAddress } from 'viem';

export type BridgeCliEnv = {
  relayerUrl: string;
  rpcUrl: string;
  privateKey: `0x${string}`;
  poolLock: Address;
  usdcUnderlying: Address;
  usdtUnderlying: Address;
  zkUsdc: Address;
  zkUsdt: Address;
};

export function loadRelayerBaseUrl(relayerUrl?: string): string {
  return (relayerUrl ?? process.env.BRIDGE_CLI_RELAYER_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
}

function reqAddr(label: string, v: string | undefined): Address {
  const t = (v ?? '').trim();
  if (!t || !isAddress(t, { strict: false })) {
    throw new Error(`${label} must be a 0x-prefixed 20-byte address (env or --addresses-json)`);
  }
  try {
    return getAddress(t) as Address;
  } catch {
    return t.toLowerCase() as Address;
  }
}

function loadAddressesJson(path: string): Partial<Record<string, string>> {
  const raw = readFileSync(path, 'utf8');
  const j = JSON.parse(raw) as Record<string, unknown>;
  /** Support deploy artifacts that use wUSDC / pool naming from local scripts. */
  return {
    poolLock: String(j.poolLock ?? j.ZkStablesPoolLock ?? j.pool_lock ?? ''),
    usdc: String(j.mUSDC ?? j.usdc ?? j.USDC ?? ''),
    usdt: String(j.mUSDT ?? j.usdt ?? j.USDT ?? ''),
    zkUsdc: String(j.wUSDC ?? j.zkUSDC ?? j.ZkStablesWrappedTokenUSDC ?? ''),
    zkUsdt: String(j.wUSDT ?? j.zkUSDT ?? j.ZkStablesWrappedTokenUSDT ?? ''),
  };
}

export function loadEnv(params: {
  addressesJson?: string;
  relayerUrl?: string;
  rpcUrl?: string;
  privateKey?: string;
}): BridgeCliEnv {
  const relayerUrl = loadRelayerBaseUrl(params.relayerUrl);
  const rpcUrl = params.rpcUrl ?? process.env.BRIDGE_CLI_EVM_RPC_URL ?? 'http://127.0.0.1:8545';
  const pkRaw = params.privateKey ?? process.env.BRIDGE_CLI_EVM_PRIVATE_KEY ?? '';
  const pk = pkRaw.trim() as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/u.test(pk)) {
    throw new Error('Set BRIDGE_CLI_EVM_PRIVATE_KEY or --private-key to a 32-byte hex private key (0x…).');
  }

  let poolLock = process.env.BRIDGE_CLI_POOL_LOCK_ADDRESS?.trim();
  let usdc = process.env.BRIDGE_CLI_USDC_ADDRESS?.trim();
  let usdt = process.env.BRIDGE_CLI_USDT_ADDRESS?.trim();
  let zkUsdc = process.env.BRIDGE_CLI_ZKUSDC_ADDRESS?.trim();
  let zkUsdt = process.env.BRIDGE_CLI_ZKUSDT_ADDRESS?.trim();

  const jsonPath = params.addressesJson ?? process.env.BRIDGE_CLI_ADDRESSES_JSON?.trim();
  if (jsonPath) {
    const j = loadAddressesJson(jsonPath);
    poolLock = poolLock || j.poolLock;
    usdc = usdc || j.usdc;
    usdt = usdt || j.usdt;
    zkUsdc = zkUsdc || j.zkUsdc;
    zkUsdt = zkUsdt || j.zkUsdt;
  }

  return {
    relayerUrl,
    rpcUrl,
    privateKey: pk,
    poolLock: reqAddr('BRIDGE_CLI_POOL_LOCK_ADDRESS / poolLock', poolLock),
    usdcUnderlying: reqAddr('BRIDGE_CLI_USDC_ADDRESS / mUSDC', usdc),
    usdtUnderlying: reqAddr('BRIDGE_CLI_USDT_ADDRESS / mUSDT', usdt),
    zkUsdc: reqAddr('BRIDGE_CLI_ZKUSDC_ADDRESS / wUSDC', zkUsdc),
    zkUsdt: reqAddr('BRIDGE_CLI_ZKUSDT_ADDRESS / wUSDT', zkUsdt),
  };
}

export function assetKind(asset: 'USDC' | 'USDT'): number {
  return asset === 'USDT' ? 1 : 0;
}

export function underlyingForAsset(env: BridgeCliEnv, asset: 'USDC' | 'USDT'): Address {
  return asset === 'USDT' ? env.usdtUnderlying : env.usdcUnderlying;
}

export function wrappedZkForAsset(env: BridgeCliEnv, asset: 'USDC' | 'USDT'): Address {
  return asset === 'USDT' ? env.zkUsdt : env.zkUsdc;
}
