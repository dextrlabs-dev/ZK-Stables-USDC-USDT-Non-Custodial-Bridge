import { createPublicClient, formatUnits, http, isAddress, type Address } from 'viem';
import { foundry } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { mnemonicToSeedSync } from 'bip39';
import type { BridgeCliEnv } from '../config.js';
import { sumNativeAssetAtAddress } from './cardanoUtxoSum.js';
import { initWalletWithSeed } from '../midnight/walletBootstrap.js';
import { formatTokenAmount, pickBalance, readLatestUnshieldedBalances } from '../midnight/readUnshieldedBalances.js';
import type { WalletContext } from '../midnight/walletBootstrap.js';

const erc20BalanceOfAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export type DashboardBalanceSnapshot = {
  updatedAt: string;
  evm: {
    address: string;
    usdc: string;
    usdt: string;
    error?: string;
  };
  cardano: {
    address: string;
    zkUsdc: string;
    zkUsdt: string;
    indexer: string;
    error?: string;
  };
  midnight: {
    mnemonicConfigured: boolean;
    syncNote: string;
    unshieldedPreview?: string;
    zkUsdc: string;
    zkUsdt: string;
    rawTypesHelp?: string;
    error?: string;
  };
  relayer?: { ok: boolean; detail?: string };
  /** Explains independent L1 balances so EVM redeem is not confused with Cardano zk. */
  notes?: {
    cardanoZkVsEvmWrapped?: string;
  };
};

export type DashboardConfig = {
  rpcUrl: string;
  evmViewer: Address;
  usdc: Address;
  usdt: Address;
  relayerUrl: string;
  cardanoAddress?: string;
  cardanoZkUsdcUnit?: string;
  cardanoZkUsdtUnit?: string;
  cardanoApiBase?: string;
  cardanoProjectId?: string;
  cardanoDecimals: number;
  midnightMnemonic?: string;
  midnightZkUsdcRawType?: string;
  midnightZkUsdtRawType?: string;
  midnightDecimals: number;
};

export function dashboardConfigFromEnv(env: BridgeCliEnv): DashboardConfig {
  const evOverride = process.env.BRIDGE_CLI_EVM_VIEWER_ADDRESS?.trim();
  const evmViewer = (evOverride && isAddress(evOverride) ? evOverride : privateKeyToAccount(env.privateKey).address) as Address;

  const yaci = process.env.BRIDGE_CLI_YACI_STORE_URL?.trim() || process.env.RELAYER_YACI_URL?.trim() || process.env.YACI_URL?.trim();
  const bfId = process.env.BRIDGE_CLI_BLOCKFROST_PROJECT_ID?.trim() || process.env.BLOCKFROST_PROJECT_ID?.trim();
  const bfNet = (process.env.BRIDGE_CLI_BLOCKFROST_NETWORK?.trim() || 'preprod').toLowerCase();
  const bfDefault =
    bfNet === 'mainnet' ? 'https://cardano-mainnet.blockfrost.io/api/v0' : 'https://cardano-preprod.blockfrost.io/api/v0';
  const bfUrl = process.env.BRIDGE_CLI_BLOCKFROST_URL?.trim() || bfDefault;

  let cardanoApiBase: string | undefined;
  let cardanoProjectId: string | undefined;
  if (yaci) {
    cardanoApiBase = yaci.replace(/\/+$/u, '');
  } else if (bfId) {
    cardanoApiBase = bfUrl.replace(/\/+$/u, '');
    cardanoProjectId = bfId;
  }

  return {
    rpcUrl: env.rpcUrl,
    evmViewer,
    usdc: env.usdcUnderlying,
    usdt: env.usdtUnderlying,
    relayerUrl: env.relayerUrl,
    cardanoAddress: process.env.BRIDGE_CLI_CARDANO_ADDRESS?.trim(),
    cardanoZkUsdcUnit: process.env.BRIDGE_CLI_CARDANO_WUSDC_UNIT?.trim(),
    cardanoZkUsdtUnit: process.env.BRIDGE_CLI_CARDANO_WUSDT_UNIT?.trim(),
    cardanoApiBase,
    cardanoProjectId,
    cardanoDecimals: Number.parseInt(process.env.BRIDGE_CLI_CARDANO_ASSET_DECIMALS ?? '6', 10),
    midnightMnemonic: process.env.BRIDGE_CLI_MIDNIGHT_MNEMONIC?.trim() || process.env.BIP39_MNEMONIC?.trim(),
    midnightZkUsdcRawType: process.env.BRIDGE_CLI_MIDNIGHT_ZKUSDC_RAW_TYPE?.trim(),
    midnightZkUsdtRawType: process.env.BRIDGE_CLI_MIDNIGHT_ZKUSDT_RAW_TYPE?.trim(),
    midnightDecimals: Number.parseInt(process.env.BRIDGE_CLI_MIDNIGHT_ASSET_DECIMALS ?? '6', 10),
  };
}

