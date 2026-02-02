import React, { useCallback } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useConnect, useConnection, useDisconnect, useSwitchChain } from 'wagmi';
import { wagmiConfig } from '../config/wagmi.js';
import { demoWalletsEnabled } from '../demo/constants.js';

export const EvmWalletCard: React.FC = () => {
  const { address, chain, isConnected, status } = useConnection();
  const { disconnect } = useDisconnect();
  const { connectors, connect, isPending: isConnectPending, error: connectError } = useConnect();
  const mockConnector = connectors.find((c) => c.id === 'mock');
  const { switchChain, isPending: isSwitchPending } = useSwitchChain();

  const onConnect = useCallback(() => {
    const c = connectors[0];
    if (c) connect({ connector: c });
  }, [connect, connectors]);

  return (
    <Card id="panel-evm" variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Ethereum (EVM)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          SRS: lock and unlock on EVM use wallet signing against pool contracts. For a local **Foundry Anvil** node, run{' '}
          <code>./scripts/anvil-docker.sh</code> from the repo root (RPC <code>http://127.0.0.1:8545</code>, chain{' '}
          <strong>31337</strong>), then switch this wallet to <strong>Localhost</strong> and import a test key if needed.
        </Typography>
        {connectError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {connectError.message}
          </Alert>
        )}
        {isConnected && address && (
          <Typography variant="body2" sx={{ mb: 1 }}>
            <strong>{chain?.name ?? 'EVM'}</strong>
            {' · '}
            <Box component="code" sx={{ wordBreak: 'break-all' }}>
              {address}
            </Box>
          </Typography>
        )}
        {!isConnected && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Status: {status}
          </Typography>
        )}
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
          <Button variant="contained" disabled={isConnected || isConnectPending || !connectors[0]} onClick={onConnect}>
            {isConnectPending ? 'Connecting…' : 'Connect EVM wallet'}
          </Button>
          {demoWalletsEnabled() && mockConnector && (
            <Button
              variant="outlined"
              color="secondary"
              disabled={isConnected || isConnectPending}
              onClick={() => connect({ connector: mockConnector })}
            >
              Demo (mock Anvil)
            </Button>
          )}
          <Button variant="outlined" disabled={!isConnected} onClick={() => disconnect()}>
            Disconnect
          </Button>
        </Stack>
        {isConnected && (
          <TextField
            select
            size="small"
            label="Switch chain"
            value={chain?.id ?? ''}
            sx={{ minWidth: 200, mt: 1 }}
            disabled={isSwitchPending}
            onChange={(e) => {
              const id = Number(e.target.value);
              if (!Number.isNaN(id)) switchChain({ chainId: id });
            }}
          >
            {wagmiConfig.chains.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name} ({c.id})
              </MenuItem>
            ))}
          </TextField>
        )}
      </CardContent>
    </Card>
  );
};
