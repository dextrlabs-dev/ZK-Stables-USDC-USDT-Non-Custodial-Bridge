import React from 'react';
import { Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { shortenAddress } from '../../utils/formatAddress.js';

export const ReviewSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirming: boolean;
  operation: 'LOCK' | 'BURN';
  sourceChain: string;
  destChain: string;
  asset: string;
  amount: string;
  recipient: string;
}> = ({ open, onClose, onConfirm, confirming, operation, sourceChain, destChain, asset, amount, recipient }) => (
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
          ? 'Lock on the source chain. The relayer observes finality, then you complete mint on the destination.'
          : 'Burn on the source chain. After proof, funds unlock to your recipient on that chain.'}
      </p>
      <dl className="mt-4 space-y-3 border-t border-slate-100 pt-4">
        <Row label="Flow" value={operation === 'LOCK' ? 'Lock → Mint' : 'Burn → Unlock'} />
        <Row label="From" value={sourceChain} />
        {operation === 'LOCK' ? <Row label="To" value={destChain} /> : null}
        <Row label="Asset" value={asset} />
        <Row label="Amount" value={amount} />
        <Row
          label="Recipient"
          value={recipient.length > 36 ? shortenAddress(recipient) : recipient}
          mono
          full={recipient.length > 36 ? recipient : undefined}
        />
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
        disabled={confirming}
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
