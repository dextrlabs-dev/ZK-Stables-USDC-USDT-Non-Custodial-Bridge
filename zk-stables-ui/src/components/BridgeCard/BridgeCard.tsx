import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  defaultRelayerBaseUrl,
  fetchChainHealth,
  fetchDemoWallets,
  listRelayerJobs,
  type DemoWalletsResponse,
  type RelayerHealthChains,
  type RelayerJobApi,
} from '../../lib/relayerClient.js';
import { buildLocalDemoFallback } from '../../lib/bridgeDemoFallback.js';
import { cn } from '../../utils/cn.js';
import { BridgeForm } from './BridgeForm.js';
import { BridgeProgress } from './BridgeProgress.js';
import { BridgedBalancesBar } from './BridgedBalancesBar.js';
import { buildTxLogEntries } from '../../lib/bridgeJobTxLog.js';
import { parseEvmPayoutSkippedReason } from '../../lib/relayerTxParsing.js';
import { PhaseTimeline } from './PhaseTimeline.js';
import { TxLogLedger } from './TxLogLedger.js';

export const BridgeCard: React.FC = () => {
  const relayerUrl = useMemo(() => defaultRelayerBaseUrl(), []);
  const [demoFromServer, setDemoFromServer] = useState<DemoWalletsResponse | null>(null);
  const [mainTab, setMainTab] = useState(0);
  const [activeJob, setActiveJob] = useState<RelayerJobApi | null>(null);
  const [history, setHistory] = useState<RelayerJobApi[]>([]);
  const [chains, setChains] = useState<RelayerHealthChains | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const d = await fetchDemoWallets(relayerUrl);
      if (!cancelled) setDemoFromServer(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [relayerUrl]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const c = await fetchChainHealth(relayerUrl);
      if (!cancelled) setChains(c);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [relayerUrl]);

  const demo = demoFromServer ?? buildLocalDemoFallback();

  const refreshHistory = useCallback(async () => {
    const jobs = await listRelayerJobs(relayerUrl);
    setHistory(Array.isArray(jobs) ? jobs.slice(0, 25) : []);
  }, [relayerUrl]);

  useEffect(() => {
    if (mainTab === 1) void refreshHistory();
  }, [mainTab, refreshHistory]);

  const chainPills = useMemo(() => {
    const evmOk = chains?.evm?.ok ?? false;
    const midnightOk = chains?.midnightIndexer?.ok ?? false;
    const cardanoOk = chains?.cardano?.ok ?? false;
    const cardanoSkipped = chains?.cardano?.skipped ?? false;
    const enabled = chains?.relayerBridge ?? {};
    const items: { k: string; label: string; ok: boolean; muted?: boolean }[] = [
      { k: 'evm', label: 'EVM', ok: evmOk && (enabled.evm ?? true) },
      { k: 'midnight', label: 'Midnight', ok: midnightOk && (enabled.midnight ?? true) },
      { k: 'cardano', label: 'Cardano', ok: !cardanoSkipped && cardanoOk && (enabled.cardano ?? true), muted: cardanoSkipped },
    ];
    return items;
  }, [chains]);

  return (
    <div className="w-full max-w-[min(100%,30rem)] rounded-3xl border border-slate-200/80 bg-white p-6 shadow-bridge ring-1 ring-slate-100/90 md:p-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {chainPills.map((p) => (
            <span
              key={p.k}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                p.muted && 'border-slate-200 text-slate-300',
                !p.muted && p.ok && 'border-emerald-200/90 bg-emerald-50 text-emerald-900',
                !p.muted && !p.ok && 'border-amber-200/90 bg-amber-50 text-amber-950',
              )}
              title={p.muted ? 'Skipped' : p.ok ? 'Healthy' : 'Not ready'}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  p.k === 'evm' && 'bg-indigo-500',
                  p.k === 'cardano' && 'bg-sky-600',
                  p.k === 'midnight' && 'bg-violet-600',
                  p.muted && 'bg-slate-300',
                )}
                aria-hidden
              />
              {p.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mb-6 flex rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/60">
        <button
          type="button"
          onClick={() => setMainTab(0)}
          className={cn(
            'flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35',
            mainTab === 0 ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          Bridge
        </button>
        <button
          type="button"
          onClick={() => setMainTab(1)}
          className={cn(
            'flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35',
            mainTab === 1 ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          History
        </button>
      </div>

      {mainTab === 0 && (
        <>
          <BridgedBalancesBar demo={demo} />
          <BridgeForm demo={demo} relayerUrl={relayerUrl} onJobUpdate={setActiveJob} />
          <BridgeProgress job={activeJob} />
        </>
      )}

      {mainTab === 1 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Recent jobs</h3>
            <button
              type="button"
              aria-label="Refresh history"
              onClick={() => void refreshHistory()}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
            </button>
          </div>
          {history.length === 0 ? <p className="text-sm text-slate-500">No jobs yet.</p> : null}
          <ul className="divide-y divide-slate-100">
            {history.map((j) => {
              const logEntries = buildTxLogEntries(j);
              const evmPayoutSkippedReason = parseEvmPayoutSkippedReason(j.destinationHint);
              
              return (
                <li key={j.id} className="py-3 first:pt-0">
                  <details className="group">
                    <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-600">
                            {j.ui?.phaseLabel ?? j.phase} · {j.intent.operation} · {j.intent.sourceChain}→{j.intent.destinationChain ?? '—'}
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] font-medium text-slate-800">{j.id}</p>
                          <p className="text-xs text-slate-500">
                            {j.intent.asset} {j.intent.amount}
                          </p>
                          
                          {j.error != null && String(j.error).length > 0 ? (
                            <p className="mt-1 text-[11px] text-red-600">
                              {String(j.error).slice(0, 120)}
                              {String(j.error).length > 120 ? '…' : ''}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className="mt-0.5 shrink-0 text-slate-300 transition-transform group-open:rotate-90"
                          aria-hidden
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                        </span>
                      </div>
                    </summary>
                    <div className="mt-4 space-y-4 border-l-2 border-teal-200/80 pl-3">
                      <PhaseTimeline job={j} />
                      {evmPayoutSkippedReason ? (
                        <p className="text-[11px] text-amber-900">{evmPayoutSkippedReason}</p>
                      ) : null}
                      <TxLogLedger entries={logEntries} />
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
