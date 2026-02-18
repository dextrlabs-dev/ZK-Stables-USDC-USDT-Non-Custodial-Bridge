import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useZkStables } from '../hooks/useZkStables.js';

const LACE_CHROME_STORE =
  'https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk';
const LACE_DOCS = 'https://docs.midnight.network/guides/lace-wallet';

function detectMidnightApi(): boolean {
  const midnight = (window as unknown as { midnight?: Record<string, unknown> }).midnight;
  if (!midnight || typeof midnight !== 'object') return false;
  return Object.keys(midnight).length > 0;
}

function formatUiError(e: unknown): string {
  if (e instanceof Error) return e.stack ?? e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e, Object.getOwnPropertyNames(e as object), 2);
  } catch {
    return String(e);
  }
}

export const LaceWalletCard: React.FC = () => {
  const {
    isConnected,
    isConnecting,
    connectorDisplayName,
    walletAddress,
    unshieldedAddress,
    connectLaceWallet,
    disconnectLaceWallet,
    connectDevSeedWallet,
  } = useZkStables();

  const [laceError, setLaceError] = useState<string | null>(null);
  const [extensionPresent, setExtensionPresent] = useState(detectMidnightApi);
  const [seedHex, setSeedHex] = useState(
    '0000000000000000000000000000000000000000000000000000000000000001',
  );

  useEffect(() => {
    const id = window.setInterval(() => setExtensionPresent(detectMidnightApi()), 750);
    return () => window.clearInterval(id);
  }, []);

  const net = import.meta.env.VITE_NETWORK_ID || 'undeployed';

  const onConnect = useCallback(async () => {
    setLaceError(null);
    try {
      await connectLaceWallet();
    } catch (e) {
      setLaceError(formatUiError(e));
    }
  }, [connectLaceWallet]);

  const onDisconnect = useCallback(() => {
    setLaceError(null);
    disconnectLaceWallet();
  }, [disconnectLaceWallet]);

  const onConnectSeed = useCallback(async () => {
    setLaceError(null);
    try {
      await connectDevSeedWallet(seedHex);
    } catch (e) {
      setLaceError(formatUiError(e));
    }
  }, [connectDevSeedWallet, seedHex]);

  return (
    <Card variant="outlined" sx={{ borderColor: isConnected ? 'primary.dark' : undefined }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
          <Typography variant="h6" component="h3">
            Midnight Lace
          </Typography>
          <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
            <Chip size="small" label={`dApp network: ${net}`} variant="outlined" />
            {isConnected && connectorDisplayName && (
              <Chip size="small" color="success" label={connectorDisplayName} variant="outlined" />
            )}
          </Stack>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Same connection pattern as{' '}
          <Link href="https://github.com/midnightntwrk/example-zkloan" target="_blank" rel="noreferrer">
            example-zkloan
          </Link>
          : this app talks to Lace through <code>window.midnight</code> and connects using your{' '}
          <code>VITE_NETWORK_ID</code>.
        </Typography>

        {!extensionPresent && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Midnight browser API not found. Install the Lace extension, allow this site, then refresh.{' '}
            <Link href={LACE_CHROME_STORE} target="_blank" rel="noreferrer">
              Chrome Web Store
            </Link>
            {' · '}
            <Link href={LACE_DOCS} target="_blank" rel="noreferrer">
              Docs
            </Link>
          </Alert>
        )}

        {laceError && (
          <Alert
            severity="error"
            sx={{ mb: 2, '& .MuiAlert-message': { width: '100%' } }}
            onClose={() => setLaceError(null)}
          >
            <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-line' }}>
              {laceError}
            </Typography>
          </Alert>
        )}

        {unshieldedAddress && (
          <Typography variant="body2" sx={{ mb: 2 }}>
            Unshielded address (derived from seed):{' '}
            <Box component="code" sx={{ wordBreak: 'break-all', display: 'block', mt: 0.5 }}>
              {unshieldedAddress}
            </Box>
          </Typography>
        )}

        {walletAddress && (
          <Typography variant="body2" sx={{ mb: 2 }}>
            Shielded (Zswap) address:{' '}
            <Box component="code" sx={{ wordBreak: 'break-all', display: 'block', mt: 0.5 }}>
              {walletAddress}
            </Box>
          </Typography>
        )}

        <Stack direction="row" flexWrap="wrap" gap={1}>
          <Button variant="contained" disabled={isConnecting || isConnected} onClick={() => void onConnect()}>
            {isConnecting ? 'Connecting…' : 'Connect Lace'}
          </Button>
          <Button variant="contained" color="secondary" disabled={isConnecting || isConnected} onClick={() => void onConnectSeed()}>
            Use dev seed instead of Lace
          </Button>
          <Button variant="outlined" color="inherit" disabled={!isConnected || isConnecting} onClick={onDisconnect}>
            Disconnect
          </Button>
        </Stack>

        {!isConnected && (
          <Box sx={{ mt: 2 }}>
            <TextField
              label="Dev seed (64 hex)"
              size="small"
              fullWidth
              value={seedHex}
              onChange={(e) => setSeedHex(e.target.value.trim().replace(/^0x/, ''))}
              helperText="Expects local Midnight stack (node, indexer, proof server). Not for production."
            />
          </Box>
        )}
      </CardContent>
    </Card>
  );
};
