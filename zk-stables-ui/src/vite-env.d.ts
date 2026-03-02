/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK_ID: string;
  readonly VITE_LOGGING_LEVEL: string;
  readonly VITE_ETH_SEPOLIA_RPC_URL?: string;
  readonly VITE_ETH_MAINNET_RPC_URL?: string;
  readonly VITE_ETH_LOCALHOST_RPC_URL?: string;
  readonly VITE_EVM_LOCK_CONTRACT?: string;
  /** Set `false` to hide mock EVM + demo panel in dev. Set `true` to enable mock in production preview. */
  readonly VITE_ENABLE_DEMO_WALLETS?: string;
  /** Base URL of zk-stables-relayer (default http://127.0.0.1:8787). */
  readonly VITE_RELAYER_URL?: string;
  /** Mock underlying ERC-20 from `deploy-anvil.js` (`usdc` / `usdt`). */
  readonly VITE_DEMO_USDC_ADDRESS?: string;
  readonly VITE_DEMO_USDT_ADDRESS?: string;
  /** Wrapped bridge tokens (`wUSDC` / `wUSDT` from deploy) for balance display. */
  readonly VITE_DEMO_WUSDC_ADDRESS?: string;
  readonly VITE_DEMO_WUSDT_ADDRESS?: string;
  /**
   * Yaci Store Blockfrost-compatible base (e.g. `http://127.0.0.1:8080/api/v1`).
   * In dev, `/yaci-store` is proxied by Vite to avoid CORS — set to that path or full URL.
   */
  readonly VITE_YACI_STORE_URL?: string;
  /** Full native asset unit hex (policyId + assetName) for Cardano wUSDC balance via Yaci. */
  readonly VITE_CARDANO_WUSDC_UNIT?: string;
  readonly VITE_CARDANO_WUSDT_UNIT?: string;
  /** Decimals for native Cardano bridge token display (default 6). */
  readonly VITE_CARDANO_NATIVE_DECIMALS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** CIP-30 injected wallets (Eternl, Nami, Lace Cardano, etc.). */
interface Window {
  cardano?: Record<string, { enable?: () => Promise<unknown> }>;
}
