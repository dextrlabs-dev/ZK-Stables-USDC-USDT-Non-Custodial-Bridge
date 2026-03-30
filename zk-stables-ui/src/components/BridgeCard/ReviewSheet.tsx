import React from 'react';
import { Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { shortenAddress } from '../../utils/formatAddress.js';

export const ReviewSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** When true, user cannot confirm (incomplete burn anchor, missing pool lock, etc.). */
  confirmDisabled?: boolean;
  confirming: boolean;
  operation: 'LOCK' | 'BURN';
  sourceChain: string;
  destChain: string;
  asset: string;
  /** For redeem flow: zkUSDC / zkUSDT (burned on-chain). */
  zkAssetLabel?: string;
  amount: string;
  recipient: string;
  redeemBurnStatus?:
    | 'n/a'
    | 'non-evm'
    | 'evm-pending'
    | 'evm-ready'
    | 'cardano-pending'
    | 'cardano-ready'
    | 'midnight-pending'
    | 'midnight-ready';
  burnTxSummary?: string;
  /** When true, underlying stable is paid on EVM after a Cardano/Midnight zk burn. */
  crossChainRedeemToEvm?: boolean;
  /** Mint path: short summary of the anchored `pool.lock` tx (if any). */
  evmLockAnchorSummary?: string;
}> = ({
  open,
  onClose,
  onConfirm,
  confirmDisabled = false,
  confirming,
  operation,
  sourceChain,
  destChain,
  asset,
  zkAssetLabel,
  amount,
  recipient,
  redeemBurnStatus = 'n/a',
  burnTxSummary,
  crossChainRedeemToEvm = false,
  evmLockAnchorSummary,
}) => (
  <Dialog
    open={open}
    onClose={onClose}
    fullWidth
    maxWidth="xs"
    PaperProps={{
      className: '!rounded-2xl !border !border-slate-200 !bg-white !p-0 !shadow-bridge',
    }}
  >
    <DialogTitle className="!pb-1 !pt-6 !text-lg !font-semibold !tracking-tight !text-slate-900">Review</DialogTitle>
    <DialogContent className="!px-6 !pb-2">
      <p className="text-sm leading-relaxed text-slate-600">
        {operation === 'LOCK'
          ? 'USDC/USDT must already be in the pool from an on-chain approve + lock. The relayer proves that lock, then mints zk on the destination chain — no mint without that deposit.'
          : crossChainRedeemToEvm
            ? `Redeem: you burn ${zkAssetLabel ?? 'zk stable'} on ${sourceChain}; the relayer verifies the anchor, then pays ${asset} (underlying) on EVM to your 0x recipient.`
            : `Redeem: you burn ${zkAssetLabel ?? 'zk stable'} on EVM; the relayer verifies the burn, then unlocks ${asset} (underlying) to your recipient.`}
      </p>
      <dl className="mt-4 space-y-3 border-t border-slate-100 pt-4">
        <Row label="Flow" value={operation === 'LOCK' ? 'Lock → Mint' : 'Burn zk → Unlock USDC/USDT'} />
        <Row label="From" value={sourceChain} />
        {operation === 'LOCK' ? <Row label="To" value={destChain} /> : null}
        <Row label={operation === 'LOCK' ? 'Asset' : 'Burn / unlock'} value={operation === 'LOCK' ? asset : `${zkAssetLabel ?? 'zk'} → ${asset}`} />
        <Row label={operation === 'BURN' ? 'Amount (burn + unlock)' : 'Amount'} value={amount} />
        {operation === 'LOCK' && evmLockAnchorSummary ? (
          <Row label="On-chain lock" value={evmLockAnchorSummary} mono />
        ) : null}
        <Row
          label="Recipient"
          value={recipient.length > 36 ? shortenAddress(recipient) : recipient}
          mono
          full={recipient.length > 36 ? recipient : undefined}
        />
        {redeemBurnStatus !== 'n/a' ? (
          <Row
            label="On-chain anchor"
            value={
              redeemBurnStatus === 'non-evm'
                ? 'Non-EVM burn (use chain-specific redeem)'
                : redeemBurnStatus === 'evm-ready'
                  ? `${burnTxSummary ?? 'Tx'} · linked to intent`
                  : redeemBurnStatus === 'cardano-ready'
                    ? 'Cardano lock spent (BridgeRelease) · commitment bound'
                    : redeemBurnStatus === 'midnight-ready'
                      ? 'Midnight initiateBurn · tx bound'
                      : redeemBurnStatus === 'cardano-pending'
                        ? 'Complete Cardano BridgeRelease + lock ref first'
                        : redeemBurnStatus === 'midnight-pending'
                          ? 'Run initiateBurn on Midnight first'
                          : 'Complete wallet burn first'
            }
          />
        ) : null}
      </dl>
    </DialogContent>
    <DialogActions className="!border-t !border-slate-100 !px-6 !py-4">
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
      >
        Back
      </button>
      <button
        type="button"
        disabled={confirming || confirmDisabled}
        onClick={onConfirm}
        className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-50"
      >
        {confirming ? 'Submitting…' : 'Confirm'}
      </button>
    </DialogActions>
  </Dialog>
);

function Row({ label, value, mono, full }: { label: string; value: string; mono?: boolean; full?: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd
        className={mono ? 'max-w-[min(100%,14rem)] break-all text-right font-mono text-xs font-medium text-slate-800' : 'text-right font-medium text-slate-900'}
        title={full}
      >
        {value}
      </dd>
    </div>
  );
}
