import React, { useCallback } from 'react';
import { shortenAddress } from '../../utils/formatAddress.js';
import { cn } from '../../utils/cn.js';

export type ChainVisual = 'evm' | 'cardano' | 'midnight';

const chainDot: Record<ChainVisual, string> = {
  evm: 'bg-indigo-500',
  cardano: 'bg-blue-600',
  midnight: 'bg-violet-600',
};

export const WalletPill: React.FC<{
  chain: ChainVisual;
  symbol: string;
  address: string;
  balanceLabel?: string;
  onCopy?: () => void;
}> = ({ chain, symbol, address, balanceLabel, onCopy }) => {
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(address);
    onCopy?.();
  }, [address, onCopy]);

  return (
    <div className="flex min-w-0 max-w-full items-stretch rounded-full border border-slate-200/90 bg-slate-50 pl-1.5 pr-0.5 py-0.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-100">
        <span className={cn('h-2.5 w-2.5 rounded-full', chainDot[chain])} aria-hidden />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center px-2">
        <span className="text-sm font-semibold leading-tight text-slate-900">{symbol}</span>
        <span className="truncate font-mono text-[11px] leading-tight text-slate-500" title={address}>
          {shortenAddress(address, { head: 6, tail: 4 })}
        </span>
        {balanceLabel ? (
          <span className="font-mono text-[11px] tabular-nums leading-tight text-slate-400">{balanceLabel}</span>
        ) : null}
      </div>
      <button
        type="button"
        className="flex shrink-0 items-center self-center rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-200/60 hover:text-slate-700"
        aria-label="Copy address"
        onClick={copy}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
    </div>
  );
};
