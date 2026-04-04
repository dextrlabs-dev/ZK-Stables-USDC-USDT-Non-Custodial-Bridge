import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RelayerBar } from './components/RelayerBar';
import { ChainStatusBar } from './components/AccountsSection';
import { BridgeSection } from './components/BridgeSection';
import { JobTracker } from './components/JobTracker';
import { AccountsPanel } from './components/AccountsPanel';
import { Explorer } from './components/Explorer';
import { fetchBridgeConsoleState, fetchHealth } from './api/relayerClient';

export default function App() {
  const [page, setPage] = useState<'console' | 'explorer'>('console');
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth });
  const consoleState = useQuery({
    queryKey: ['bridge-console'],
    queryFn: fetchBridgeConsoleState,
    refetchInterval: 12_000,
  });

  return (
    <div className="ab-page">
      <header className="ab-header">
        <div className="ab-brand">
          <span className="ab-brand-mark">ZK-Stables</span>
          <span className="ab-brand-tag">Operator bridge</span>
        </div>
        <div className="ab-header-actions">
          <ChainStatusBar
            health={health.data}
            healthLoading={health.isLoading}
            healthError={health.error as Error | null}
          />
          <button
            className={`ab-status-item ex-nav-btn ${page === 'explorer' ? 'ex-nav-btn--active' : ''}`}
            onClick={() => setPage(page === 'explorer' ? 'console' : 'explorer')}
            type="button"
          >
            Explorer
          </button>
          <RelayerBar />
        </div>
      </header>

      <main className="ab-main">
        <div className="ab-main-scroll">
          {page === 'explorer' ? (
            <Explorer onBack={() => setPage('console')} />
          ) : (
            <>
              <AccountsPanel />
              <JobTracker />
              <BridgeSection consoleState={consoleState.data} />
              {consoleState.error ? (
                <p className="ab-err ab-err--inline">{(consoleState.error as Error).message}</p>
              ) : null}
            </>
          )}
        </div>
      </main>

      <footer className="ab-footer">
        <span>Run alongside zk-stables-relayer · CORS open in dev</span>
      </footer>
    </div>
  );
}
