import React from 'react';
import { cn } from '../../utils/cn.js';

/**
 * Shown for Cardano/Midnight → EVM redeem: operator must unlock pool on EVM (same copy in prod and dev).
 */
export const CrossChainRelayEnvHint: React.FC<{
  variant?: 'amber' | 'slate';
  className?: string;
}> = ({ variant = 'amber', className }) => {
  const isAmber = variant === 'amber';
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed',
        isAmber
          ? 'border-amber-200/90 bg-amber-50/80 text-amber-950'
          : 'border-slate-200/90 bg-slate-50/90 text-slate-800',
        className,
      )}
      role="note"
    >
      <p className={cn('font-semibold', isAmber ? 'text-amber-900' : 'text-slate-900')}>No EVM underlying payout tx in job hint</p>
      <p className={cn('mt-1', isAmber ? 'text-amber-900/90' : 'text-slate-700')}>
        Cross-chain redeem needs the relayer operator to unlock the pool on EVM. Confirm the server has{' '}
        <span className="font-mono text-[10px]">RELAYER_EVM_POOL_LOCK</span>,{' '}
        <span className="font-mono text-[10px]">RELAYER_EVM_PRIVATE_KEY</span>, and{' '}
        <span className="font-mono text-[10px]">RELAYER_EVM_UNDERLYING_TOKEN</span> (plus USDT if used). Check relayer logs for{' '}
        <span className="font-mono text-[10px]">cross-chain EVM claim skipped</span>.
      </p>
    </div>
  );
};
