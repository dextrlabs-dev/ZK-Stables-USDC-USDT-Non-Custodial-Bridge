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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** CIP-30 injected wallets (Eternl, Nami, Lace Cardano, etc.). */
interface Window {
  cardano?: Record<string, { enable?: () => Promise<unknown> }>;
}
