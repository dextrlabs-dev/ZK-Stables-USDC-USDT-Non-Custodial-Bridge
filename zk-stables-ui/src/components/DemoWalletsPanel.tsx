import React, { useCallback, useMemo } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useConnect, useConnection, useDisconnect, useSwitchChain } from 'wagmi';
import { localhost } from 'viem/chains';
import { useCrossChainWallets } from '../contexts/CrossChainWalletContext.js';
import { useZkStables } from '../hooks/useZkStables.js';
import {
  ANVIL_DEMO_ACCOUNTS,
  DEMO_MIDNIGHT_SHIELDED,
  demoWalletsEnabled,
} from '../demo/constants.js';

/** One-click test identities: EVM mock (Anvil keys) + Cardano demo overlay; Midnight still uses Lace. */
export const DemoWalletsPanel: React.FC = () => {
  const enabled = demoWalletsEnabled();
  const { address, chain, isConnected, status, connector } = useConnection();
  const { connectors, connect, isPending: evmBusy } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const {
    applyDemoCardano,
    disconnectCardano,
    cardanoWalletKey,
    cardanoBech32Preview,
    cardanoDisplay,
    isDemoCardano,
    cardanoUsedAddressesHex,
  } = useCrossChainWallets();
  const { isConnected: laceOk, walletAddress: laceAddr, connectorDisplayName } = useZkStables();

  const mockConnector = useMemo(() => connectors.find((c) => c.id === 'mock'), [connectors]);

  const loadAllDemos = useCallback(() => {
    if (mockConnector) connect({ connector: mockConnector });
    applyDemoCardano();
  }, [applyDemoCardano, connect, mockConnector]);

  const clearDemos = useCallback(() => {
    disconnect();
    disconnectCardano();
  }, [disconnect, disconnectCardano]);

  if (!enabled) return null;

  return (
    <Card id="panel-demo-wallets" variant="outlined" sx={{ borderColor: 'secondary.dark' }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Test wallet demo (all chains)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Loads <strong>EVM</strong> via wagmi <code>mock</code> connector (Hardhat/Anvil public keys — dev only) and a
          synthetic <strong>Cardano</strong> row for UI. <strong>Midnight</strong> still requires real Lace; example
          shielded address is shown for copy/paste and local funding scripts.
        </Typography>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Demo EVM keys are well-known; never hold real funds on those accounts.
        </Alert>
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
          <Button variant="contained" color="secondary" disabled={evmBusy || !mockConnector} onClick={loadAllDemos}>
            Load EVM mock + Cardano demo
          </Button>
          <Button variant="outlined" disabled={evmBusy} onClick={() => mockConnector && connect({ connector: mockConnector })}>
            EVM mock only
          </Button>
          <Button variant="outlined" onClick={applyDemoCardano}>
            Cardano demo only
          </Button>
          <Button variant="outlined" color="inherit" onClick={clearDemos}>
            Clear demo EVM + Cardano
          </Button>
          {isConnected && (
            <Button variant="text" size="small" onClick={() => switchChain({ chainId: localhost.id })}>
              Switch EVM to Localhost 8545
            </Button>
          )}
        </Stack>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Chain</TableCell>
              <TableCell>Mode</TableCell>
              <TableCell>Address / hint</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>Ethereum (EVM)</TableCell>
              <TableCell>
                {!isConnected
                  ? status
                  : connector?.id === 'mock'
                    ? 'Mock (Anvil keys)'
                    : connector?.name ?? 'Injected'}
              </TableCell>
              <TableCell>
                {address ? (
                  <Box component="code" sx={{ wordBreak: 'break-all', fontSize: 12 }}>
                    {address}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Not connected — use buttons above or EVM card
                  </Typography>
                )}
                {isConnected && chain && (
                  <Typography variant="caption" display="block" color="text.secondary">
                    Chain: {chain.name} ({chain.id})
                  </Typography>
                )}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Cardano</TableCell>
              <TableCell>
                {isDemoCardano ? 'Demo (no extension)' : cardanoWalletKey ? `CIP-30: ${cardanoWalletKey}` : '—'}
              </TableCell>
              <TableCell>
                {cardanoWalletKey ? (
                  <>
                    {cardanoBech32Preview && (
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {cardanoBech32Preview}
                      </Typography>
                    )}
                    <Box component="code" sx={{ wordBreak: 'break-all', fontSize: 11, display: 'block' }}>
                      {cardanoUsedAddressesHex[0] ?? cardanoDisplay}
                    </Box>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Load demo or use Cardano card with Eternl / Nami / …
                  </Typography>
                )}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Midnight</TableCell>
              <TableCell>{laceOk ? connectorDisplayName ?? 'Lace' : 'Connect in Lace card'}</TableCell>
              <TableCell>
                {laceAddr ? (
                  <Box component="code" sx={{ wordBreak: 'break-all', fontSize: 12 }}>
                    {laceAddr}
                  </Box>
                ) : (
                  <>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                      Example shielded (undeployed) for local funding tests:
                    </Typography>
                    <Box component="code" sx={{ wordBreak: 'break-all', fontSize: 11 }}>
                      {DEMO_MIDNIGHT_SHIELDED}
                    </Box>
                  </>
                )}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          Anvil #0: {ANVIL_DEMO_ACCOUNTS[0]} · #1: {ANVIL_DEMO_ACCOUNTS[1]}
        </Typography>
      </CardContent>
    </Card>
  );
};
