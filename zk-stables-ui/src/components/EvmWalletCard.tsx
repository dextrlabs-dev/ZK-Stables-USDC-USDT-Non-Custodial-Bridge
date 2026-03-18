import React, { useCallback, useEffect } from 'react';
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
import { hardhat } from 'viem/chains';
import { wagmiConfig } from '../config/wagmi.js';
import { demoWalletsEnabled } from '../demo/constants.js';

export const EvmWalletCard: React.FC = () => {
  const { address, chain, connector, isConnected, status } = useConnection();
  const { disconnect } = useDisconnect();
  const { connectors, connect, isPending: isConnectPending, error: connectError } = useConnect();
  const mockConnector = connectors.find((c) => c.id === 'mock');
  const { switchChain, isPending: isSwitchPending } = useSwitchChain();

  const onConnect = useCallback(() => {
    const c = connectors[0];
    if (c) connect({ connector: c });
  }, [connect, connectors]);

  useEffect(() => {
    if (connector?.id !== 'mock' || chain?.id === hardhat.id) return;
    switchChain({ chainId: hardhat.id });
  }, [chain?.id, connector?.id, switchChain]);

  return (
    <Card id="panel-evm" variant="outlined">
      <CardContent>
        <Typography variant="h6" component="h3" gutterBottom>
          Ethereum (EVM)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Connect a browser wallet to sign EVM lock and unlock transactions against pool contracts. For local dev, run{' '}
          <code>./scripts/anvil-docker.sh</code> (RPC <code>http://127.0.0.1:8545</code>, chain id <strong>31337</strong>),
          then in this UI switch to <strong>Hardhat</strong> (chain 31337) and use a test account.
        </Typography>
        {connectError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Could not connect the wallet. {connectError.message}
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
            Wallet status: {status}
          </Typography>
        )}
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
          <Button variant="contained" disabled={isConnected || isConnectPending || !connectors[0]} onClick={onConnect}>
            {isConnectPending ? 'Connecting…' : 'Connect wallet'}
          </Button>
          {demoWalletsEnabled() && mockConnector && (
            <Button
              variant="outlined"
              color="secondary"
              disabled={isConnected || isConnectPending}
              onClick={() => connect({ connector: mockConnector, chainId: hardhat.id })}
            >
              Use Anvil demo account
            </Button>
          )}
          <Button variant="outlined" disabled={!isConnected} onClick={() => disconnect()}>
            Disconnect
          </Button>
        </Stack>
        {isConnected && connector?.id === 'mock' && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            Anvil demo mode signs via your local RPC only — stay on <strong>Hardhat (31337)</strong>. Use MetaMask for Sepolia.
          </Typography>
        )}
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
            {(connector?.id === 'mock'
              ? wagmiConfig.chains.filter((c) => c.id === hardhat.id)
              : wagmiConfig.chains
            ).map((c) => (
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
