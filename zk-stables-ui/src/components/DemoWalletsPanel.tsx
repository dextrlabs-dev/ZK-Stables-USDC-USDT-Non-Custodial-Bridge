import React, { useCallback, useMemo } from 'react';
import {
  Alert,
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
import { hardhat } from 'viem/chains';
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
    if (mockConnector) connect({ connector: mockConnector, chainId: hardhat.id });
    applyDemoCardano();
  }, [applyDemoCardano, connect, mockConnector]);

  const clearDemos = useCallback(() => {
    disconnect();
    disconnectCardano();
  }, [disconnect, disconnectCardano]);

  if (!enabled) return null;

  return (
    <Card id="panel-demo-wallets" variant="outlined" sx={{ borderColor: 'divider' }}>
      <CardContent>
        <Typography variant="h6" component="h3" gutterBottom>
          Quick test identities
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          One-click load of <strong>EVM</strong> test accounts (wagmi <code>mock</code> connector — public Anvil/Hardhat keys)
          and a fake <strong>Cardano</strong> row for UI testing. <strong>Midnight</strong> still needs Lace or dev seed; the
          table shows a sample shielded address for local scripts when Lace is not connected.
        </Typography>
        <Alert severity="warning" sx={{ mb: 2 }}>
          These EVM keys are public — never use them for real money or mainnet.
        </Alert>
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
          <Button variant="contained" color="primary" disabled={evmBusy || !mockConnector} onClick={loadAllDemos}>
            Load EVM + Cardano test rows
          </Button>
          <Button
            variant="outlined"
            disabled={evmBusy}
            onClick={() => mockConnector && connect({ connector: mockConnector, chainId: hardhat.id })}
          >
            EVM test accounts only
          </Button>
          <Button variant="outlined" onClick={applyDemoCardano}>
            Cardano synthetic row only
          </Button>
          <Button variant="outlined" color="inherit" onClick={clearDemos}>
            Clear EVM and Cardano test rows
          </Button>
          {isConnected && (
            <Button variant="text" size="small" onClick={() => switchChain({ chainId: hardhat.id })}>
              Point EVM wallet at Hardhat local (31337, 8545)
            </Button>
          )}
        </Stack>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Chain</TableCell>
              <TableCell>Mode</TableCell>
              <TableCell>Address or placeholder</TableCell>
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
                  <Typography variant="dataMono" sx={{ wordBreak: 'break-all' }}>
                    {address}
                  </Typography>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Not connected — use the buttons above or the Ethereum card
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
                {isDemoCardano ? 'Synthetic' : cardanoWalletKey ? `Wallet: ${cardanoWalletKey}` : '—'}
              </TableCell>
              <TableCell>
                {cardanoWalletKey ? (
                  <>
                    {cardanoBech32Preview && (
                      <Typography variant="dataMono" sx={{ wordBreak: 'break-all' }}>
                        {cardanoBech32Preview}
                      </Typography>
                    )}
                    <Typography variant="dataMonoDense" sx={{ wordBreak: 'break-all', display: 'block', mt: 0.5 }}>
                      {cardanoUsedAddressesHex[0] ?? cardanoDisplay}
                    </Typography>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Load a synthetic row or connect a real wallet in the Cardano card
                  </Typography>
                )}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Midnight</TableCell>
              <TableCell>{laceOk ? connectorDisplayName ?? 'Lace' : 'Not connected — use Midnight Lace card'}</TableCell>
              <TableCell>
                {laceAddr ? (
                  <Typography variant="dataMono" sx={{ wordBreak: 'break-all' }}>
                    {laceAddr}
                  </Typography>
                ) : (
                  <>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                      Sample shielded address (undeployed network) for local funding scripts:
                    </Typography>
                    <Typography variant="dataMonoDense" sx={{ wordBreak: 'break-all' }}>
                      {DEMO_MIDNIGHT_SHIELDED}
                    </Typography>
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
