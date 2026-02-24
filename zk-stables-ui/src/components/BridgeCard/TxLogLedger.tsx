import React, { useCallback, useState } from 'react';
import type { TxLogEntry } from '../../lib/bridgeJobTxLog.js';
import { cn } from '../../utils/cn.js';

const chainStyles: Record<TxLogEntry['chain'], string> = {
  evm: 'border-l-indigo-500 bg-indigo-50/40',
  cardano: 'border-l-sky-500 bg-sky-50/40',
  midnight: 'border-l-violet-500 bg-violet-50/40',
  proof: 'border-l-amber-500/90 bg-amber-50/35',
  meta: 'border-l-slate-400 bg-slate-50/60',
};

const chainLabel: Record<TxLogEntry['chain'], string> = {
  evm: 'EVM',
  cardano: 'ADA',
  midnight: 'MN',
  proof: 'ZK',
  meta: '·',
};

export const TxLogLedger: React.FC<{ entries: TxLogEntry[]; className?: string }> = ({ entries, className }) => {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = useCallback((id: string, full: string) => {
    void navigator.clipboard.writeText(full);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 2000);
  }, []);

  if (entries.length === 0) {
    return (
      <p className={cn('rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-3 py-4 text-center text-xs text-slate-500', className)}>
        No transaction hashes yet — wait for proof and destination steps.
      </p>
    );
  }

  return (
    <div className={cn('overflow-hidden rounded-2xl border border-slate-200/90 bg-white', className)}>
      <div className="border-b border-slate-100 bg-slate-50/80 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">Transaction & proof log</p>
        <p className="mt-0.5 text-[10px] leading-snug text-slate-500">Source chain, proof material, and destination settlements. Copy full hashes for explorers.</p>
      </div>
      <ul className="max-h-[min(70vh,28rem)] divide-y divide-slate-100 overflow-y-auto overscroll-contain">
        {entries.map((e) => (
          <li key={e.id} className={cn('border-l-4 px-3 py-2.5', chainStyles[e.chain])}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-600">{chainLabel[e.chain]}</span>
                  <span className="text-[11px] font-semibold leading-snug text-slate-800">{e.label}</span>
                </div>
                <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-slate-700" title={e.full}>
                  {e.display}
                </p>
              </div>
              <button
                type="button"
                onClick={() => copy(e.id, e.full)}
                className={cn(
                  'shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold transition-colors',
                  copied === e.id ? 'bg-emerald-100 text-emerald-900' : 'bg-white/90 text-slate-600 shadow-sm ring-1 ring-slate-200/80 hover:bg-slate-50',
                )}
              >
                {copied === e.id ? 'Copied' : 'Copy'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