async function readEvmUnderlying(rpcUrl: string, who: Address, usdc: Address, usdt: Address): Promise<{ usdc: string; usdt: string }> {
  const pc = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
  const [u0, u1] = await Promise.all([
    pc.readContract({ address: usdc, abi: erc20BalanceOfAbi, functionName: 'balanceOf', args: [who] }),
    pc.readContract({ address: usdt, abi: erc20BalanceOfAbi, functionName: 'balanceOf', args: [who] }),
  ]);
  const d = 6;
  return { usdc: formatUnits(u0, d), usdt: formatUnits(u1, d) };
}

let midnightCtx: WalletContext | null = null;
let midnightInitPromise: Promise<WalletContext> | null = null;

async function ensureMidnightWallet(mnemonic: string): Promise<WalletContext> {
  if (midnightCtx) return midnightCtx;
  if (!midnightInitPromise) {
    midnightInitPromise = (async () => {
      const seed = mnemonicToSeedSync(mnemonic.trim());
      const ctx = await initWalletWithSeed(Buffer.from(seed));
      midnightCtx = ctx;
      return ctx;
    })().catch((e) => {
      midnightInitPromise = null;
      throw e;
    });
  }
  return midnightInitPromise;
}

export async function buildBalanceSnapshot(env: BridgeCliEnv, dash: DashboardConfig): Promise<DashboardBalanceSnapshot> {
  const updatedAt = new Date().toISOString();

  const evmAddr = dash.evmViewer;
  let evmUsdc = '0';
  let evmUsdt = '0';
  let evmErr: string | undefined;
  try {
    const r = await readEvmUnderlying(dash.rpcUrl, evmAddr, dash.usdc, dash.usdt);
    evmUsdc = r.usdc;
    evmUsdt = r.usdt;
  } catch (e) {
    evmErr = e instanceof Error ? e.message : String(e);
  }

  const cardanoAddr = dash.cardanoAddress?.trim() ?? '';
  const cUsdcU = dash.cardanoZkUsdcUnit?.trim() ?? '';
  const cUsdtU = dash.cardanoZkUsdtUnit?.trim() ?? '';
  const apiBase = dash.cardanoApiBase?.trim() ?? '';

  let cardanoZkUsdc = '—';
  let cardanoZkUsdt = '—';
  let cardanoIndexer = 'off';
  let cardanoErr: string | undefined;
  if (cardanoAddr && apiBase && (cUsdcU || cUsdtU)) {
    cardanoIndexer = dash.cardanoProjectId ? 'blockfrost' : 'yaci-store';
    try {
      if (cUsdcU) {
        const raw = await sumNativeAssetAtAddress({
          apiBase,
          bech32Address: cardanoAddr,
          assetUnit: cUsdcU,
          projectId: dash.cardanoProjectId,
        });
        cardanoZkUsdc = formatTokenAmount(raw, dash.cardanoDecimals);
      }
      if (cUsdtU) {
        const raw = await sumNativeAssetAtAddress({
          apiBase,
          bech32Address: cardanoAddr,
          assetUnit: cUsdtU,
          projectId: dash.cardanoProjectId,
        });
        cardanoZkUsdt = formatTokenAmount(raw, dash.cardanoDecimals);
      }
    } catch (e) {
      cardanoErr = e instanceof Error ? e.message : String(e);
    }
  } else if (cardanoAddr && !apiBase) {
    cardanoErr = 'Set BRIDGE_CLI_YACI_STORE_URL or BRIDGE_CLI_BLOCKFROST_URL (+ project id for Blockfrost).';
  } else {
    cardanoIndexer = 'not configured';
  }

  const mne = dash.midnightMnemonic?.trim();
  let midnightZkUsdc = '—';
  let midnightZkUsdt = '—';
  let midnightSync = 'off';
  let midnightUnsh: string | undefined;
  let midnightHelp: string | undefined;
  let midnightErr: string | undefined;

  if (mne) {
    midnightSync = 'connecting…';
    try {
      const ctx = await ensureMidnightWallet(mne);
      const bals = await readLatestUnshieldedBalances(ctx);
      midnightSync = 'synced';
      midnightUnsh = ctx.unshieldedKeystore.getAddress().toString().slice(0, 24) + '…';
      const rawUsdc = dash.midnightZkUsdcRawType?.trim();
      const rawUsdt = dash.midnightZkUsdtRawType?.trim();
      if (rawUsdc || rawUsdt) {
        midnightZkUsdc = formatTokenAmount(pickBalance(bals, rawUsdc), dash.midnightDecimals);
        midnightZkUsdt = formatTokenAmount(pickBalance(bals, rawUsdt), dash.midnightDecimals);
      } else {
        const nonZero = Object.entries(bals).filter(([, v]) => v > 0n);
        midnightZkUsdc = nonZero.length ? '(set raw types)' : '0';
        midnightZkUsdt = nonZero.length ? '(set raw types)' : '0';
        if (nonZero.length) {
          midnightHelp = `Non-zero unshielded types: ${nonZero
            .slice(0, 4)
            .map(([k]) => `${k.slice(0, 10)}…`)
            .join(', ')} — set BRIDGE_CLI_MIDNIGHT_ZKUSDC_RAW_TYPE / _ZKUSDT_RAW_TYPE`;
        }
      }
    } catch (e) {
      midnightErr = e instanceof Error ? e.message : String(e);
      midnightSync = 'error';
    }
  } else {
    midnightSync = 'set BRIDGE_CLI_MIDNIGHT_MNEMONIC or BIP39_MNEMONIC';
  }

  let relayer: DashboardBalanceSnapshot['relayer'];
  try {
    const h = await fetch(`${dash.relayerUrl.replace(/\/$/, '')}/v1/health/chains`, { cache: 'no-store' });
    relayer = { ok: h.ok, detail: h.ok ? undefined : `HTTP ${h.status}` };
  } catch (e) {
    relayer = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  const cardanoZkConfigured = Boolean(cardanoAddr && apiBase && (cUsdcU || cUsdtU));
  const notes: DashboardBalanceSnapshot['notes'] =
    cardanoZkConfigured && !cardanoErr
      ? {
          cardanoZkVsEvmWrapped:
            'Cardano zkUSDC/zkUSDT are **native** balances at BRIDGE_CLI_CARDANO_ADDRESS. `redeem evm` burns **wUSDC/wUSDT on EVM** only. `redeem cardano` posts a BURN bound to the **lock_pool** lock + BridgeRelease spend and unlocks **mUSDC/mUSDT on EVM**; it does **not** by itself spend tokens still sitting in unrelated payment UTxOs at this address (mint→release already moved zk here). To reduce this line item, move/spend those native assets on-chain (e.g. send elsewhere).',
        }
      : undefined;

  return {
    updatedAt,
    evm: { address: evmAddr, usdc: evmUsdc, usdt: evmUsdt, error: evmErr },
    cardano: {
      address: cardanoAddr || '—',
      zkUsdc: cardanoZkUsdc,
      zkUsdt: cardanoZkUsdt,
      indexer: cardanoIndexer,
      error: cardanoErr,
    },
    midnight: {
      mnemonicConfigured: Boolean(mne),
      syncNote: midnightSync,
      unshieldedPreview: midnightUnsh,
      zkUsdc: midnightZkUsdc,
      zkUsdt: midnightZkUsdt,
      rawTypesHelp: midnightHelp,
      error: midnightErr,
    },
    relayer,
    ...(notes ? { notes } : {}),
  };
}
