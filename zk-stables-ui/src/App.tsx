import React, { useEffect } from 'react';
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
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // eslint-disable-next-line no-console
    console.info('%cZK-Stables %cdeveloper UI', 'color:#58a6ff;font-weight:700', 'color:#8b949e');
  }, []);

  return (
    <Box sx={{ py: 4, minHeight: '100vh', bgcolor: 'background.default' }}>
      <Container maxWidth="md">
        <Stack spacing={3}>
          <Box id="app-intro" sx={{ maxWidth: '65ch' }}>
            <Typography variant="h4" component="h1" gutterBottom>
              ZK-Stables bridge
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 0 }}>
              Developer demo for a USDC/USDT bridge across <strong>Midnight</strong> (Compact), <strong>EVM</strong>, and{' '}
              <strong>Cardano</strong>, in the spirit of the{' '}
              <Link href="https://github.com/midnightntwrk/example-zkloan" target="_blank" rel="noreferrer">
                example-zkloan
              </Link>{' '}
              flow. <strong>1.</strong> Submit a lock or burn in <strong>Cross-chain intents</strong>.{' '}
              <strong>2.</strong> Connect wallets and deploy Midnight as needed. <strong>3.</strong> Use the{' '}
              <strong>Demo rundown</strong> at the bottom for spec-aligned background (lock → prove → mint; burn → prove →
              unlock).
            </Typography>
            <Typography variant="body2" color="warning.main" sx={{ mt: 1.5 }}>
              For production: do not paste operator or holder private keys in the browser — this UI is for local testing only.
            </Typography>
          </Box>
          <CrossChainIntentPanel />
          <DemoWalletsPanel />
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
          <FullDemoRundown />
        </Stack>
      </Container>
    </Box>
  );
};

export default App;
