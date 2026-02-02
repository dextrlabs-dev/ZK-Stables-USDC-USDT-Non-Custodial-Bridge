import React from 'react';
import { Box, Container, Link, Stack, Typography } from '@mui/material';
import { BridgeStatusCard } from './components/BridgeStatusCard.js';
import { CardanoWalletCard } from './components/CardanoWalletCard.js';
import { CircuitActions } from './components/CircuitActions.js';
import { CrossChainIntentPanel } from './components/CrossChainIntentPanel.js';
import { DemoWalletsPanel } from './components/DemoWalletsPanel.js';
import { DeployJoinPanel } from './components/DeployJoinPanel.js';
import { EvmWalletCard } from './components/EvmWalletCard.js';
import { FullDemoRundown } from './components/FullDemoRundown.js';
import { TxLog } from './components/TxLog.js';

const App: React.FC = () => {
  return (
    <Box sx={{ py: 4, minHeight: '100vh', bgcolor: 'background.default' }}>
      <Container maxWidth="md">
        <Stack spacing={3}>
          <Box id="app-intro">
            <Typography variant="h4" component="h1" gutterBottom>
              ZK-Stables bridge
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Midnight Compact demo (see{' '}
              <Link href="https://github.com/midnightntwrk/example-zkloan" target="_blank" rel="noreferrer">
                example-zkloan
              </Link>
              ) plus SRS-aligned <strong>EVM</strong> and <strong>Cardano</strong> connectors and relayer intents. The{' '}
              <strong>full demo rundown</strong> below follows the official SRS and system architecture blueprint (lock →
              prove → mint / burn → prove → unlock).
            </Typography>
            <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
              Demo only: pasting operator/holder secret keys in the browser is unsafe for production.
            </Typography>
          </Box>
          <FullDemoRundown />
          <DemoWalletsPanel />
          <CrossChainIntentPanel />
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'stretch' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <EvmWalletCard />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <CardanoWalletCard />
            </Box>
          </Stack>
          <DeployJoinPanel />
          <BridgeStatusCard />
          <CircuitActions />
          <TxLog />
        </Stack>
      </Container>
    </Box>
  );
};

export default App;
