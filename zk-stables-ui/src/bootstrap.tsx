import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline, Box, CircularProgress, Typography } from '@mui/material';
import { theme } from './config/theme.js';
import { CrossChainWalletProvider } from './contexts/CrossChainWalletContext.js';
import { EvmWagmiProvider } from './providers/EvmWagmiProvider.js';

const MainApp = lazy(() => import('./MainApp.js'));

function MidnightLazyFallback(): React.ReactElement {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '50vh',
        gap: 2,
        py: 6,
        color: 'text.secondary',
      }}
    >
      <CircularProgress size={36} />
      <Typography variant="body2" align="center">
        Loading Midnight SDK (WASM + contract)…
      </Typography>
    </Box>
  );
}

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
