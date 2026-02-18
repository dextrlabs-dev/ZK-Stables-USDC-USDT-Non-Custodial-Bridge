import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { theme } from './config/theme.js';
import { CrossChainWalletProvider } from './contexts/CrossChainWalletContext.js';
import { EvmWagmiProvider } from './providers/EvmWagmiProvider.js';
import { MidnightLazyFallback } from './components/MidnightLazyFallback.js';

const MainApp = lazy(() => import('./MainApp.js'));

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
            <Suspense fallback={<MidnightLazyFallback />}>
              <MainApp />
            </Suspense>
          </CrossChainWalletProvider>
        </EvmWagmiProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
}
