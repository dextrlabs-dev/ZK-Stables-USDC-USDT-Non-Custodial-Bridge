import React, { useEffect } from 'react';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Accordion, AccordionDetails, AccordionSummary, Box, Container, Link, Stack, Typography } from '@mui/material';
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

/** Logger for Midnight (bridge card ledger + developer tools). */
const devMidnightLogger = pino({ level: import.meta.env.DEV ? 'info' : 'silent' });

const App: React.FC = () => {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // eslint-disable-next-line no-console
    console.info('%cZK-Stables', 'color:#0f766e;font-weight:700');
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 pb-16 pt-10 font-sans antialiased text-slate-900 md:pb-24 md:pt-14">
      <Container maxWidth="sm" className="!px-4">
        <div className="mx-auto flex max-w-lg flex-col items-center gap-10">
          <header className="max-w-md text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Cross-chain</p>
            <h1 className="mt-2 text-balance text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
              Bridge stablecoins without giving up custody
            </h1>
            <p className="mt-3 text-pretty text-sm leading-relaxed text-slate-600">
              Move <span className="font-medium text-slate-800">USDC</span> and <span className="font-medium text-slate-800">USDT</span>{' '}
              between <span className="font-medium text-slate-800">EVM</span>, <span className="font-medium text-slate-800">Cardano</span>, and{' '}
              <span className="font-medium text-slate-800">Midnight</span>. Built on the{' '}
              <Link href="https://github.com/midnightntwrk/example-zkloan" target="_blank" rel="noreferrer" className="font-medium text-teal-800 underline-offset-2 hover:underline">
                zkloan-style
              </Link>{' '}
              flow and <strong>zk-stables-relayer</strong>.
            </p>
            <p className="mt-4 text-xs leading-relaxed text-amber-800/90">
              Local demo — do not use operator keys or demo mnemonics with real funds.
            </p>
          </header>

          <ZkStablesProvider logger={devMidnightLogger}>
            <BridgeCard />

            <Accordion
              defaultExpanded={import.meta.env.DEV}
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
          </ZkStablesProvider>
        </div>
      </Container>
    </div>
  );
};

export default App;
