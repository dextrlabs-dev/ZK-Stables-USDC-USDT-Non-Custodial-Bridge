import React from 'react';
import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as pino from 'pino';
import App from './App.js';
import { ZkStablesProvider } from './contexts/ZkStablesContext.js';
import '@midnight-ntwrk/dapp-connector-api';

/**
 * Lazy-loaded entry so the initial bootstrap chunk stays small (React + MUI shell + wagmi only).
 * Heavy Midnight deps (ledger WASM, compiled contract, wallet facade) live in this chunk.
 */
export default function MainApp(): React.ReactElement {
  const networkId = (import.meta.env.VITE_NETWORK_ID || 'undeployed') as NetworkId;
  setNetworkId(networkId);

  const logger = pino.pino({
    level: (import.meta.env.VITE_LOGGING_LEVEL as string) || 'info',
    browser: { asObject: true },
  });

  return (
    <ZkStablesProvider logger={logger}>
      <App />
    </ZkStablesProvider>
  );
}
