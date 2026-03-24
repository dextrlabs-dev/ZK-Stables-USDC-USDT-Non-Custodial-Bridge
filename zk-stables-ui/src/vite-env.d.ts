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
  /** Bridge-minted zk stables (`zkUSDC` / `zkUSDT` on-chain; env keys still VITE_DEMO_WUSDC_* from deploy JSON). */
  readonly VITE_DEMO_WUSDC_ADDRESS?: string;
  readonly VITE_DEMO_WUSDT_ADDRESS?: string;
  /**
   * Yaci Store Blockfrost-compatible base (e.g. `http://127.0.0.1:8080/api/v1`).
   * In dev, `/yaci-store` is proxied by Vite to avoid CORS — set to that path or full URL.
   */
  readonly VITE_YACI_STORE_URL?: string;
  /** Yaci Blockfrost-compatible API base for Mesh submit/query (defaults from `VITE_YACI_STORE_URL` when unset). */
  readonly VITE_YACI_URL?: string;
  readonly VITE_YACI_ADMIN_URL?: string;
  /** `0` testnet / `1` mainnet — align with `RELAYER_CARDANO_NETWORK_ID`. */
  readonly VITE_CARDANO_NETWORK_ID?: string;
  /**
   * Same phrase as `RELAYER_CARDANO_WALLET_MNEMONIC` — in-app Mesh signing (auto-selected on load). Inlined into the bundle.
   */
  readonly VITE_DEMO_CARDANO_WALLET_MNEMONIC?: string;
  /** Full native asset unit hex (policyId + assetName) for Cardano wUSDC balance via Yaci. */
  readonly VITE_CARDANO_WUSDC_UNIT?: string;
  readonly VITE_CARDANO_WUSDT_UNIT?: string;
  /** Decimals for native Cardano bridge token display (default 6). */
  readonly VITE_CARDANO_NATIVE_DECIMALS?: string;
  /** 64 hex chars; default 64×0 for browser lock datum `recipient_commitment`. */
  readonly VITE_CARDANO_LOCK_RECIPIENT_COMMITMENT_HEX?: string;
  /** ZK deposit encoding: Cardano source chain id (align with RELAYER_ZK_SOURCE_CHAIN_ID). */
  readonly VITE_ZK_SOURCE_CHAIN_ID?: string;
  /** ZK deposit encoding: EVM destination chain id (align with RELAYER_ZK_DEST_CHAIN_ID). */
  readonly VITE_ZK_DEST_CHAIN_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Optional `window.cardano` shape (unused by this UI; Cardano signing is mnemonic Mesh only). */
interface Window {
  cardano?: Record<string, { enable?: () => Promise<unknown> }>;
}

declare module 'process/browser' {
  const process: NodeJS.Process;
  export default process;
}
