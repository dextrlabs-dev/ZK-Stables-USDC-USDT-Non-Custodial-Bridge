import React, { Fragment } from 'react';
import type { RelayerJobApi } from '../../lib/relayerClient.js';
import { cn } from '../../utils/cn.js';

const STEPS: { key: string; label: string; short: string }[] = [
  { key: 'received', label: 'Queued', short: '1' },
  { key: 'awaiting_finality', label: 'Finality', short: '2' },
  { key: 'proving', label: 'Proof', short: '3' },
  { key: 'destination_handoff', label: 'Handoff', short: '4' },
  { key: 'completed', label: 'Done', short: '5' },
];

function stepVisualState(job: RelayerJobApi, stepIndex: number): 'done' | 'active' | 'pending' | 'fail' {
  const failed = job.phase === 'failed';
  const done = job.phase === 'completed';
  const idx = job.ui?.phaseIndex ?? 0;

  if (failed) {
    if (idx >= 0 && stepIndex < idx) return 'done';
    if (idx >= 0 && stepIndex === idx) return 'fail';
    return 'pending';
  }
  if (done) return 'done';
  if (idx > stepIndex) return 'done';
  if (idx === stepIndex) return 'active';
  return 'pending';
}

export const PhaseTimeline: React.FC<{ job: RelayerJobApi; className?: string }> = ({ job, className }) => {
  const failed = job.phase === 'failed';
  const label = job.ui?.phaseLabel ?? job.phase;

  return (
    <div className={cn('relative', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Pipeline</span>
        <span
          className={cn(
            'max-w-[55%] truncate text-right text-xs font-semibold',
            failed && 'text-red-700',
            job.phase === 'completed' && 'text-emerald-800',
            !failed && job.phase !== 'completed' && 'text-teal-900',
          )}
          title={label}
        >
          {label}
        </span>
      </div>

      <div className="flex w-full items-start">
        {STEPS.map((s, i) => {
          const st = stepVisualState(job, i);
          const prevSt = i > 0 ? stepVisualState(job, i - 1) : null;
          return (
            <Fragment key={s.key}>
              {i > 0 ? (
                <div
                  className={cn(
                    'mt-[13px] h-[2px] min-w-[2px] flex-1',
                    prevSt === 'done' && 'bg-teal-400/80',
                    prevSt === 'fail' && 'bg-red-300/80',
                    prevSt !== 'done' && prevSt !== 'fail' && 'bg-slate-200',
                  )}
                  aria-hidden
                />
              ) : null}
              <div className="flex min-w-0 flex-col items-center">
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-colors',
                    st === 'done' && 'border-teal-600 bg-teal-600 text-white',
                    st === 'active' && 'border-teal-500 bg-white text-teal-800 shadow-[0_0_0_3px_rgba(20,184,166,0.22)]',
                    st === 'pending' && 'border-slate-200 bg-white text-slate-400',
                    st === 'fail' && 'border-red-500 bg-red-50 text-red-700',
                  )}
                  title={s.label}
                >
                  {st === 'done' ? (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : st === 'fail' ? (
                    <span aria-hidden>!</span>
                  ) : (
                    s.short
                  )}
                </div>
                <p className="mt-1.5 max-w-[4.5rem] text-center text-[8px] font-semibold leading-tight text-slate-600 min-[380px]:text-[9px]">{s.label}</p>
              </div>
            </Fragment>
          );
        })}
      </div>

      {failed && job.error ? (
        <p className="mt-3 rounded-lg border border-red-200/90 bg-red-50/90 px-3 py-2 text-xs leading-relaxed text-red-900">{job.error}</p>
      ) : null}
    </div>
  );
};
