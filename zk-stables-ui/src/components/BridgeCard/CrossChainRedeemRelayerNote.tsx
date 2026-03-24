import React from 'react';

/**
 * Neutral pre-flight copy for Cardano/Midnight → EVM redeem (not an error — relayer must have pool + env).
 */
export const CrossChainRedeemRelayerNote: React.FC = () => (
  <div
    className="rounded-xl border border-slate-200/90 bg-slate-50/90 px-3 py-2.5 text-[11px] leading-relaxed text-slate-800"
    role="note"
  >
    <p className="font-semibold text-slate-900">Relayer operator (EVM pool unlock)</p>
    <p className="mt-1 text-slate-700">
      The relayer process must have <span className="font-mono text-[10px]">RELAYER_EVM_POOL_LOCK</span>,{' '}
      <span className="font-mono text-[10px]">RELAYER_EVM_PRIVATE_KEY</span>, and per-asset{' '}
      <span className="font-mono text-[10px]">RELAYER_EVM_UNDERLYING_TOKEN</span> (and{' '}
      <span className="font-mono text-[10px]">RELAYER_EVM_UNDERLYING_TOKEN_USDT</span> for USDT). The pool contract must hold USDC/USDT (run a fresh{' '}
      <span className="font-mono text-[10px]">deploy-anvil.js</span> — it seeds the pool). With{' '}
      <span className="font-mono text-[10px]">RELAYER_EVM_CROSS_CHAIN_UNLOCK_FALLBACK_NONCE=proof_digest</span> (default), you may leave burn commitment empty — the relayer uses the proof digest as the pool burn nonce. After submit, the job log shows{' '}
      <span className="font-mono text-[10px]">EVM underlying payout (operator unlock): 0x…</span> when payout succeeds.
    </p>
  </div>
);
