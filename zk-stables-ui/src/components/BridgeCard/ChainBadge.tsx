import React from 'react';
import type { ChainVisual } from './WalletPill.js';
import { cn } from '../../utils/cn.js';

const styles: Record<ChainVisual, string> = {
  evm: 'border-indigo-200/90 bg-indigo-50/90 text-indigo-900',
  cardano: 'border-sky-200/90 bg-sky-50/90 text-sky-950',
  midnight: 'border-violet-200/90 bg-violet-50/90 text-violet-950',
};

const dots: Record<ChainVisual, string> = {
  evm: 'bg-indigo-500',
  cardano: 'bg-sky-600',
  midnight: 'bg-violet-600',
};

export const ChainBadge: React.FC<{ chain: ChainVisual; className?: string }> = ({ chain, className }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
      styles[chain],
      className,
    )}
  >
    <span className={cn('h-1.5 w-1.5 rounded-full', dots[chain])} aria-hidden />
    {chain === 'evm' ? 'EVM' : chain === 'cardano' ? 'Cardano' : 'Midnight'}
  </span>
);
