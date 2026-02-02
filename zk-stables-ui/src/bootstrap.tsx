import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as pino from 'pino';
import App from './App.js';
import { theme } from './config/theme.js';
import { CrossChainWalletProvider, ZkStablesProvider } from './contexts/index.js';
import { EvmWagmiProvider } from './providers/EvmWagmiProvider.js';
import '@midnight-ntwrk/dapp-connector-api';

export function mount(): void {
  const el = document.getElementById('root');
  if (!el) return;

  const networkId = (import.meta.env.VITE_NETWORK_ID || 'undeployed') as NetworkId;
  setNetworkId(networkId);

  const logger = pino.pino({
    level: (import.meta.env.VITE_LOGGING_LEVEL as string) || 'info',
    browser: { asObject: true },
  });

  el.textContent = '';
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <EvmWagmiProvider>
          <CrossChainWalletProvider>
            <ZkStablesProvider logger={logger}>
              <App />
            </ZkStablesProvider>
          </CrossChainWalletProvider>
        </EvmWagmiProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
}
