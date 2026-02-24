import React from 'react';
import type { RelayerJobApi } from '../../lib/relayerClient.js';
import { buildTxLogEntries } from '../../lib/bridgeJobTxLog.js';
import { cn } from '../../utils/cn.js';
import { PhaseTimeline } from './PhaseTimeline.js';
import { TxLogLedger } from './TxLogLedger.js';

export const BridgeProgress: React.FC<{ job: RelayerJobApi | null }> = ({ job }) => {
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

      <p className="mt-4 font-mono text-[11px] leading-relaxed text-slate-500">
        <span className="text-slate-400">Job</span> {job.id}
        <span className="mx-1 text-slate-300">·</span>
        <span className="text-slate-400">ref</span> {job.lockRef}
      </p>

      <TxLogLedger entries={entries} className="mt-4" />

      {job.destinationHint ? (
        <details className="mt-4">
          <summary className="cursor-pointer select-none text-xs font-semibold text-slate-500 hover:text-slate-700">
            Raw destination hint
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{job.destinationHint}</p>
        </details>
      ) : null}
    </div>
  );
};
