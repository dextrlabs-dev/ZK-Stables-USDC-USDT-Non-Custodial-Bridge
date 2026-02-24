import React, { useCallback, useState } from 'react';
import type { ChainVisual } from './WalletPill.js';
import { ChainBadge } from './ChainBadge.js';
import { shortenAddress } from '../../utils/formatAddress.js';
import { cn } from '../../utils/cn.js';

export const BridgeChainRow: React.FC<{
  label: string;
  chain: ChainVisual;
  address: string;
}> = ({ label, chain, address }) => {
  const [copied, setCopied] = useState(false);
  const display = shortenAddress(address);
  const copy = useCallback(() => {
    if (!address.trim()) return;
    void navigator.clipboard.writeText(address.trim());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [address]);

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2 gap-y-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <ChainBadge chain={chain} />
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200/80 bg-gradient-to-r from-slate-50/80 to-white px-3 py-2.5 shadow-sm">
        <p className="min-w-0 flex-1 font-mono text-[12px] leading-snug text-slate-700" title={address || undefined}>
          {address.trim() ? display : '—'}
        </p>
        <button
          type="button"
          onClick={copy}
          disabled={!address.trim()}
          className={cn(
            'shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
            copied
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/90 hover:bg-slate-50 hover:text-slate-900',
            !address.trim() && 'cursor-not-allowed opacity-40',
          )}
          aria-label={copied ? 'Copied' : 'Copy address'}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
};
