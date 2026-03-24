import React, { useMemo } from 'react';
import { useChainId } from 'wagmi';
import type { RelayerJobApi } from '../../lib/relayerClient.js';
import { buildTxLogEntries } from '../../lib/bridgeJobTxLog.js';
import { parseDestinationHintTxs, parseEvmPayoutSkippedReason } from '../../lib/relayerTxParsing.js';
import { evmTxExplorerUrl } from '../../utils/evmExplorerLinks.js';
import { cn } from '../../utils/cn.js';
import { PhaseTimeline } from './PhaseTimeline.js';
import { TxLogLedger } from './TxLogLedger.js';

function looksLikeEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/u.test(s.trim());
}

export const BridgeProgress: React.FC<{ job: RelayerJobApi | null }> = ({ job }) => {
  const chainId = useChainId();

  const crossChainBurnToEvm = useMemo(() => {
    if (!job || job.intent.operation !== 'BURN') return false;
    const sc = job.intent.sourceChain;
    return (sc === 'cardano' || sc === 'midnight') && looksLikeEvmAddress(job.intent.recipient);
  }, [job]);

  const parsedHint = useMemo(() => parseDestinationHintTxs(job?.destinationHint), [job?.destinationHint]);
  const evmUnderlyingTx = parsedHint.evm?.operatorUnlockTx ?? parsedHint.evm?.unlockTx;
  const evmTxUrl = evmUnderlyingTx ? evmTxExplorerUrl(chainId, evmUnderlyingTx) : null;
  const evmPayoutSkippedReason = useMemo(
    () => parseEvmPayoutSkippedReason(job?.destinationHint),
    [job?.destinationHint],
  );

  if (!job) return null;

  const failed = job.phase === 'failed';
  const done = job.phase === 'completed';
  const ui = job.ui;
  const pct =
    ui && ui.phaseIndex >= 0 && ui.phaseCount > 0
      ? Math.min(100, Math.round(((ui.phaseIndex + (done ? 1 : 0.35)) / ui.phaseCount) * 100))
      : failed
        ? 100
        : 12;

  const entries = buildTxLogEntries(job);

  return (
    <div className="mt-6 border-t border-slate-100 pt-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Relayer</span>
        <span className="text-[10px] font-medium text-slate-400">Progress</span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-300 ease-out',
            failed && 'bg-red-500',
            done && !failed && 'bg-emerald-600',
            !done && !failed && 'bg-teal-600',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <PhaseTimeline job={job} className="mt-6" />

      {crossChainBurnToEvm && evmUnderlyingTx ? (
        <div className="mt-4 rounded-xl border border-emerald-200/90 bg-emerald-50/70 px-3 py-2.5 text-[11px] text-emerald-950">
          <p className="font-semibold text-emerald-900">EVM payout ({job.intent.asset})</p>
          <p className="mt-1 break-all font-mono text-[10px] text-emerald-900/85">{evmUnderlyingTx}</p>
          {evmTxUrl ? (
            <a
              href={evmTxUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-block font-semibold text-emerald-800 underline decoration-emerald-400/80 underline-offset-2 hover:text-emerald-950"
            >
              View on explorer
            </a>
          ) : null}
        </div>
      ) : crossChainBurnToEvm && (done || failed) && evmPayoutSkippedReason ? (
        <p className="mt-4 text-[11px] text-amber-900">{evmPayoutSkippedReason}</p>
      ) : null}

      <p className="mt-4 font-mono text-[11px] leading-relaxed text-slate-500">
        <span className="text-slate-400">Job</span> {job.id}
        <span className="mx-1 text-slate-300">·</span>
        <span className="text-slate-400">ref</span> {job.lockRef}
      </p>

      <TxLogLedger entries={entries} className="mt-4" />
    </div>
  );
};
