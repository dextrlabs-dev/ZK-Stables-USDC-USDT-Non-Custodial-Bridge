import React, { useEffect, useMemo } from 'react';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Accordion, AccordionDetails, AccordionSummary, Box, Container, Stack, Typography } from '@mui/material';
import pino from 'pino';
import { ZkStablesProvider } from './contexts/ZkStablesContext.js';
import { BridgeCard } from './components/BridgeCard/BridgeCard.js';
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
  const devMidnightLogger = useMemo(
    () => pino({ level: import.meta.env.DEV ? 'info' : 'silent' }),
    [],
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // eslint-disable-next-line no-console
    console.info('%cZK-Stables', 'color:#0f766e;font-weight:700');
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 pb-16 pt-10 font-sans antialiased text-slate-900 md:pb-24 md:pt-14">
      <Container maxWidth="sm" className="!px-4">
        <div className="mx-auto flex max-w-lg flex-col items-center gap-10">
          <header className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
              ZK-Stables
            </h1>
            <p className="mt-1 text-xs font-medium text-slate-400">Non-custodial USDC / USDT bridge</p>
          </header>

          <ZkStablesProvider logger={devMidnightLogger}>
            <BridgeCard />

            {import.meta.env.DEV && (
              <Accordion
                defaultExpanded
                disableGutters
                elevation={0}
                className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm !before:hidden"
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon className="text-slate-500" />} className="min-h-14 px-4 hover:bg-slate-50/80">
                  <div>
                    <Typography component="span" className="font-semibold text-slate-900">
                      Developer tools
                    </Typography>
                    <Typography variant="caption" component="span" className="ml-2 text-slate-500">
                      Deploy, wallets, raw intents, circuits
                    </Typography>
                  </div>
                </AccordionSummary>
                <AccordionDetails className="border-t border-slate-100 px-4 pb-6 pt-2">
                  <Stack spacing={3}>
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
                </AccordionDetails>
              </Accordion>
            )}
          </ZkStablesProvider>
        </div>
      </Container>
    </div>
  );
};

export default App;
