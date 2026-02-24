import React from 'react';
import ReactDOM from 'react-dom/client';
import './tailwind.css';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { theme } from './config/theme.js';
import { CrossChainWalletProvider } from './contexts/CrossChainWalletContext.js';
import { EvmWagmiProvider } from './providers/EvmWagmiProvider.js';
import App from './App.js';

export function mount(): void {
  const el = document.getElementById('root');
  if (!el) return;

  el.textContent = '';
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <EvmWagmiProvider>
          <CrossChainWalletProvider>
            <App />
          </CrossChainWalletProvider>
        </EvmWagmiProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
}
